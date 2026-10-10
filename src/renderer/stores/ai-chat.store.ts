// src/renderer/stores/ai-chat.store.ts
// Postman-style AI chat — provider/model selection, multi-turn conversation,
// streaming response with cancellation. The per-tab state is snapshotted to
// localStorage WITHOUT the API key and credential headers (issue #188); the
// key lives encrypted in main, one per provider (see "API keys" below). The
// request configuration is saved with the request row (issue #187).

import { create } from 'zustand'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { useEnvironmentStore } from './environment.store'
import {
  loadJson,
  loadTabbedState,
  attachTabbedPersist,
  writeTabbedSnapshot,
  type PersistedTabbed,
} from '../lib/persist-helpers'
import { makeId } from '../lib/utils'
import { markActiveTabDirty } from '../lib/mark-dirty'
import {
  aiKeyScope,
  canCarryAiKey,
  isValidMaxTokens,
  isValidTemperature,
  stripCredentialHeaders,
} from '../lib/ai-chat-config'
import type { KeyValuePair } from '../types'
import type {
  AiAssistantTurn,
  AiCallMetrics,
  AiConversationSummary,
  AiNoticePart,
  AiToolCallPart,
  AiToolResultPart,
  AiTurn,
  AiTurnMetrics,
} from '../../shared/ai-chat-types'
import { applyTextDelta, sumTurnMetrics, upsertPart } from '../../shared/ai-chat-turns'
import {
  readToolServers,
  savedToolServersOf,
  type AiToolCatalogEntry,
  type AiToolServerConfig,
} from '../lib/ai-chat-tools-config'
import { buildToolServers } from '../lib/ai-tool-servers'
import {
  activeProjectIdForAi,
  dropTabConversations,
  persistFinishedTurn,
  pruneOrphanTabConversations,
} from './ai-chat-conversations'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

/**
 * Enabled, non-blank custom headers → the map sent to main (issue #120).
 * `{{var}}` in names and values is resolved against the active environment.
 */
export function buildCustomHeaderMap(
  rows: KeyValuePair[],
  envVars: Record<string, string>,
): Record<string, string> {
  const resolved = resolveKeyValuePairs(
    rows.filter((h) => h.enabled && h.key.trim()),
    envVars,
  )
  const map: Record<string, string> = {}
  for (const row of resolved) map[row.key.trim()] = row.value
  return map
}

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

/**
 * One turn of the conversation — the shared model (`src/shared/ai-chat-types.ts`,
 * issues #180 / #198 / #199): a user turn is text; an assistant turn carries
 * ordered parts (text, tool calls, tool results, notices), metrics, and
 * `content` = its text joined (kept in sync by the shared reducers).
 */
export type AiChatMessage = AiTurn

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
  /** User-defined HTTP headers sent with every completion request (issue #120). */
  customHeaders: KeyValuePair[]
  /** Sampling temperature; `null` = provider default (issue #189). */
  temperature: number | null
  /** `max_tokens`; `null` = provider default (Anthropic: 4096, issue #189). */
  maxTokens: number | null
  messages: AiChatMessage[]
  streaming: boolean
  pendingResponseId: string | null
  pendingMessageId: string | null
  errorMessage: string | null
  /** MCP servers offered as tools (issue #180) — saved with the request, no literal secrets. */
  toolServers: AiToolServerConfig[]
  /** Last "Load tools" result per server id (UI state). */
  toolCatalog: Record<string, AiToolCatalogEntry>
  /** "Run tools without asking" — per tab on this machine, NEVER saved with the request. */
  autoApproveTools: boolean
  /** "Allow this tool for this conversation" grants (`aiToolAllowKey`) — memory only. */
  allowedTools: string[]
  /** The conversation shown (issue #199); null = a new one, created on the first answer. */
  conversationId: string | null
  conversationName: string | null
  conversations: AiConversationSummary[]
  /** The list / current conversation were read from the database for this tab. */
  conversationLoaded: boolean
}

/**
 * Where API keys end up (issue #188): `encrypted` = safeStorage in main,
 * `memory` = encryption unavailable, the key lives for this session only.
 * Global, not per tab.
 */
export type AiKeyStorage = 'unknown' | 'encrypted' | 'memory'

interface AiChatStore extends TabAiChatState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabAiChatState>
  _currentTabId: string | null
  keyStorage: AiKeyStorage

  setProvider: (provider: AiProvider) => void
  setCustomUrl: (url: string) => void
  setApiKey: (key: string) => void
  setModel: (model: string) => void
  setSystemPrompt: (prompt: string) => void
  setTemperature: (temperature: number | null) => void
  setMaxTokens: (maxTokens: number | null) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  setHeaders: (headers: KeyValuePair[]) => void

  sendPrompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
  clearConversation: () => void

  /** Internal — used by the IPC subscription. */
  _onChunk: (messageId: string, delta: string) => void
  _onPart: (messageId: string, part: AiToolCallPart | AiToolResultPart | AiNoticePart) => void
  _onCall: (messageId: string, metrics: AiCallMetrics) => void
  _onDone: (messageId: string, truncated?: boolean, metrics?: AiTurnMetrics) => void
  _onError: (messageId: string, error: string, metrics?: AiTurnMetrics) => void
  _onCancelled: (messageId: string, metrics?: AiTurnMetrics) => void

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
    customHeaders: [defaultKv()],
    temperature: null,
    maxTokens: null,
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
    toolServers: [],
    toolCatalog: {},
    autoApproveTools: false,
    allowedTools: [],
    conversationId: null,
    conversationName: null,
    conversations: [],
    conversationLoaded: false,
  }
}

function extractState(s: AiChatStore): TabAiChatState {
  return {
    provider: s.provider,
    customUrl: s.customUrl,
    apiKey: s.apiKey,
    model: s.model,
    systemPrompt: s.systemPrompt,
    customHeaders: s.customHeaders,
    temperature: s.temperature ?? null,
    maxTokens: s.maxTokens ?? null,
    messages: s.messages,
    streaming: s.streaming,
    pendingResponseId: s.pendingResponseId,
    pendingMessageId: s.pendingMessageId,
    errorMessage: s.errorMessage,
    toolServers: s.toolServers ?? [],
    toolCatalog: s.toolCatalog ?? {},
    autoApproveTools: s.autoApproveTools === true,
    allowedTools: s.allowedTools ?? [],
    conversationId: s.conversationId ?? null,
    conversationName: s.conversationName ?? null,
    conversations: s.conversations ?? [],
    conversationLoaded: s.conversationLoaded === true,
  }
}

/** Key of the live tab in `_tabStates` (`switchToTab` uses the same). */
export function liveTabKey(s: { _currentTabId: string | null }): string {
  return s._currentTabId === null ? '__null__' : s._currentTabId
}

/**
 * Patch the state of tab `tabKey`, whether it is the live tab or a cached one
 * — for writes that land after an `await` (the user may have switched tabs).
 */
export function patchAiTab(
  tabKey: string,
  patch: (st: TabAiChatState) => Partial<TabAiChatState>,
): void {
  const state = useAiChatStore.getState()
  if (liveTabKey(state) === tabKey) {
    useAiChatStore.setState(patch(extractState(state)))
    return
  }
  const cached = state._tabStates.get(tabKey)
  if (!cached) return
  const map = new Map(state._tabStates)
  map.set(tabKey, { ...cached, ...patch(cached) })
  useAiChatStore.setState({ _tabStates: map })
}

/** Read a tab's state (live or cached). */
export function readAiTab(tabKey: string): TabAiChatState | undefined {
  const state = useAiChatStore.getState()
  if (liveTabKey(state) === tabKey) return extractState(state)
  return state._tabStates.get(tabKey)
}

/** Apply `fn` to the assistant turn `turnId` of a tab state. */
function mapTurn(
  st: TabAiChatState,
  turnId: string | null,
  fn: (t: AiAssistantTurn) => AiAssistantTurn,
): AiChatMessage[] {
  return st.messages.map((m) => (m.id === turnId && m.role === 'assistant' ? fn(m) : m))
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

/**
 * Session-only fields reset when a snapshot is read back (issue #180): an
 * older release wrote "Run tools without asking" and the Load-tools catalog
 * (a `loading: true` spinner stuck forever) into the snapshot. Messages are
 * NOT blanked here — `ensureAiConversationsLoaded` stores an older snapshot's
 * turns as a conversation on first open.
 */
function freshFromSnapshot(st: TabAiChatState): TabAiChatState {
  return {
    ...st,
    autoApproveTools: false,
    toolCatalog: {},
    allowedTools: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
  }
}

const persisted = (() => {
  const loaded = loadTabbedState<TabAiChatState>(STORAGE_KEY, emptyTabState)
  const tabStates = new Map<string, TabAiChatState>()
  for (const [id, st] of loaded._tabStates) tabStates.set(id, freshFromSnapshot(st))
  return { ...loaded, current: freshFromSnapshot(loaded.current), _tabStates: tabStates }
})()

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  keyStorage: 'unknown',

  // Every config setter below marks the tab dirty (issue #187) — the
  // configuration is saved with the request. The API key is NOT: it is not
  // part of the saved request, so typing it never dirties the tab.
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
    markActiveTabDirty()
    // A different provider has its own key — never send the old one to it.
    syncLiveKey({ clear: true })
  },
  setCustomUrl: (customUrl) => {
    const before = get()
    const fromScope = aiKeyScope(before.provider, before.customUrl)
    set({ customUrl })
    markActiveTabDirty()
    // Custom provider: the key belongs to the base URL (issue #188). A key
    // typed for one gateway is never handed to another: the field is cleared
    // at once (not after main answers — a Send in between would carry it).
    // Only a key typed for no origin yet follows the edit (`canCarryAiKey`:
    // a blank URL being typed, or a templated path edit that stays
    // templated), in memory — a carried key is never persisted.
    const toScope = aiKeyScope(before.provider, customUrl)
    if (toScope === fromScope) return
    const origin = keyOrigins.get(fromScope) ?? fromScope
    if (before.apiKey && canCarryAiKey(origin, toScope)) {
      syncLiveKey({ carry: { key: before.apiKey, origin } })
    } else {
      syncLiveKey({ clear: true })
    }
  },
  setApiKey: (apiKey) => {
    set({ apiKey })
    const s = get()
    const scope = aiKeyScope(s.provider, s.customUrl)
    sessionKeys.set(scope, apiKey)
    // Typed here → it belongs here (no longer a carried key).
    keyOrigins.delete(scope)
    schedulePersist(scope, apiKey)
  },
  setModel: (model) => {
    set({ model })
    markActiveTabDirty()
  },
  setSystemPrompt: (systemPrompt) => {
    set({ systemPrompt })
    markActiveTabDirty()
  },
  setTemperature: (temperature) => {
    set({ temperature: isValidTemperature(temperature) ? temperature : null })
    markActiveTabDirty()
  },
  setMaxTokens: (maxTokens) => {
    set({ maxTokens: isValidMaxTokens(maxTokens) ? maxTokens : null })
    markActiveTabDirty()
  },
  addHeader: () => {
    set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] }))
    markActiveTabDirty()
  },
  updateHeader: (id, updates) => {
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveTabDirty()
  },
  removeHeader: (id) => {
    set((state) => ({ customHeaders: state.customHeaders.filter((h) => h.id !== id) }))
    markActiveTabDirty()
  },
  setHeaders: (customHeaders) => {
    set({ customHeaders })
    markActiveTabDirty()
  },

  sendPrompt: async (content) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const state = get()
    if (state.streaming) return
    const tabKey = liveTabKey(state)

    // The API key is optional (issue #121): auth may come from a custom
    // header, a gateway, or not be needed at all. main emits no credential
    // header when it is empty.

    // Resolve {{var}} substitutions against active env + globals.
    const envVars = useEnvironmentStore.getState().getActiveVariables()
    const headerMap = buildCustomHeaderMap(state.customHeaders ?? [], envVars)
    const resolvedContent = resolveVariables(trimmed, envVars)
    const resolvedSystem = state.systemPrompt ? resolveVariables(state.systemPrompt, envVars) : ''
    const resolvedUrl = state.customUrl
      ? resolveVariables(state.customUrl, envVars)
      : state.customUrl
    // The key field takes {{var}} like every other field (issue #188).
    const resolvedKey = state.apiKey ? resolveVariables(state.apiKey, envVars) : ''

    const prior = state.messages
    const userMsg: AiChatMessage = {
      id: makeId(),
      role: 'user',
      content: resolvedContent,
      timestamp: Date.now(),
    }
    const assistantMsg: AiAssistantTurn = {
      id: makeId(),
      role: 'assistant',
      content: '',
      parts: [],
      timestamp: Date.now(),
    }

    set({
      messages: [...prior, userMsg, assistantMsg],
      streaming: true,
      errorMessage: null,
      pendingResponseId: assistantMsg.id,
    })

    const fail = (error: string): void =>
      patchAiTab(tabKey, () => ({
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: error,
      }))

    try {
      // MCP servers as tools (issue #180): only the enabled ones; a server
      // that cannot be prepared shows a notice on this turn.
      let tools: Parameters<Window['api']['aiChat']['send']>[0]['tools']
      const enabled = (state.toolServers ?? []).filter((sv) => sv.enabled)
      if (enabled.length > 0) {
        const built = await buildToolServers(enabled, envVars)
        for (const p of built.problems) {
          const notice: AiNoticePart = {
            type: 'notice',
            id: `server-error:${p.serverId}`,
            kind: 'server-error',
            serverId: p.serverId,
            server: p.server,
            message: p.message,
          }
          patchAiTab(tabKey, (st) => ({
            messages: mapTurn(st, assistantMsg.id, (t) => upsertPart(t, notice)),
          }))
        }
        if (built.servers.length > 0) {
          const projectId = activeProjectIdForAi()
          tools = {
            ...(projectId ? { projectId } : {}),
            servers: built.servers,
            autoApprove: state.autoApproveTools === true,
            allowedTools: state.allowedTools ?? [],
          }
        }
      }

      const result = (await window.api.aiChat.send({
        provider: state.provider,
        url: resolvedUrl || undefined,
        apiKey: resolvedKey,
        headers: Object.keys(headerMap).length > 0 ? headerMap : undefined,
        model: state.model,
        // Earlier turns go as they are; main replays them as text
        // (`historyAsText`) — tool calls of earlier prompts are not resent.
        ...(resolvedSystem ? { system: resolvedSystem } : {}),
        history: prior,
        prompt: resolvedContent,
        ...(tools ? { tools } : {}),
        // Generation settings (issue #189) — left out when unset so the
        // provider (or the engine's Anthropic default) decides.
        ...(isValidTemperature(state.temperature) ? { temperature: state.temperature } : {}),
        ...(isValidMaxTokens(state.maxTokens) ? { maxTokens: state.maxTokens } : {}),
      })) as { success: boolean; data?: { messageId: string }; error?: string }

      if (!result?.success || !result.data?.messageId) {
        fail(result?.error ?? 'Failed to start chat')
        return
      }
      const messageId = result.data.messageId
      patchAiTab(tabKey, () => ({ pendingMessageId: messageId }))
    } catch (e) {
      fail((e as Error).message)
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
    // Postman's "new conversation": the current one stays in the list.
    if (get().streaming) return
    set({
      messages: [],
      errorMessage: null,
      conversationId: null,
      conversationName: null,
      allowedTools: [],
    })
  },

  _onChunk: (messageId, delta) => {
    const found = findTabByPendingId(get(), messageId)
    if (!found) return
    patchFound(found, (st) => ({
      messages: mapTurn(st, st.pendingResponseId, (t) => applyTextDelta(t, delta)),
    }))
  },

  _onPart: (messageId, part) => {
    const found = findTabByPendingId(get(), messageId)
    if (!found) return
    patchFound(found, (st) => ({
      messages: mapTurn(st, st.pendingResponseId, (t) => upsertPart(t, part)),
    }))
  },

  _onCall: (messageId, metrics) => {
    const found = findTabByPendingId(get(), messageId)
    if (!found) return
    patchFound(found, (st) => ({
      messages: mapTurn(st, st.pendingResponseId, (t) => ({
        ...t,
        metrics: sumTurnMetrics([...(t.metrics?.calls ?? []), metrics]),
      })),
    }))
  },

  _onDone: (messageId, truncated, metrics) => {
    finishTurn(messageId, (t) => ({
      ...t,
      ...(truncated ? { truncated: true } : {}),
      ...(metrics ? { metrics } : {}),
    }))
  },

  _onError: (messageId, error, metrics) => {
    finishTurn(messageId, (t) => ({ ...t, error, ...(metrics ? { metrics } : {}) }), {
      errorMessage: error,
    })
  },

  _onCancelled: (messageId, metrics) => {
    // Keep whatever was streamed so far; just stop streaming state.
    finishTurn(messageId, (t) => ({ ...t, ...(metrics ? { metrics } : {}) }))
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    // Backfill fields added after a snapshot was cached (e.g. customHeaders).
    const target = { ...emptyTabState(), ...(tabStates.get(tabId) ?? {}) }

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
    // The key is not in the snapshot — bring the provider's key back.
    syncLiveKey()
  },

  removeTabState: (tabId) => {
    const state = get()
    // Tab close stops its Send (LLM stream + running tool call + pending
    // questions, issue #180) — the answer has nowhere to go any more.
    const pending =
      state._tabStates.get(tabId)?.pendingMessageId ??
      (state._currentTabId === tabId ? state.pendingMessageId : null)
    if (pending) void window.api?.aiChat?.cancel?.(pending)?.catch?.(() => {})
    // An unsaved AI tab's conversations go with it (a saved request keeps its own).
    if (state._tabStates.has(tabId) || state._currentTabId === tabId) dropTabConversations(tabId)
    const tabStates = new Map(state._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

type FoundTab = NonNullable<ReturnType<typeof findTabByPendingId>>

/** Write a patch into the tab `findTabByPendingId` found (live or cached). */
function patchFound(found: FoundTab, fn: (st: TabAiChatState) => Partial<TabAiChatState>): void {
  const state = useAiChatStore.getState()
  if (found.isLive) {
    useAiChatStore.setState(fn(extractState(state)))
  } else if (found.tabKey !== undefined) {
    const current = state._tabStates.get(found.tabKey) ?? found.snapshot
    const map = new Map(state._tabStates)
    map.set(found.tabKey, { ...current, ...fn(current) })
    useAiChatStore.setState({ _tabStates: map })
  }
}

/**
 * End the pending turn of `messageId` (done / error / cancelled): apply the
 * last change to the assistant turn, leave streaming state, then store the
 * user + assistant turns in the tab's conversation (issue #199).
 */
function finishTurn(
  messageId: string,
  fn: (t: AiAssistantTurn) => AiAssistantTurn,
  extra: Partial<TabAiChatState> = {},
): void {
  const state = useAiChatStore.getState()
  const found = findTabByPendingId(state, messageId)
  if (!found) return
  const turnId = found.snapshot.pendingResponseId
  const tabKey = found.isLive ? liveTabKey(state) : (found.tabKey as string)
  patchFound(found, (st) => ({
    messages: mapTurn(st, turnId, fn),
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    ...extra,
  }))
  const after = readAiTab(tabKey)
  if (!after || !turnId) return
  const idx = after.messages.findIndex((m) => m.id === turnId)
  const assistant = after.messages[idx]
  const user = after.messages[idx - 1]
  if (assistant?.role === 'assistant' && user?.role === 'user') {
    persistFinishedTurn(tabKey, user, assistant)
  }
}

/**
 * What the localStorage snapshot may hold (issue #188): no API key and no
 * credential headers. Both stay usable in memory for the session — switching
 * tabs keeps them — and the key is also in main's encrypted store. The
 * conversation is NOT in the snapshot (issue #199): it lives in the local
 * database and is read back by id — one copy, not two. "Run tools without
 * asking" and the Load-tools catalog are session-only too (issue #180): the
 * approval bypass must not survive a restart, and a catalog written while
 * loading would come back as a spinner that never stops.
 */
export function sanitizeAiTabState(st: TabAiChatState): TabAiChatState {
  return {
    ...st,
    apiKey: '',
    customHeaders: stripCredentialHeaders(st.customHeaders),
    toolServers: savedToolServersOf(st.toolServers ?? []),
    toolCatalog: {},
    autoApproveTools: false,
    messages: [],
    allowedTools: [],
    conversationLoaded: false,
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
  }
}

function tabMapOf(s: AiChatStore): {
  _tabStates: Map<string, TabAiChatState>
  _currentTabId: string | null
} {
  return { _tabStates: s._tabStates, _currentTabId: s._currentTabId }
}

attachTabbedPersist(useAiChatStore, STORAGE_KEY, extractState, tabMapOf, sanitizeAiTabState)

// ─── API keys (issue #188) ──────────────────────────────────
// One key per scope (`aiKeyScope`: provider, or Custom + base URL), kept in
// main encrypted with safeStorage. `sessionKeys` is this session's source of
// truth — what the user typed or main returned — so a tab switch or provider
// change never waits on IPC for a key it already knows, and a key still works
// for the session when encryption is unavailable.

const KEY_WRITE_DEBOUNCE_MS = 500
const sessionKeys = new Map<string, string>()
const pendingWrites = new Map<string, string>()
/**
 * Session keys that were carried, not typed or loaded: scope → the scope the
 * key was really entered for. Lets a carry chain (`https://a` → `https:/` →
 * `https://b`) remember the key came from `https://a`. Memory only.
 */
const keyOrigins = new Map<string, string>()
let writeTimer: ReturnType<typeof setTimeout> | null = null

function noteKeyStorage(encrypted: boolean): void {
  const next: AiKeyStorage = encrypted ? 'encrypted' : 'memory'
  if (useAiChatStore.getState().keyStorage !== next) useAiChatStore.setState({ keyStorage: next })
}

/** Only an explicit `setApiKey` (and the legacy migration) persists a key. */
function schedulePersist(scope: string, key: string): void {
  pendingWrites.set(scope, key)
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => void flushAiKeyWrites(), KEY_WRITE_DEBOUNCE_MS)
}

/** Write every pending key to main now (debounce flush; awaited by tests). */
export async function flushAiKeyWrites(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  const batch = [...pendingWrites]
  pendingWrites.clear()
  for (const [scope, key] of batch) {
    try {
      const res = await window.api?.aiChat?.setKey?.(scope, key)
      if (res?.success && res.data && key) noteKeyStorage(res.data.persisted)
    } catch {
      /* the key still works from memory this session */
    }
  }
}

/** Put the session key for `scope` on the live tab, if it still shows that scope. */
function applyKeyIfLive(scope: string): void {
  const s = useAiChatStore.getState()
  if (aiKeyScope(s.provider, s.customUrl) !== scope) return
  const key = sessionKeys.get(scope) ?? ''
  if (s.apiKey !== key) useAiChatStore.setState({ apiKey: key })
}

interface CarriedKey {
  key: string
  /** The scope the key was typed / loaded for. */
  origin: string
}

async function loadKeyFromMain(scope: string, carry: CarriedKey | undefined): Promise<void> {
  let res: Awaited<ReturnType<NonNullable<Window['api']['aiChat']['getKey']>>> | undefined
  try {
    res = await window.api?.aiChat?.getKey?.(scope)
  } catch {
    return
  }
  if (!res?.success || !res.data) return
  if (!res.data.encryptionAvailable) noteKeyStorage(false)
  else if (res.data.key) noteKeyStorage(true)
  // The user typed a key for this scope while we were asking — theirs wins.
  if (!sessionKeys.has(scope)) {
    if (res.data.key) {
      sessionKeys.set(scope, res.data.key)
      keyOrigins.delete(scope)
    } else if (carry?.key) {
      // In memory only — typing a URL walks through many intermediate
      // origins, and a key the user did not enter for this one is never
      // written under it.
      sessionKeys.set(scope, carry.key)
      keyOrigins.set(scope, carry.origin)
    } else {
      sessionKeys.set(scope, '')
      keyOrigins.delete(scope)
    }
  }
  applyKeyIfLive(scope)
}

/**
 * Show the right key for the live tab's scope: from this session when known,
 * otherwise from main's encrypted store. `clear` blanks the field while main
 * answers (provider / origin change); `carry` is the key a Custom URL edit
 * keeps in memory when the new base URL has none stored (`canCarryAiKey`).
 */
function syncLiveKey(opts: { clear?: boolean; carry?: CarriedKey } = {}): void {
  const s = useAiChatStore.getState()
  const scope = aiKeyScope(s.provider, s.customUrl)
  if (sessionKeys.has(scope)) {
    applyKeyIfLive(scope)
    return
  }
  if (opts.clear && s.apiKey) useAiChatStore.setState({ apiKey: '' })
  void loadKeyFromMain(scope, opts.carry)
}

/**
 * Upgrade path (issue #188): releases before this one wrote the API key in
 * plain text into the `testnizer-ai-chat` snapshot. Move every key found there
 * into main's encrypted store and rewrite the snapshot without it at once —
 * the subscription only rewrites on the next state change. The keys stay in
 * memory for this session either way.
 */
export function migrateLegacyAiKeys(): Promise<void> {
  const raw = loadJson<PersistedTabbed<Partial<TabAiChatState>>>(STORAGE_KEY)
  if (!raw) return Promise.resolve()
  const found = new Map<string, string>()
  const consider = (st: Partial<TabAiChatState> | undefined): void => {
    if (!st || typeof st.apiKey !== 'string' || !st.apiKey) return
    const scope = aiKeyScope(st.provider ?? 'openai', st.customUrl ?? '')
    if (!found.has(scope)) found.set(scope, st.apiKey)
  }
  consider(raw.current)
  for (const entry of raw._tabStates ?? []) consider(entry?.[1])

  for (const [scope, key] of found) if (!sessionKeys.has(scope)) sessionKeys.set(scope, key)
  const writes = [...found].map(async ([scope, key]) => {
    try {
      const res = await window.api?.aiChat?.setKey?.(scope, key)
      if (res?.success && res.data) noteKeyStorage(res.data.persisted)
    } catch {
      /* kept in memory for this session */
    }
  })
  const s = useAiChatStore.getState()
  writeTabbedSnapshot(STORAGE_KEY, extractState(s), tabMapOf(s), sanitizeAiTabState)
  return Promise.all(writes).then(() => undefined)
}

/** Test seam: forget this session's keys and pending writes. */
export function resetAiKeySessionForTests(): void {
  sessionKeys.clear()
  pendingWrites.clear()
  keyOrigins.clear()
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = null
}

// ─── Saved request configuration (issue #187) ───────────────

/** The AI tab's configuration as saved with the request: no key, no conversation. */
export interface SavedAiConfig {
  provider: AiProvider
  customUrl: string
  model: string
  systemPrompt: string
  customHeaders: KeyValuePair[]
  temperature: number | null
  maxTokens: number | null
  /** MCP servers as tools (issue #180) — no literal secrets, never "Run tools without asking". */
  toolServers: AiToolServerConfig[]
}

export function savedAiConfigOf(s: TabAiChatState): SavedAiConfig {
  return {
    provider: s.provider,
    customUrl: s.customUrl,
    model: s.model,
    systemPrompt: s.systemPrompt,
    customHeaders: stripCredentialHeaders(s.customHeaders),
    temperature: isValidTemperature(s.temperature) ? s.temperature : null,
    maxTokens: isValidMaxTokens(s.maxTokens) ? s.maxTokens : null,
    toolServers: savedToolServersOf(s.toolServers ?? []),
  }
}

function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && AI_PROVIDERS.some((p) => p.id === v)
}

function headerRowsOf(raw: unknown): KeyValuePair[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : makeId(),
      key: typeof r.key === 'string' ? r.key : '',
      value: typeof r.value === 'string' ? r.value : '',
      enabled: r.enabled !== false,
    }))
}

/**
 * Put a saved configuration (`savedAiConfigOf`) back on the live tab. Tolerant
 * of partial / older rows; uses `setState`, not the setters — `setProvider`
 * would overwrite the saved URL and model, and a restore is not an edit. The
 * provider's key is then loaded from the session / main.
 */
export function restoreAiConfig(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const c = raw as Record<string, unknown>
  const patch: Partial<TabAiChatState> = {}
  const provider = isAiProvider(c.provider) ? c.provider : undefined
  if (provider) patch.provider = provider
  if (typeof c.customUrl === 'string') patch.customUrl = c.customUrl
  else if (provider) patch.customUrl = resolveDefaultUrl(provider)
  if (typeof c.model === 'string') patch.model = c.model
  if (typeof c.systemPrompt === 'string') patch.systemPrompt = c.systemPrompt
  // Same empty state as a fresh editor (one blank row) when nothing is left —
  // saved `[]`, an older row without headers, or every row a stripped credential.
  const headers = stripCredentialHeaders(headerRowsOf(c.customHeaders))
  patch.customHeaders = headers.length > 0 ? headers : [defaultKv()]
  patch.temperature = isValidTemperature(c.temperature) ? c.temperature : null
  patch.maxTokens = isValidMaxTokens(c.maxTokens) ? c.maxTokens : null
  patch.toolServers = readToolServers(c.toolServers)
  useAiChatStore.setState(patch)
  syncLiveKey({ clear: true })
}

// Upgrade migration first (it seeds the session keys), then load the key for
// the tab restored from the snapshot.
void migrateLegacyAiKeys()
syncLiveKey()
// A key typed just before closing the window must not wait out the debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flushAiKeyWrites())
}

// ─── IPC subscriptions ──────────────────────────────────────
// Subscribe once at module load; the preload bridge multiplexes events to
// every listener, so re-mounting the editor is cheap.

if (typeof window !== 'undefined' && window.api?.aiChat) {
  // Crash leftovers: conversations of unsaved tabs that were not restored.
  // Deferred: this module and ai-chat-conversations import each other — run
  // once both have finished loading (and the tab stores have restored).
  setTimeout(() => pruneOrphanTabConversations(), 0)
  window.api.aiChat.onChunk((event) => {
    const e = event as { messageId: string; delta: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onChunk(e.messageId, e.delta)
  })
  window.api.aiChat.onDone((event) => {
    const e = event as { messageId: string; truncated?: boolean; metrics?: AiTurnMetrics }
    if (!e?.messageId) return
    useAiChatStore.getState()._onDone(e.messageId, e.truncated === true, e.metrics)
  })
  window.api.aiChat.onError((event) => {
    const e = event as { messageId: string; error: string; metrics?: AiTurnMetrics }
    if (!e?.messageId) return
    useAiChatStore.getState()._onError(e.messageId, e.error, e.metrics)
  })
  window.api.aiChat.onCancelled((event) => {
    const e = event as { messageId: string; metrics?: AiTurnMetrics }
    if (!e?.messageId) return
    useAiChatStore.getState()._onCancelled(e.messageId, e.metrics)
  })
  // Tool calls / results / notices and per-call metrics (issues #180, #198).
  window.api.aiChat.onEvent?.((event) => {
    if (!event?.messageId) return
    if (event.kind === 'part') useAiChatStore.getState()._onPart(event.messageId, event.part)
    else if (event.kind === 'call')
      useAiChatStore.getState()._onCall(event.messageId, event.metrics)
  })
}
