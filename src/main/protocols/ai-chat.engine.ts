// src/main/protocols/ai-chat.engine.ts
// AI chat completions engine — supports OpenAI / Anthropic / OpenRouter / custom URL.
//
// Streams Server-Sent Events from the chat completion endpoint and yields
// incremental text deltas. Supports cancellation via AbortSignal.
//
// Renderer never touches the network directly; it talks to ai-chat.handler.ts
// which drives this engine.

import { randomUUID } from 'node:crypto'

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

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** A tool call the model made, as replayed inside the current prompt's loop. */
export interface AiWireToolCall {
  id: string
  /** Wire (namespaced) tool name. */
  name: string
  /** Arguments as the model produced them (may be malformed JSON). */
  argsJson: string
}

export interface AiWireToolResult {
  id: string
  content: string
  isError: boolean
}

/**
 * Provider-neutral transcript entry (issue #180): plain messages, an assistant
 * message that called tools, or the results of those calls. `buildBody`
 * converts it into each provider's native shape.
 */
export type AiWireMessage =
  | AiChatMessage
  | { role: 'assistant'; content: string; toolCalls: AiWireToolCall[] }
  | { role: 'tool'; results: AiWireToolResult[] }

/** A tool offered to the model. */
export interface AiToolDef {
  /** Wire name (`ai-tool-names.ts`). */
  name: string
  description?: string
  /** JSON Schema of the arguments (an object schema). */
  inputSchema?: unknown
}

export interface AiStreamOptions {
  provider: AiProvider
  /** Required when provider === 'custom'; otherwise overrides the default URL. */
  url?: string
  /**
   * Optional (issue #121): the endpoint may be authenticated some other way
   * (user-defined headers, gateway-side key, none). When empty no credential
   * header is emitted at all.
   */
  apiKey?: string
  model: string
  messages: AiWireMessage[]
  /** Tools offered to the model (issue #180). Absent / empty → no `tools` key at all. */
  tools?: AiToolDef[]
  /**
   * User-defined HTTP headers (issue #120). Merged over the provider
   * defaults case-insensitively — a custom `Authorization` replaces the
   * generated Bearer header instead of duplicating it.
   */
  headers?: Record<string, string>
  /** Optional generation knobs forwarded to the provider. */
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface AiStreamChunk {
  /** Incremental text delta for this chunk ('' on a stop-signal chunk). */
  delta: string
  /**
   * The provider stopped because the token limit was reached (Anthropic
   * `stop_reason: 'max_tokens'`, OpenAI-compatible `finish_reason: 'length'`)
   * — the answer is cut off (issue #189).
   */
  truncated?: true
}

/**
 * `max_tokens` sent to Anthropic when the request sets none. The Messages API
 * requires the field (OpenAI-compatible providers do not, so they get none and
 * use their own default). It used to be 1024, which silently cut off ordinary
 * long answers (issue #189); 4096 is accepted by every current Claude model and
 * leaves room for a full answer. Users raise or lower it in the AI Chat
 * Settings section.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096

/** The `max_tokens` actually sent, or `undefined` when the body carries none. */
export function effectiveMaxTokens(provider: AiProvider, maxTokens?: number): number | undefined {
  if (maxTokens !== undefined) return maxTokens
  return provider === 'anthropic' ? ANTHROPIC_DEFAULT_MAX_TOKENS : undefined
}

// ─── URL + body builders (exported for unit testing) ─────────

// Default chat-completions endpoints for each provider. All non-Anthropic
// providers use OpenAI-compatible request/response shapes — we just point at
// each vendor's chat-completions URL.
const PROVIDER_DEFAULT_URLS: Record<Exclude<AiProvider, 'custom'>, string> = {
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

export function resolveProviderUrl(provider: AiProvider, customUrl?: string): string {
  if (provider === 'custom') {
    if (!customUrl || !customUrl.trim()) {
      throw new Error('Custom provider requires a URL')
    }
    return customUrl.trim()
  }
  if (customUrl && customUrl.trim()) {
    // Allow user override even on built-in providers (e.g., Azure OpenAI proxy).
    return customUrl.trim()
  }
  const url = PROVIDER_DEFAULT_URLS[provider]
  if (!url) throw new Error(`Unknown provider: ${provider as string}`)
  return url
}

export function buildHeaders(
  provider: AiProvider,
  apiKey: string | undefined,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const key = (apiKey ?? '').trim()
  if (provider === 'anthropic') {
    // An empty `x-api-key` / `Authorization: Bearer ` is rejected by most
    // gateways and would shadow a user-supplied auth header — only emit the
    // credential when there is one (issue #121).
    if (key) headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  } else if (key) {
    // openai / openrouter / custom — Bearer is the most common pattern
    headers['Authorization'] = `Bearer ${key}`
  }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://testnizer.app'
    headers['X-Title'] = 'Testnizer'
  }
  // User-defined headers win, case-insensitively (issue #120).
  if (extra) {
    for (const [rawKey, value] of Object.entries(extra)) {
      const name = rawKey.trim()
      if (!name) continue
      // Validate up front so a pasted token with a stray newline fails with a
      // message that names the header — fetch's own error would echo the
      // VALUE (the credential) into the UI and the console log.
      try {
        new Headers({ [name]: value })
      } catch {
        throw new Error(
          `Invalid custom header "${name}" (check for line breaks or illegal characters)`,
        )
      }
      for (const existing of Object.keys(headers)) {
        if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing]
      }
      headers[name] = value
    }
  }
  return headers
}

export interface BuildBodyOptions {
  provider: AiProvider
  model: string
  messages: AiWireMessage[]
  tools?: AiToolDef[]
  temperature?: number
  maxTokens?: number
}

/**
 * OpenAI-compatible providers documented to accept
 * `stream_options: { include_usage: true }` (issue #198), checked against each
 * provider's API reference / OpenAPI spec (2026-10): OpenAI, Groq, DeepSeek,
 * xAI, Fireworks and DeepInfra document it; OpenRouter accepts it (no effect,
 * usage is always sent); Google's OpenAI compatibility shows it in its
 * official example. Left OFF: Mistral (its schema has no such field and
 * rejects unknown ones), Cohere, Perplexity, Together and Cerebras (not
 * documented), and Custom (unknown gateway). Usage is still read from the
 * stream when a provider sends it unasked.
 */
export const STREAM_USAGE_PROVIDERS: ReadonlySet<AiProvider> = new Set<AiProvider>([
  'openai',
  'openrouter',
  'groq',
  'deepseek',
  'xai',
  'fireworks',
  'deepinfra',
  'google',
])

export function acceptsStreamUsageOption(provider: AiProvider): boolean {
  return STREAM_USAGE_PROVIDERS.has(provider)
}

const isWireAssistantWithTools = (
  m: AiWireMessage,
): m is { role: 'assistant'; content: string; toolCalls: AiWireToolCall[] } =>
  m.role === 'assistant' && 'toolCalls' in m

const isWireToolResults = (m: AiWireMessage): m is { role: 'tool'; results: AiWireToolResult[] } =>
  m.role === 'tool'

/** The arguments object of a replayed call: parsed JSON object, or `{}` when malformed. */
export function argsObjectOf(argsJson: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(argsJson || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** An object JSON Schema for a tool's arguments (MCP tools may omit or mis-shape it). */
export function toolParametersOf(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const s = schema as Record<string, unknown>
    if (s.type === 'object' || s.type === undefined) {
      return { ...s, type: 'object', properties: s.properties ?? {} }
    }
  }
  return { type: 'object', properties: {} }
}

/**
 * The Gemini API's `Schema` — the OpenAPI subset its function declarations
 * accept (ai.google.dev/api/generate-content#Schema, checked 2026-10). The
 * OpenAI compatibility endpoint rejects tool parameters carrying other JSON
 * Schema keywords (`$schema`, `additionalProperties`, `$ref`/`$defs`,
 * `const`, `patternProperties`, `exclusiveMinimum`… — "Invalid JSON payload
 * received. Unknown name …"), and MCP servers emit exactly those (zod /
 * pydantic generators add `$schema` and `additionalProperties: false`).
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'minLength',
  'maxLength',
  'pattern',
  'example',
  'anyOf',
  'propertyOrdering',
  'default',
  'items',
  'minimum',
  'maximum',
])

/**
 * A tool's argument schema reduced to what Gemini accepts (google provider
 * only): unknown keywords dropped at every level (properties, items, anyOf);
 * `type: ['x', 'null']` → `type: 'x', nullable: true`; `const: v` →
 * `enum: [v]`. Depth-capped like the MCP schema walkers.
 */
export function geminiToolSchema(schema: unknown, depth = 0): unknown {
  if (depth > 24 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const src = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([name, sub]) => [
          name,
          geminiToolSchema(sub, depth + 1),
        ]),
      )
    } else if (k === 'items') {
      out.items = geminiToolSchema(v, depth + 1)
    } else if (k === 'anyOf' && Array.isArray(v)) {
      out.anyOf = v.map((sub) => geminiToolSchema(sub, depth + 1))
    } else {
      out[k] = v
    }
  }
  if (Array.isArray(src.type)) {
    const types = src.type.filter((t) => t !== 'null')
    if (types.length > 0) out.type = types[0]
    else delete out.type
    if (types.length !== src.type.length) out.nullable = true
  }
  if ('const' in src && !('enum' in out)) out.enum = [src.const]
  return out
}

function anthropicMessages(messages: AiWireMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (isWireToolResults(m)) {
      // All results of one round in ONE user message.
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      })
      continue
    }
    if (isWireAssistantWithTools(m)) {
      const blocks: Array<Record<string, unknown>> = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: argsObjectOf(c.argsJson) })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function openAiMessages(messages: AiWireMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (isWireToolResults(m)) {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content })
      continue
    }
    if (isWireAssistantWithTools(m)) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          // Malformed arguments are replayed as `{}` — some gateways parse them.
          function: { name: c.name, arguments: JSON.stringify(argsObjectOf(c.argsJson)) },
        })),
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

export function buildBody(opts: BuildBodyOptions): Record<string, unknown> {
  const { provider, model, messages, temperature, maxTokens } = opts
  const tools = opts.tools ?? []

  if (provider === 'anthropic') {
    // Anthropic puts system prompt at the top level rather than in messages[].
    const system = messages
      .filter((m): m is AiChatMessage => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages(messages),
      stream: true,
      max_tokens: effectiveMaxTokens(provider, maxTokens),
    }
    if (system.length > 0) body.system = system
    if (temperature !== undefined) body.temperature = temperature
    // No `tools` key at all when none are offered (MST-153).
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        input_schema: toolParametersOf(t.inputSchema),
      }))
    }
    return body
  }

  // OpenAI / OpenRouter / custom — OpenAI-compatible chat completions
  const body: Record<string, unknown> = {
    model,
    messages: openAiMessages(messages),
    stream: true,
  }
  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  if (acceptsStreamUsageOption(provider)) body.stream_options = { include_usage: true }
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        // Gemini's OpenAI compatibility takes only its OpenAPI subset.
        parameters:
          provider === 'google'
            ? geminiToolSchema(toolParametersOf(t.inputSchema))
            : toolParametersOf(t.inputSchema),
      },
    }))
  }
  return body
}

// ─── SSE chunk parser ───────────────────────────────────────

/**
 * Extract the text delta from a single parsed `data: {...}` SSE payload.
 * Returns an empty string if the chunk has no textual delta (e.g., role-only
 * frames, ping events, end-of-stream markers).
 */
export function extractDelta(provider: AiProvider, parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const obj = parsed as Record<string, unknown>

  if (provider === 'anthropic') {
    // Anthropic: { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
    if (obj.type === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (delta && typeof delta.text === 'string') return delta.text
    }
    return ''
  }

  // OpenAI-compatible: { choices: [{ delta: { content: '...' } }] }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0]
    const delta = choice.delta as Record<string, unknown> | undefined
    if (delta && typeof delta.content === 'string') return delta.content
    // Some providers send `text` instead of `delta.content` when stream=false
    if (typeof choice.text === 'string') return choice.text
  }
  return ''
}

/**
 * Did this parsed SSE payload report that generation stopped at the token
 * limit? Anthropic: `{type:'message_delta', delta:{stop_reason:'max_tokens'}}`.
 * OpenAI-compatible: `{choices:[{finish_reason:'length'}]}` (sent before
 * `[DONE]`).
 */
export function isTruncationEvent(provider: AiProvider, parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as Record<string, unknown>
  if (provider === 'anthropic') {
    if (obj.type !== 'message_delta') return false
    const delta = obj.delta as Record<string, unknown> | undefined
    return delta?.stop_reason === 'max_tokens'
  }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined
  return Array.isArray(choices) && choices.some((c) => c?.finish_reason === 'length')
}

// ─── Streaming driver ───────────────────────────────────────

const DONE_TOKEN = '[DONE]'

/** An LLM call that got an HTTP error status (metrics keep the status, issue #198). */
export class AiHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiHttpError'
    this.status = status
  }
}

/** Token usage of one LLM call, as the provider reported it. */
export interface AiUsage {
  /** Whole prompt (Anthropic: input + cache read + cache creation). */
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
}

/** A tool call assembled from the stream's fragments. */
export interface AiParsedToolCall {
  id: string
  /** Wire name as the model sent it. */
  name: string
  /** Joined argument fragments — NOT validated here (malformed JSON is the loop's job). */
  argsJson: string
}

export interface AiRoundSummary {
  toolCalls: AiParsedToolCall[]
  usage: AiUsage | null
  stopReason: string | null
  /** `Date.now()` of the first event carrying text or a tool-call fragment; null when none. */
  firstContentAt: number | null
  /** HTTP status of the response. */
  status: number
}

export type AiRoundEvent =
  | { type: 'text'; delta: string }
  | { type: 'truncated' }
  | ({ type: 'end' } & AiRoundSummary)

const numOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const recOf = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

interface ToolCallDraft {
  id: string
  name: string
  args: string
  /** The provider sent no id (yet) — ours is a placeholder. */
  generated: boolean
  /** Anthropic `content_block_start` input, used when no `input_json_delta` came. */
  initialInput?: unknown
}

/**
 * Folds one LLM call's parsed SSE payloads into text deltas, tool calls,
 * usage and the stop reason (issues #180 / #198).
 *
 * OpenAI-compatible: `choices[0].delta.tool_calls[]` fragments keyed by
 * `index` (id + name arrive once, `arguments` are concatenated). Some
 * compatible endpoints omit `index` — then a fragment with a NEW id opens a
 * call and one without an id continues the last. Arguments sent as an object
 * (seen on some gateways) are stringified. Usage: the last `usage` object
 * (the `include_usage` chunk has `choices: []`), or Groq's `x_groq.usage` —
 * last value wins, never summed (some providers repeat a running total).
 *
 * Anthropic: `content_block_start` (`tool_use` id/name) + `input_json_delta`
 * `partial_json` per block index; usage from `message_start.message.usage`,
 * then `message_delta.usage` (`output_tokens` there is cumulative).
 */
export class StreamRoundParser {
  private readonly provider: AiProvider
  private readonly calls: ToolCallDraft[] = []
  private readonly byIndex = new Map<number, ToolCallDraft>()
  private usage: AiUsage = {}
  private usageSeen = false
  private stop: string | null = null

  constructor(provider: AiProvider) {
    this.provider = provider
  }

  /** Feed one parsed payload; returns its text delta and whether it carried content. */
  feed(parsed: unknown): { delta: string; truncated: boolean; content: boolean } {
    const obj = recOf(parsed)
    if (!obj) return { delta: '', truncated: false, content: false }
    const delta = extractDelta(this.provider, parsed)
    const truncated = isTruncationEvent(this.provider, parsed)
    const toolFragment =
      this.provider === 'anthropic' ? this.feedAnthropic(obj) : this.feedOpenAi(obj)
    return { delta, truncated, content: delta.length > 0 || toolFragment }
  }

  private newCall(id: unknown, name: unknown): ToolCallDraft {
    const real = typeof id === 'string' && id.length > 0
    const draft: ToolCallDraft = {
      id: real ? id : `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      name: typeof name === 'string' ? name : '',
      args: '',
      generated: !real,
    }
    this.calls.push(draft)
    return draft
  }

  private feedAnthropic(obj: Record<string, unknown>): boolean {
    const index = numOf(obj.index)
    if (obj.type === 'message_start') {
      this.takeAnthropicUsage(recOf(recOf(obj.message)?.usage))
      return false
    }
    if (obj.type === 'message_delta') {
      const stop = recOf(obj.delta)?.stop_reason
      if (typeof stop === 'string') this.stop = stop
      this.takeAnthropicUsage(recOf(obj.usage))
      return false
    }
    if (obj.type === 'content_block_start' && index !== undefined) {
      const block = recOf(obj.content_block)
      if (block?.type === 'tool_use') {
        const draft = this.newCall(block.id, block.name)
        draft.initialInput = block.input
        this.byIndex.set(index, draft)
        return true
      }
      return false
    }
    if (obj.type === 'content_block_delta' && index !== undefined) {
      const d = recOf(obj.delta)
      if (d?.type === 'input_json_delta') {
        const draft = this.byIndex.get(index)
        if (draft && typeof d.partial_json === 'string') draft.args += d.partial_json
        return true
      }
    }
    return false
  }

  private takeAnthropicUsage(u: Record<string, unknown> | undefined): void {
    if (!u) return
    const input = numOf(u.input_tokens)
    const read = numOf(u.cache_read_input_tokens)
    const created = numOf(u.cache_creation_input_tokens)
    if (input !== undefined) {
      this.usage.inputTokens = input + (read ?? 0) + (created ?? 0)
      this.usageSeen = true
    }
    if (read !== undefined) this.usage.cachedTokens = read
    const output = numOf(u.output_tokens)
    if (output !== undefined) {
      this.usage.outputTokens = output
      this.usageSeen = true
    }
  }

  private feedOpenAi(obj: Record<string, unknown>): boolean {
    const usage = recOf(obj.usage) ?? recOf(recOf(obj.x_groq)?.usage)
    if (usage) this.takeOpenAiUsage(usage)
    const choices = Array.isArray(obj.choices) ? obj.choices : []
    const choice = recOf(choices[0])
    if (!choice) return false
    if (typeof choice.finish_reason === 'string') this.stop = choice.finish_reason
    // Some providers put per-choice usage on the finish chunk.
    const choiceUsage = recOf(choice.usage)
    if (choiceUsage && !usage) this.takeOpenAiUsage(choiceUsage)
    const delta = recOf(choice.delta) ?? recOf(choice.message)
    const fragments = Array.isArray(delta?.tool_calls) ? delta.tool_calls : []
    let any = false
    for (const raw of fragments) {
      const frag = recOf(raw)
      if (!frag) continue
      any = true
      const fn = recOf(frag.function)
      const index = numOf(frag.index)
      const fragId = typeof frag.id === 'string' && frag.id ? frag.id : undefined
      let draft: ToolCallDraft | undefined
      if (index !== undefined) {
        draft = this.byIndex.get(index)
        // Same index, a different id → a new call (some gateways reuse index 0).
        if (draft && fragId && draft.id !== fragId && draft.args.length > 0) draft = undefined
        if (!draft) {
          draft = this.newCall(fragId, fn?.name)
          this.byIndex.set(index, draft)
        }
      } else if (fragId) {
        draft = this.calls.find((c) => c.id === fragId) ?? this.newCall(fragId, fn?.name)
      } else {
        draft = this.calls[this.calls.length - 1] ?? this.newCall(undefined, fn?.name)
      }
      // The id arrived after the call was opened without one.
      if (fragId && draft.generated) {
        draft.id = fragId
        draft.generated = false
      }
      if (!draft.name && typeof fn?.name === 'string') draft.name = fn.name
      const args = fn?.arguments
      if (typeof args === 'string') draft.args += args
      else if (args && typeof args === 'object') draft.args += JSON.stringify(args)
    }
    return any
  }

  private takeOpenAiUsage(u: Record<string, unknown>): void {
    const input = numOf(u.prompt_tokens) ?? numOf(u.input_tokens)
    const output = numOf(u.completion_tokens) ?? numOf(u.output_tokens)
    if (input === undefined && output === undefined) return
    this.usageSeen = true
    if (input !== undefined) this.usage.inputTokens = input
    if (output !== undefined) this.usage.outputTokens = output
    const cached = numOf(recOf(u.prompt_tokens_details)?.cached_tokens)
    if (cached !== undefined) this.usage.cachedTokens = cached
    const reasoning = numOf(recOf(u.completion_tokens_details)?.reasoning_tokens)
    if (reasoning !== undefined) this.usage.reasoningTokens = reasoning
  }

  /** Tool calls with a name, in the order the model opened them. */
  toolCalls(): AiParsedToolCall[] {
    return this.calls
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id,
        name: c.name,
        argsJson:
          c.args.length > 0
            ? c.args
            : c.initialInput && typeof c.initialInput === 'object'
              ? JSON.stringify(c.initialInput)
              : '{}',
      }))
  }

  usageOrNull(): AiUsage | null {
    return this.usageSeen ? { ...this.usage } : null
  }

  stopReason(): string | null {
    return this.stop
  }
}

/** Non-2xx response → `AiHttpError` with a status-aware hint and the upstream body. */
async function httpError(response: Response): Promise<AiHttpError> {
  // Surface a status-aware hint so common provider failures (bad key, rate
  // limit, missing model) are immediately actionable instead of just
  // showing the bare HTTP code. Keep the upstream body too — providers
  // frequently include {error: {message: "..."}} JSON that helps diagnose.
  const { hintForHttpStatus } = await import('../lib/error-classifier')
  const hint = hintForHttpStatus(response.status)
  let errText = hint
    ? `HTTP ${response.status} ${hint}`
    : `HTTP ${response.status} ${response.statusText}`
  try {
    const text = await response.text()
    if (text) errText += `\n${text.slice(0, 500)}`
  } catch {
    /* ignore */
  }
  return new AiHttpError(response.status, errText)
}

/**
 * One LLM call (issue #180): text deltas and truncation as they arrive, then
 * one `end` event with the assembled tool calls, usage, stop reason, the
 * time of the first content event and the HTTP status. Throws `AiHttpError`
 * on a non-2xx response; an abort rejects like `fetch` does.
 */
export async function* streamChatRound(
  options: AiStreamOptions,
): AsyncGenerator<AiRoundEvent, void, void> {
  const { provider, url, apiKey, model, messages, temperature, maxTokens, signal } = options

  const endpoint = resolveProviderUrl(provider, url)
  const headers = buildHeaders(provider, apiKey, options.headers)
  const body = buildBody({
    provider,
    model,
    messages,
    tools: options.tools,
    temperature,
    maxTokens,
  })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok || !response.body) throw await httpError(response)

  const parser = new StreamRoundParser(provider)
  let firstContentAt: number | null = null
  const end = (): AiRoundEvent => ({
    type: 'end',
    toolCalls: parser.toolCalls(),
    usage: parser.usageOrNull(),
    stopReason: parser.stopReason(),
    firstContentAt,
    status: response.status,
  })

  // Read the stream, splitting on SSE event boundaries (\n\n).
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let sepIdx = buffer.indexOf('\n\n')
      while (sepIdx !== -1) {
        const rawEvent = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        sepIdx = buffer.indexOf('\n\n')

        // Each event is one or more lines; we only care about `data: ...`
        const dataLines: string[] = []
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
        if (dataLines.length === 0) continue
        const dataText = dataLines.join('\n').trim()
        if (!dataText) continue
        if (dataText === DONE_TOKEN) {
          yield end()
          return
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(dataText)
        } catch {
          // Anthropic sometimes sends non-JSON `event:` lines we already filtered;
          // skip anything that isn't valid JSON.
          continue
        }

        const fed = parser.feed(parsed)
        if (fed.content && firstContentAt === null) firstContentAt = Date.now()
        if (fed.delta) yield { type: 'text', delta: fed.delta }
        // A stop signal may ride on its own frame with no text — yield it
        // anyway so the caller can flag the answer as cut off.
        if (fed.truncated) yield { type: 'truncated' }
      }
    }
    yield end()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stream a chat completion, yielding text deltas as they arrive (the
 * text-only view of `streamChatRound`).
 *
 * Caller is responsible for accumulating the deltas; this generator only emits
 * deltas, not the running total.
 */
export async function* streamChatCompletion(
  options: AiStreamOptions,
): AsyncGenerator<AiStreamChunk, void, void> {
  for await (const ev of streamChatRound(options)) {
    if (ev.type === 'text') yield { delta: ev.delta }
    else if (ev.type === 'truncated') yield { delta: '', truncated: true }
  }
}
