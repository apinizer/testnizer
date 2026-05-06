// src/renderer/stores/ai-chat.store.ts
// Postman-style AI chat — provider/model selection, multi-turn conversation,
// streaming response with cancellation. State is in-memory only (no DB).

import { create } from 'zustand'
import { resolveVariables } from '../lib/variable-resolver'
import { useEnvironmentStore } from './environment.store'

export type AiProvider = 'openai' | 'anthropic' | 'openrouter' | 'custom'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface AiModelOption {
  value: string
  label: string
}

/**
 * Static model lists per provider. We deliberately do not call provider APIs
 * to enumerate models — the renderer is forbidden from making network calls,
 * and listing models would leak the API key into the model-list call too.
 */
export const PROVIDER_MODELS: Record<AiProvider, AiModelOption[]> = {
  openai: [
    { value: 'gpt-4o', label: 'gpt-4o' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
    { value: 'gpt-4', label: 'gpt-4' },
    { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
  ],
  anthropic: [
    { value: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
    { value: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
  ],
  openrouter: [
    { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
    { value: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    { value: 'meta-llama/llama-3.1-70b-instruct', label: 'llama-3.1-70b-instruct' },
    { value: 'google/gemini-pro-1.5', label: 'gemini-pro-1.5' },
  ],
  custom: [
    { value: 'gpt-4o', label: 'gpt-4o' },
    { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
  ],
}

function defaultModelFor(provider: AiProvider): string {
  return PROVIDER_MODELS[provider][0]?.value ?? ''
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface AiChatStore {
  provider: AiProvider
  customUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  messages: AiChatMessage[]
  streaming: boolean
  pendingResponseId: string | null
  pendingMessageId: string | null
  errorMessage: string | null

  setProvider: (provider: AiProvider) => void
  setCustomUrl: (url: string) => void
  setApiKey: (key: string) => void
  setModel: (model: string) => void
  setSystemPrompt: (prompt: string) => void

  sendPrompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
  clearConversation: () => void

  /** Internal — used by the IPC subscription. */
  _onChunk: (messageId: string, delta: string) => void
  _onDone: (messageId: string) => void
  _onError: (messageId: string, error: string) => void
  _onCancelled: (messageId: string) => void
}

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  provider: 'openai',
  customUrl: '',
  apiKey: '',
  model: defaultModelFor('openai'),
  systemPrompt: '',
  messages: [],
  streaming: false,
  pendingResponseId: null,
  pendingMessageId: null,
  errorMessage: null,

  setProvider: (provider) => {
    // Switching provider auto-selects a sensible default model unless the
    // current model is already in the new provider's list.
    const models = PROVIDER_MODELS[provider]
    const current = get().model
    const stillValid = models.some((m) => m.value === current)
    set({ provider, model: stillValid ? current : defaultModelFor(provider) })
  },
  setCustomUrl: (customUrl) => set({ customUrl }),
  setApiKey: (apiKey) => set({ apiKey }),
  setModel: (model) => set({ model }),
  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),

  sendPrompt: async (content) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const state = get()
    if (state.streaming) return

    if (!state.apiKey.trim()) {
      set({ errorMessage: 'API key is required' })
      return
    }

    // Resolve {{var}} substitutions against active env + globals.
    const envVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedContent = resolveVariables(trimmed, envVars)
    const resolvedSystem = state.systemPrompt
      ? resolveVariables(state.systemPrompt, envVars)
      : ''
    const resolvedUrl = state.customUrl
      ? resolveVariables(state.customUrl, envVars)
      : state.customUrl

    const userMsg: AiChatMessage = {
      id: makeId(),
      role: 'user',
      content: resolvedContent,
      timestamp: Date.now(),
    }
    const assistantMsg: AiChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    set({
      messages: [...state.messages, userMsg, assistantMsg],
      streaming: true,
      errorMessage: null,
      pendingResponseId: assistantMsg.id,
    })

    // Build the chat history for the provider — include the resolved system
    // prompt at the top so multi-turn context is honoured.
    const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    if (resolvedSystem) history.push({ role: 'system', content: resolvedSystem })
    for (const m of get().messages) {
      if (m.id === assistantMsg.id) continue // current empty placeholder
      history.push({ role: m.role, content: m.content })
    }

    try {
      const result = (await window.api.aiChat.send({
        provider: state.provider,
        url: resolvedUrl || undefined,
        apiKey: state.apiKey,
        model: state.model,
        messages: history,
      })) as { success: boolean; data?: { messageId: string }; error?: string }

      if (!result?.success || !result.data?.messageId) {
        set({
          streaming: false,
          pendingResponseId: null,
          pendingMessageId: null,
          errorMessage: result?.error ?? 'Failed to start chat',
        })
        return
      }
      set({ pendingMessageId: result.data.messageId })
    } catch (e) {
      set({
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: (e as Error).message,
      })
    }
  },

  cancel: async () => {
    const id = get().pendingMessageId
    if (!id) return
    try {
      await window.api.aiChat.cancel(id)
    } catch {
      /* ignore — done event will still fire */
    }
  },

  clearConversation: () => {
    if (get().streaming) return
    set({ messages: [], errorMessage: null })
  },

  _onChunk: (messageId, delta) => {
    const state = get()
    if (state.pendingMessageId !== messageId) return
    set({
      messages: state.messages.map((m) =>
        m.id === state.pendingResponseId ? { ...m, content: m.content + delta } : m,
      ),
    })
  },

  _onDone: (messageId) => {
    if (get().pendingMessageId !== messageId) return
    set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
  },

  _onError: (messageId, error) => {
    const state = get()
    if (state.pendingMessageId !== messageId) return
    set({
      streaming: false,
      pendingResponseId: null,
      pendingMessageId: null,
      errorMessage: error,
    })
  },

  _onCancelled: (messageId) => {
    const state = get()
    if (state.pendingMessageId !== messageId) return
    // Keep whatever was streamed so far; just stop streaming state.
    set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
  },
}))

// ─── IPC subscriptions ──────────────────────────────────────
// Subscribe once at module load; the preload bridge multiplexes events to
// every listener, so re-mounting the editor is cheap.

if (typeof window !== 'undefined' && window.api?.aiChat) {
  window.api.aiChat.onChunk((event) => {
    const e = event as { messageId: string; delta: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onChunk(e.messageId, e.delta)
  })
  window.api.aiChat.onDone((event) => {
    const e = event as { messageId: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onDone(e.messageId)
  })
  window.api.aiChat.onError((event) => {
    const e = event as { messageId: string; error: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onError(e.messageId, e.error)
  })
  window.api.aiChat.onCancelled((event) => {
    const e = event as { messageId: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onCancelled(e.messageId)
  })
}
