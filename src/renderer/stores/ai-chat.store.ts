// src/renderer/stores/ai-chat.store.ts
// Postman-style AI chat — provider/model selection, multi-turn conversation,
// streaming response with cancellation. State is in-memory only (no DB).

import { create } from 'zustand'
import { resolveVariables } from '../lib/variable-resolver'
import { useEnvironmentStore } from './environment.store'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { makeId } from '../lib/utils'

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
  { id: 'openai', label: 'OpenAI', color: '#10A37F', letter: 'O' },
  { id: 'anthropic', label: 'Anthropic', color: '#D97757', letter: 'A' },
  { id: 'google', label: 'Google', color: '#4285F4', letter: 'G' },
  { id: 'xai', label: 'xAI', color: '#000000', letter: 'X' },
  { id: 'deepseek', label: 'DeepSeek', color: '#4D6BFE', letter: 'D' },
  { id: 'mistral', label: 'Mistral', color: '#FF7000', letter: 'M' },
  { id: 'groq', label: 'Groq', color: '#F55036', letter: 'G' },
  { id: 'perplexity', label: 'Perplexity', color: '#1F6FEB', letter: 'P' },
  { id: 'cerebras', label: 'Cerebras', color: '#F26522', letter: 'C' },
  { id: 'cohere', label: 'Cohere', color: '#39594D', letter: 'C' },
  { id: 'fireworks', label: 'Fireworks', color: '#5B5BD6', letter: 'F' },
  { id: 'deepinfra', label: 'DeepInfra', color: '#5C46E1', letter: 'D' },
  { id: 'together', label: 'Together', color: '#0F6FFF', letter: 'T' },
  { id: 'openrouter', label: 'OpenRouter', color: '#6E56CF', letter: 'R' },
  { id: 'custom', label: 'Custom', color: '#8A8FA3', letter: '⚙' },
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
 * Default chat-completions endpoints per provider — mirror of the same map in
 * `src/main/protocols/ai-chat.engine.ts:55-70`. Renderer cannot import from
 * the main process across the IPC boundary, so we duplicate; URLs change
 * rarely and any update is a single coordinated edit in both files.
 */
export const PROVIDER_DEFAULT_URLS: Record<Exclude<AiProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  cohere: 'https://api.cohere.com/compatibility/v1/chat/completions',
  fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
  deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
}

export function resolveDefaultUrl(provider: AiProvider): string {
  if (provider === 'custom') return ''
  return PROVIDER_DEFAULT_URLS[provider]
}

/**
 * Curated current model lists (May 2026). Manual model names are also
 * accepted in the editor — this is just an autocomplete list.
 */
export const PROVIDER_MODELS: Record<AiProvider, AiModelOption[]> = {
  openai: [
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
    { value: 'gpt-4o', label: 'gpt-4o' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'o4', label: 'o4' },
    { value: 'o4-mini', label: 'o4-mini' },
    { value: 'o3', label: 'o3' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  ],
  anthropic: [
    { value: 'claude-opus-4-7', label: 'claude-opus-4-7' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    { value: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest' },
    { value: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
  ],
  openrouter: [
    { value: 'anthropic/claude-opus-4-7', label: 'anthropic/claude-opus-4-7' },
    { value: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6' },
    { value: 'openai/gpt-5', label: 'openai/gpt-5' },
    { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
    { value: 'openai/o4-mini', label: 'openai/o4-mini' },
    { value: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
    { value: 'x-ai/grok-4', label: 'x-ai/grok-4' },
    { value: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
    { value: 'meta-llama/llama-4-maverick', label: 'meta-llama/llama-4-maverick' },
    { value: 'mistralai/mistral-large-2411', label: 'mistralai/mistral-large' },
  ],
  google: [
    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'gemini-2.0-flash-thinking-exp' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat (V3)' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner (R1)' },
  ],
  xai: [
    { value: 'grok-4', label: 'grok-4' },
    { value: 'grok-4-fast', label: 'grok-4-fast' },
    { value: 'grok-3', label: 'grok-3' },
    { value: 'grok-3-mini', label: 'grok-3-mini' },
    { value: 'grok-3-fast', label: 'grok-3-fast' },
  ],
  mistral: [
    { value: 'mistral-large-latest', label: 'mistral-large-latest' },
    { value: 'mistral-medium-latest', label: 'mistral-medium-latest' },
    { value: 'mistral-small-latest', label: 'mistral-small-latest' },
    { value: 'codestral-latest', label: 'codestral-latest' },
    { value: 'pixtral-large-latest', label: 'pixtral-large-latest' },
    { value: 'ministral-8b-latest', label: 'ministral-8b-latest' },
    { value: 'ministral-3b-latest', label: 'ministral-3b-latest' },
  ],
  groq: [
    { value: 'llama-4-scout-17b-16e-instruct', label: 'llama-4-scout-17b-16e-instruct' },
    { value: 'llama-4-maverick-17b-128e-instruct', label: 'llama-4-maverick-17b-128e-instruct' },
    { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
    { value: 'qwen-3-32b', label: 'qwen-3-32b' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'deepseek-r1-distill-llama-70b' },
    { value: 'gemma2-9b-it', label: 'gemma2-9b-it' },
  ],
  perplexity: [
    { value: 'sonar', label: 'sonar' },
    { value: 'sonar-pro', label: 'sonar-pro' },
    { value: 'sonar-reasoning', label: 'sonar-reasoning' },
    { value: 'sonar-reasoning-pro', label: 'sonar-reasoning-pro' },
    { value: 'sonar-deep-research', label: 'sonar-deep-research' },
  ],
  cerebras: [
    { value: 'llama-4-scout', label: 'llama-4-scout' },
    { value: 'llama-3.3-70b', label: 'llama-3.3-70b' },
    { value: 'llama3.1-8b', label: 'llama3.1-8b' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'deepseek-r1-distill-llama-70b' },
  ],
  cohere: [
    { value: 'command-a-03-2025', label: 'command-a-03-2025' },
    { value: 'command-r-plus-08-2024', label: 'command-r-plus-08-2024' },
    { value: 'command-r-08-2024', label: 'command-r-08-2024' },
    { value: 'command-r7b-12-2024', label: 'command-r7b-12-2024' },
  ],
  fireworks: [
    { value: 'accounts/fireworks/models/deepseek-v3', label: 'deepseek-v3' },
    { value: 'accounts/fireworks/models/deepseek-r1', label: 'deepseek-r1' },
    {
      value: 'accounts/fireworks/models/llama4-scout-instruct-basic',
      label: 'llama4-scout-instruct',
    },
    {
      value: 'accounts/fireworks/models/qwen3-coder-30b-a3b-instruct',
      label: 'qwen3-coder-30b',
    },
    { value: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'mixtral-8x22b-instruct' },
  ],
  deepinfra: [
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1' },
    { value: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', label: 'Llama-4-Scout-17B' },
    { value: 'Qwen/Qwen3-32B', label: 'Qwen3-32B' },
    { value: 'mistralai/Mistral-Small-24B-Instruct-2501', label: 'Mistral-Small-24B' },
  ],
  together: [
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1' },
    {
      value: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      label: 'Llama-4-Maverick-17B',
    },
    { value: 'Qwen/Qwen3-32B', label: 'Qwen3-32B' },
    { value: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral-8x22B-Instruct' },
  ],
  custom: [
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  ],
}

function defaultModelFor(provider: AiProvider): string {
  return PROVIDER_MODELS[provider][0]?.value ?? ''
}

/** Snapshot of AI Chat state for per-tab caching. */
interface TabAiChatState {
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
}

interface AiChatStore extends TabAiChatState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabAiChatState>
  _currentTabId: string | null

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

  /** Switch active tab — saves current state and loads target tab state. */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. */
  removeTabState: (tabId: string) => void
}

function emptyTabState(): TabAiChatState {
  return {
    provider: 'openai',
    customUrl: resolveDefaultUrl('openai'),
    apiKey: '',
    model: defaultModelFor('openai'),
    systemPrompt: '',
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
  }
}

function extractState(s: AiChatStore): TabAiChatState {
  return {
    provider: s.provider,
    customUrl: s.customUrl,
    apiKey: s.apiKey,
    model: s.model,
    systemPrompt: s.systemPrompt,
    messages: s.messages,
    streaming: s.streaming,
    pendingResponseId: s.pendingResponseId,
    pendingMessageId: s.pendingMessageId,
    errorMessage: s.errorMessage,
  }
}

/**
 * Walk every tab (live + cached) looking for the one whose `pendingMessageId`
 * matches the streaming chunk we just received from main. The streaming pump
 * is global, so we may need to route a delta into a tab that isn't the
 * currently active one.
 */
function findTabByPendingId(
  state: AiChatStore,
  messageId: string,
): { isLive: boolean; tabKey?: string; snapshot: TabAiChatState } | null {
  if (state.pendingMessageId === messageId) {
    return { isLive: true, snapshot: extractState(state) }
  }
  for (const [key, snap] of state._tabStates.entries()) {
    if (snap.pendingMessageId === messageId) {
      return { isLive: false, tabKey: key, snapshot: snap }
    }
  }
  return null
}

const STORAGE_KEY = 'testnizer-ai-chat'
const persisted = loadTabbedState<TabAiChatState>(STORAGE_KEY, emptyTabState)

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setProvider: (provider) => {
    // Switching provider auto-selects a sensible default model unless the
    // current model is already in the new provider's list, and pre-fills the
    // endpoint URL with that provider's default so the user always sees where
    // requests will go. For `custom`, the existing customUrl is preserved.
    const models = PROVIDER_MODELS[provider]
    const state = get()
    const stillValid = models.some((m) => m.value === state.model)
    set({
      provider,
      model: stillValid ? state.model : defaultModelFor(provider),
      customUrl: provider === 'custom' ? state.customUrl : resolveDefaultUrl(provider),
    })
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
    const resolvedSystem = state.systemPrompt ? resolveVariables(state.systemPrompt, envVars) : ''
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
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    const updatedMessages = found.snapshot.messages.map((m) =>
      m.id === found.snapshot.pendingResponseId ? { ...m, content: m.content + delta } : m,
    )
    if (found.isLive) {
      set({ messages: updatedMessages })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, { ...found.snapshot, messages: updatedMessages })
      set({ _tabStates: map })
    }
  },

  _onDone: (messageId) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    if (found.isLive) {
      set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
      })
      set({ _tabStates: map })
    }
  },

  _onError: (messageId, error) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    if (found.isLive) {
      set({
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: error,
      })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: error,
      })
      set({ _tabStates: map })
    }
  },

  _onCancelled: (messageId) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    // Keep whatever was streamed so far; just stop streaming state.
    if (found.isLive) {
      set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
      })
      set({ _tabStates: map })
    }
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

attachTabbedPersist(useAiChatStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
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
