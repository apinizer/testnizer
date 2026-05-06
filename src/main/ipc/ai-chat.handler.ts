import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  streamChatCompletion,
  type AiProvider,
  type AiChatMessage,
} from '../protocols/ai-chat.engine'

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

      // Drive streaming in the background — the IPC call resolves immediately
      // with the messageId so the renderer can route subsequent chunk events.
      void (async () => {
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
            emit(win.id, 'aichat:chunk', { messageId, delta: chunk.delta })
          }

          if (controller.signal.aborted) {
            emit(win.id, 'aichat:cancelled', { messageId })
          } else {
            emit(win.id, 'aichat:done', { messageId })
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
