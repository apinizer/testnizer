// src/renderer/stores/ai-chat.store.ts
// Postman-style AI chat — provider/model selection, multi-turn conversation,
// streaming response with cancellation. State is in-memory only (no DB).

import { create } from 'zustand'
import { resolveVariables } from '../lib/variable-resolver'
import { useEnvironmentStore } from './environment.store'

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'perplexity'
  | 'cerebras'
  | 'cohere'
  | 'fireworks'
  | 'deepinfra'
  | 'together'
  | 'custom'

export interface AiProviderInfo {
  id: AiProvider
  label: string
  /** Avatar background color (brand-ish). */
  color: string
  /** Single-letter avatar fallback. */
  letter: string
}

/**
 * Provider catalog — order shown in the dropdown matches Postman's grouping
 * (large frontier labs first, then aggregators, then specialized providers).
 */
export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'openai',     label: 'OpenAI',     color: '#10A37F', letter: 'O' },
  { id: 'anthropic',  label: 'Anthropic',  color: '#D97757', letter: 'A' },
  { id: 'google',     label: 'Google',     color: '#4285F4', letter: 'G' },
  { id: 'xai',        label: 'xAI',        color: '#000000', letter: 'X' },
  { id: 'deepseek',   label: 'DeepSeek',   color: '#4D6BFE', letter: 'D' },
  { id: 'mistral',    label: 'Mistral',    color: '#FF7000', letter: 'M' },
  { id: 'groq',       label: 'Groq',       color: '#F55036', letter: 'G' },
  { id: 'perplexity', label: 'Perplexity', color: '#1F6FEB', letter: 'P' },
  { id: 'cerebras',   label: 'Cerebras',   color: '#F26522', letter: 'C' },
  { id: 'cohere',     label: 'Cohere',     color: '#39594D', letter: 'C' },
  { id: 'fireworks',  label: 'Fireworks',  color: '#5B5BD6', letter: 'F' },
  { id: 'deepinfra',  label: 'DeepInfra',  color: '#5C46E1', letter: 'D' },
  { id: 'together',   label: 'Together',   color: '#0F6FFF', letter: 'T' },
  { id: 'openrouter', label: 'OpenRouter', color: '#6E56CF', letter: 'R' },
  { id: 'custom',     label: 'Custom',     color: '#8A8FA3', letter: '⚙' },
]

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
    { value: 'o1-preview', label: 'o1-preview' },
    { value: 'o1-mini', label: 'o1-mini' },
  ],
  anthropic: [
    { value: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
    { value: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
    { value: 'claude-3-opus-latest', label: 'claude-3-opus-latest' },
  ],
  openrouter: [
    { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
    { value: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    { value: 'anthropic/claude-3-5-sonnet', label: 'anthropic/claude-3-5-sonnet' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'meta-llama/llama-3.3-70b-instruct' },
    { value: 'google/gemini-2.0-flash-exp:free', label: 'google/gemini-2.0-flash-exp' },
    { value: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
    { value: 'mistralai/mistral-large-2411', label: 'mistralai/mistral-large' },
  ],
  google: [
    { value: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
    { value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
  ],
  xai: [
    { value: 'grok-2-latest', label: 'grok-2-latest' },
    { value: 'grok-2-1212', label: 'grok-2-1212' },
    { value: 'grok-beta', label: 'grok-beta' },
    { value: 'grok-vision-beta', label: 'grok-vision-beta' },
  ],
  mistral: [
    { value: 'mistral-large-latest', label: 'mistral-large-latest' },
    { value: 'mistral-small-latest', label: 'mistral-small-latest' },
    { value: 'codestral-latest', label: 'codestral-latest' },
    { value: 'pixtral-large-latest', label: 'pixtral-large-latest' },
    { value: 'open-mistral-nemo', label: 'open-mistral-nemo' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
    { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
    { value: 'llama3-70b-8192', label: 'llama3-70b-8192' },
    { value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
    { value: 'gemma2-9b-it', label: 'gemma2-9b-it' },
  ],
  perplexity: [
    { value: 'llama-3.1-sonar-large-128k-online', label: 'sonar-large-online' },
    { value: 'llama-3.1-sonar-small-128k-online', label: 'sonar-small-online' },
    { value: 'llama-3.1-sonar-large-128k-chat', label: 'sonar-large-chat' },
    { value: 'llama-3.1-sonar-small-128k-chat', label: 'sonar-small-chat' },
  ],
  cerebras: [
    { value: 'llama3.1-8b', label: 'llama3.1-8b' },
    { value: 'llama3.1-70b', label: 'llama3.1-70b' },
    { value: 'llama-3.3-70b', label: 'llama-3.3-70b' },
  ],
  cohere: [
    { value: 'command-r-plus', label: 'command-r-plus' },
    { value: 'command-r', label: 'command-r' },
    { value: 'command-r-08-2024', label: 'command-r-08-2024' },
    { value: 'command-r-plus-08-2024', label: 'command-r-plus-08-2024' },
  ],
  fireworks: [
    { value: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'llama-v3p3-70b-instruct' },
    { value: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'llama-v3p1-70b-instruct' },
    { value: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'mixtral-8x22b-instruct' },
    { value: 'accounts/fireworks/models/qwen2p5-72b-instruct', label: 'qwen2p5-72b-instruct' },
  ],
  deepinfra: [
    { value: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama-3.3-70B-Instruct' },
    { value: 'meta-llama/Meta-Llama-3.1-70B-Instruct', label: 'Meta-Llama-3.1-70B-Instruct' },
    { value: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B-Instruct' },
    { value: 'mistralai/Mistral-Small-24B-Instruct-2501', label: 'Mistral-Small-24B-Instruct' },
  ],
  together: [
    { value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama-3.3-70B-Instruct-Turbo' },
    { value: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Meta-Llama-3.1-70B-Instruct-Turbo' },
    { value: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Meta-Llama-3.1-8B-Instruct-Turbo' },
    { value: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen2.5-72B-Instruct-Turbo' },
    { value: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral-8x22B-Instruct' },
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
