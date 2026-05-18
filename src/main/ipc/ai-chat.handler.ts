import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  streamChatCompletion,
  type AiProvider,
  type AiChatMessage,
} from '../protocols/ai-chat.engine'
import { logRequestResponse, logEvent } from '../lib/console-logger'

interface AiChatSendPayload {
  provider: AiProvider
  url?: string
  apiKey: string
  model: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
}

interface ActiveStream {
  controller: AbortController
  windowId: number
}

// Track in-flight streams so the renderer can cancel by messageId.
const activeStreams = new Map<string, ActiveStream>()

function emit(windowId: number, channel: string, payload: unknown): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

export function registerAiChatHandlers(): void {
  // ─── Send prompt + stream response ───────────────────────────
  ipcMain.handle('aichat:send', async (event, payload: AiChatSendPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const messageId = randomUUID()
      const controller = new AbortController()
      activeStreams.set(messageId, { controller, windowId: win.id })

      const lastUserMsg = payload.messages.filter((m) => m.role === 'user').slice(-1)[0]
      const promptPreview = lastUserMsg?.content?.slice(0, 200) ?? ''
      const started = Date.now()
      const targetUrl = payload.url ?? `${payload.provider}://chat/completions`

      // Drive streaming in the background — the IPC call resolves immediately
      // with the messageId so the renderer can route subsequent chunk events.
      void (async () => {
        let fullText = ''
        let chunkCount = 0
        let firstChunkAt: number | null = null
        try {
          const stream = streamChatCompletion({
            provider: payload.provider,
            url: payload.url,
            apiKey: payload.apiKey,
            model: payload.model,
            messages: payload.messages,
            temperature: payload.temperature,
            maxTokens: payload.maxTokens,
            signal: controller.signal,
          })

          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            chunkCount++
            if (firstChunkAt === null) firstChunkAt = Date.now()
            fullText += chunk.delta ?? ''
            emit(win.id, 'aichat:chunk', { messageId, delta: chunk.delta })
          }

          const elapsed = Date.now() - started
          const ttfb = firstChunkAt ? firstChunkAt - started : 0
          const totalBytes = Buffer.byteLength(fullText, 'utf-8')

          if (controller.signal.aborted) {
            emit(win.id, 'aichat:cancelled', { messageId })
            logEvent({
              protocol: 'ai',
              category: 'event',
              message: `AI ${payload.provider}/${payload.model} cancelled (${chunkCount} chunks, ${fullText.length} chars)`,
              direction: 'in',
              durationMs: elapsed,
              sizeBytes: totalBytes,
              meta: {
                chunks: chunkCount,
                ttfbMs: ttfb,
                provider: payload.provider,
                model: payload.model,
              },
            })
          } else {
            emit(win.id, 'aichat:done', { messageId })
            logRequestResponse({
              protocol: 'ai',
              method: 'CHAT',
              url: targetUrl,
              status: 200,
              statusText: 'OK',
              durationMs: elapsed,
              sizeBytes: totalBytes,
              requestBody: promptPreview,
              responseBody: fullText,
              meta: {
                provider: payload.provider,
                model: payload.model,
                messageCount: payload.messages.length,
                temperature: payload.temperature ?? 0,
                chunks: chunkCount,
                ttfbMs: ttfb,
                avgChunkBytes: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
              },
            })
          }
        } catch (e) {
          // Distinguish abort errors from real failures.
          const err = e as Error & { name?: string }
          if (
            controller.signal.aborted ||
            err?.name === 'AbortError' ||
            /aborted/i.test(err?.message ?? '')
          ) {
            emit(win.id, 'aichat:cancelled', { messageId })
          } else {
            emit(win.id, 'aichat:error', {
              messageId,
              error: err?.message ?? String(e),
            })
            logRequestResponse({
              protocol: 'ai',
              method: 'CHAT',
              url: targetUrl,
              status: -1,
              statusText: err?.message ?? 'AI chat failed',
              durationMs: Date.now() - started,
              requestBody: promptPreview,
              error: { message: err?.message ?? String(e), stack: err?.stack },
              meta: {
                provider: payload.provider,
                model: payload.model,
                messageCount: payload.messages.length,
              },
            })
          }
        } finally {
          activeStreams.delete(messageId)
        }
      })()

      return { success: true, data: { messageId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Cancel an in-flight stream ──────────────────────────────
  ipcMain.handle('aichat:cancel', async (_event, messageId: string) => {
    try {
      const active = activeStreams.get(messageId)
      if (!active) {
        return { success: true, data: { cancelled: false } }
      }
      active.controller.abort()
      activeStreams.delete(messageId)
      return { success: true, data: { cancelled: true } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
