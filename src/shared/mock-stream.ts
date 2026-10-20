/**
 * Stream settings of the streaming mock responses (`mock_responses.stream_config`,
 * issue #221) — the single source for the main process (`buildServerDef`,
 * the SSE writer, the LLM encoders, save-time validation) and the renderer
 * (the response editor's stream / LLM rows).
 *
 * `body_type` is the ONE switch that decides what the column means: `'sse'`
 * → `MockSseStreamConfig`, `'llm'` → `MockLlmConfig`. Neither config carries
 * a `kind` of its own (design Ek C C.3-5); each has its own pair of readers.
 *
 * Two readers, on purpose:
 *  - `normalizeStreamConfig` — tolerant: NULL / corrupt JSON / a value of
 *    the wrong type / an out-of-range number reads as the default (or is
 *    clamped). It never throws: a project file from another build must still
 *    serve.
 *  - `validateStreamConfig` — strict, for save time: a human-readable error
 *    string, or null when the value is acceptable. Missing keys are fine
 *    (they take the defaults); unknown keys, wrong types and out-of-range
 *    numbers are errors.
 *
 * Pure and import-free so both bundles can use it.
 */

export type MockSseEndBehaviour = 'close' | 'keep-open'

export interface MockSseStreamConfig {
  /** Wait between two events (ms). 0 = write them back to back. */
  intervalMs: number
  /** Period of the `: keep-alive` comment (ms). 0 = no heartbeat. */
  heartbeatMs: number
  /** Start over when the list is done. */
  loop: boolean
  /**
   * When the list is done (and `loop` is off): `'close'` ends the response;
   * `'keep-open'` keeps the connection open (heartbeats only) until the
   * client leaves or the server stops.
   */
  onEnd: MockSseEndBehaviour
  /**
   * Honour the client's `Last-Event-ID` and continue after that event. Only
   * effective for a finite list (`loop` off) whose `id:` lines are fixed text
   * — an id rendered from `{{stream.seq}}` cannot be found again.
   */
  resume: boolean
}

export const SSE_STREAM_DEFAULTS: Readonly<MockSseStreamConfig> = Object.freeze({
  intervalMs: 1000,
  heartbeatMs: 0,
  loop: false,
  onEnd: 'close',
  resume: true,
})

/** Upper bound of `intervalMs` and `heartbeatMs` (10 minutes). */
export const SSE_MAX_INTERVAL_MS = 600_000

/**
 * A looping stream never writes faster than this: `intervalMs: 0` with
 * `loop` would otherwise be a busy loop that only the socket buffer stops.
 */
export const SSE_MIN_LOOP_INTERVAL_MS = 10

const END_BEHAVIOURS: readonly MockSseEndBehaviour[] = ['close', 'keep-open']

const KEYS: readonly (keyof MockSseStreamConfig)[] = [
  'intervalMs',
  'heartbeatMs',
  'loop',
  'onEnd',
  'resume',
]

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** A stored value may still be JSON text (a raw column read) — parse it. */
function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clampMs(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(SSE_MAX_INTERVAL_MS, Math.max(0, Math.round(v)))
}

/**
 * Tolerant read: anything unusable becomes the default, numbers are clamped
 * to `0..SSE_MAX_INTERVAL_MS`, unknown keys are dropped, and a looping
 * stream's interval is at least `SSE_MIN_LOOP_INTERVAL_MS`. Accepts the
 * parsed object or the raw JSON text. Never throws.
 */
export function normalizeStreamConfig(raw: unknown): MockSseStreamConfig {
  const r = asRecord(parseMaybeJson(raw)) ?? {}
  const loop = typeof r.loop === 'boolean' ? r.loop : SSE_STREAM_DEFAULTS.loop
  let intervalMs = clampMs(r.intervalMs, SSE_STREAM_DEFAULTS.intervalMs)
  if (loop && intervalMs < SSE_MIN_LOOP_INTERVAL_MS) intervalMs = SSE_MIN_LOOP_INTERVAL_MS
  return {
    intervalMs,
    heartbeatMs: clampMs(r.heartbeatMs, SSE_STREAM_DEFAULTS.heartbeatMs),
    loop,
    onEnd: END_BEHAVIOURS.includes(r.onEnd as MockSseEndBehaviour)
      ? (r.onEnd as MockSseEndBehaviour)
      : SSE_STREAM_DEFAULTS.onEnd,
    resume: typeof r.resume === 'boolean' ? r.resume : SSE_STREAM_DEFAULTS.resume,
  }
}

function msError(label: string, v: unknown): string | null {
  if (v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > SSE_MAX_INTERVAL_MS) {
    return `${label} must be a whole number of milliseconds between 0 and ${SSE_MAX_INTERVAL_MS}`
  }
  return null
}

/**
 * Strict save-time check. `null` / `undefined` = unset (defaults) and is
 * valid. Returns the first problem as an English sentence, or null.
 */
export function validateStreamConfig(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const r = asRecord(raw)
  if (!r) return 'Stream settings must be an object'
  for (const k of Object.keys(r)) {
    if (!(KEYS as readonly string[]).includes(k)) return `Unknown stream setting: ${k}`
  }
  const interval = msError('Event interval', r.intervalMs)
  if (interval) return interval
  const heartbeat = msError('Heartbeat interval', r.heartbeatMs)
  if (heartbeat) return heartbeat
  if (r.loop !== undefined && typeof r.loop !== 'boolean') return 'Loop must be true or false'
  if (r.resume !== undefined && typeof r.resume !== 'boolean') {
    return 'Resume must be true or false'
  }
  if (r.onEnd !== undefined && !END_BEHAVIOURS.includes(r.onEnd as MockSseEndBehaviour)) {
    return 'When the events run out, the stream must either close or stay open (onEnd: "close" | "keep-open")'
  }
  return null
}

// ─── AI (`body_type: 'llm'`) ─────────────────────────────────────

/** Wire shape the mock answers in: OpenAI chat completions or Anthropic messages. */
export type MockLlmProvider = 'openai' | 'anthropic'

/**
 * How the assistant text is cut into streamed chunks. `word`: each chunk is
 * a word plus the whitespace after it; `char`: one character (code point)
 * per chunk; `sentence`: up to and including `.`, `!`, `?` (or a line
 * break) and the whitespace after it. Joined back, the chunks are always
 * the original text.
 */
export type MockLlmChunking = 'word' | 'char' | 'sentence'

/**
 * Why the model stopped, in OpenAI terms (Anthropic: `end_turn`,
 * `max_tokens`, `tool_use`). With tool calls the reply always stops with
 * `tool_calls`; `tool_calls` without any tool call is not a valid setting.
 */
export type MockLlmStopReason = 'stop' | 'length' | 'tool_calls'

export interface MockLlmToolCall {
  /** Call id; absent = generated per reply (`call_…` / `toolu_…`). */
  id?: string
  /** Tool name (template). */
  name: string
  /**
   * Arguments: an object (its string values are templates; serialised once
   * with `JSON.stringify`) or JSON text (a template, sent as rendered).
   */
  arguments: string | Record<string, unknown>
}

export interface MockLlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface MockLlmConfig {
  provider: MockLlmProvider
  chunking: MockLlmChunking
  /**
   * Wait between two streamed chunks (ms). The first frame goes out at
   * once; the response's `delayMs` delays the whole reply (headers
   * included) and is the "time to first token" knob.
   */
  chunkIntervalMs: number
  stopReason: MockLlmStopReason
  toolCalls: MockLlmToolCall[]
  /**
   * `'auto'`: an estimate — about one token per 4 characters of the prompt
   * text / of the reply (text + tool calls), at least 1 each; deterministic,
   * not a real tokenizer. Or fixed numbers.
   */
  usage: 'auto' | MockLlmUsage
}

export const LLM_CONFIG_DEFAULTS: Readonly<MockLlmConfig> = Object.freeze({
  provider: 'openai',
  chunking: 'word',
  chunkIntervalMs: 30,
  stopReason: 'stop',
  toolCalls: [],
  usage: 'auto',
})

/** Upper bound of `chunkIntervalMs` (10 s). */
export const LLM_MAX_CHUNK_INTERVAL_MS = 10_000
/** At most this many tool calls per reply. */
export const LLM_MAX_TOOL_CALLS = 16
/** Serialised arguments of one tool call (AI Chat's own tool-result bound). */
export const LLM_MAX_TOOL_ARGUMENT_CHARS = 32_000
/** Upper bound of a fixed usage count. */
export const LLM_MAX_USAGE_TOKENS = 10_000_000

const LLM_PROVIDERS: readonly MockLlmProvider[] = ['openai', 'anthropic']
const LLM_CHUNKINGS: readonly MockLlmChunking[] = ['word', 'char', 'sentence']
const LLM_STOP_REASONS: readonly MockLlmStopReason[] = ['stop', 'length', 'tool_calls']

const LLM_KEYS: readonly (keyof MockLlmConfig)[] = [
  'provider',
  'chunking',
  'chunkIntervalMs',
  'stopReason',
  'toolCalls',
  'usage',
]
const TOOL_CALL_KEYS: readonly (keyof MockLlmToolCall)[] = ['id', 'name', 'arguments']

function argumentsLength(args: unknown): number {
  if (typeof args === 'string') return args.length
  try {
    return JSON.stringify(args)?.length ?? 0
  } catch {
    return Infinity
  }
}

function normalizeToolCall(raw: unknown): MockLlmToolCall | null {
  const r = asRecord(raw)
  if (!r || typeof r.name !== 'string' || r.name.trim() === '') return null
  const args =
    typeof r.arguments === 'string' || asRecord(r.arguments)
      ? (r.arguments as string | Record<string, unknown>)
      : {}
  if (argumentsLength(args) > LLM_MAX_TOOL_ARGUMENT_CHARS) return null
  const call: MockLlmToolCall = { name: r.name, arguments: args }
  if (typeof r.id === 'string' && r.id !== '') call.id = r.id
  return call
}

function usageCount(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(LLM_MAX_USAGE_TOKENS, Math.max(0, Math.round(v)))
}

/**
 * Tolerant read of an `llm` response's settings: NULL / corrupt JSON / a
 * value of the wrong type reads as the default, `chunkIntervalMs` is clamped
 * to `0..LLM_MAX_CHUNK_INTERVAL_MS`, unknown keys and unusable tool calls
 * are dropped (at most `LLM_MAX_TOOL_CALLS` kept), and `stopReason:
 * 'tool_calls'` without a tool call reads as `'stop'`. Accepts the parsed
 * object or the raw JSON text. Never throws.
 */
export function normalizeLlmConfig(raw: unknown): MockLlmConfig {
  const r = asRecord(parseMaybeJson(raw)) ?? {}
  const d = LLM_CONFIG_DEFAULTS
  const interval =
    typeof r.chunkIntervalMs === 'number' && Number.isFinite(r.chunkIntervalMs)
      ? Math.min(LLM_MAX_CHUNK_INTERVAL_MS, Math.max(0, Math.round(r.chunkIntervalMs)))
      : d.chunkIntervalMs
  const toolCalls = (Array.isArray(r.toolCalls) ? r.toolCalls : [])
    .map(normalizeToolCall)
    .filter((c): c is MockLlmToolCall => c !== null)
    .slice(0, LLM_MAX_TOOL_CALLS)
  let stopReason = LLM_STOP_REASONS.includes(r.stopReason as MockLlmStopReason)
    ? (r.stopReason as MockLlmStopReason)
    : d.stopReason
  if (stopReason === 'tool_calls' && toolCalls.length === 0) stopReason = 'stop'
  let usage: MockLlmConfig['usage'] = d.usage
  const u = asRecord(r.usage)
  if (u) {
    const input = usageCount(u.inputTokens)
    const output = usageCount(u.outputTokens)
    if (input !== null && output !== null) usage = { inputTokens: input, outputTokens: output }
  }
  return {
    provider: LLM_PROVIDERS.includes(r.provider as MockLlmProvider)
      ? (r.provider as MockLlmProvider)
      : d.provider,
    chunking: LLM_CHUNKINGS.includes(r.chunking as MockLlmChunking)
      ? (r.chunking as MockLlmChunking)
      : d.chunking,
    chunkIntervalMs: interval,
    stopReason,
    toolCalls,
    usage,
  }
}

function toolCallError(raw: unknown, n: number): string | null {
  const r = asRecord(raw)
  if (!r) return `Tool call ${n} must be an object with a name and arguments`
  for (const k of Object.keys(r)) {
    if (!(TOOL_CALL_KEYS as readonly string[]).includes(k)) {
      return `Tool call ${n}: unknown field ${k}`
    }
  }
  if (typeof r.name !== 'string' || r.name.trim() === '') return `Tool call ${n} needs a name`
  if (r.id !== undefined && (typeof r.id !== 'string' || r.id === '')) {
    return `Tool call ${n}: the id must be non-empty text (or left out to generate one)`
  }
  const args = r.arguments
  if (args !== undefined && typeof args !== 'string' && !asRecord(args)) {
    return `Tool call ${n}: arguments must be a JSON object or JSON text`
  }
  if (argumentsLength(args) > LLM_MAX_TOOL_ARGUMENT_CHARS) {
    return `Tool call ${n}: arguments are longer than ${LLM_MAX_TOOL_ARGUMENT_CHARS} characters`
  }
  // JSON text without a template must already be a JSON object; a template
  // (`{{…}}`) can only be checked once it is rendered.
  if (typeof args === 'string' && !args.includes('{{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(args)
    } catch {
      return `Tool call ${n}: arguments are not valid JSON`
    }
    if (!asRecord(parsed)) return `Tool call ${n}: arguments must be a JSON object`
  }
  return null
}

/**
 * Strict save-time check of an `llm` response's settings. `null` /
 * `undefined` = unset (defaults) and is valid; missing keys take the
 * defaults. Returns the first problem as an English sentence, or null.
 */
export function validateLlmConfig(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const r = asRecord(raw)
  if (!r) return 'LLM settings must be an object'
  for (const k of Object.keys(r)) {
    if (!(LLM_KEYS as readonly string[]).includes(k)) return `Unknown LLM setting: ${k}`
  }
  if (r.provider !== undefined && !LLM_PROVIDERS.includes(r.provider as MockLlmProvider)) {
    return 'Provider must be "openai" or "anthropic"'
  }
  if (r.chunking !== undefined && !LLM_CHUNKINGS.includes(r.chunking as MockLlmChunking)) {
    return 'Chunking must be "word", "char" or "sentence"'
  }
  const ms = r.chunkIntervalMs
  if (
    ms !== undefined &&
    (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > LLM_MAX_CHUNK_INTERVAL_MS)
  ) {
    return `Chunk interval must be a whole number of milliseconds between 0 and ${LLM_MAX_CHUNK_INTERVAL_MS}`
  }
  if (r.stopReason !== undefined && !LLM_STOP_REASONS.includes(r.stopReason as MockLlmStopReason)) {
    return 'Stop reason must be "stop", "length" or "tool_calls"'
  }
  if (r.toolCalls !== undefined) {
    if (!Array.isArray(r.toolCalls)) return 'Tool calls must be a list'
    if (r.toolCalls.length > LLM_MAX_TOOL_CALLS) {
      return `At most ${LLM_MAX_TOOL_CALLS} tool calls per reply`
    }
    for (const [i, call] of r.toolCalls.entries()) {
      const err = toolCallError(call, i + 1)
      if (err) return err
    }
  }
  const calls = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0
  if (r.stopReason === 'tool_calls' && calls === 0) {
    return 'Stop reason "tool_calls" needs at least one tool call'
  }
  if (r.usage !== undefined && r.usage !== 'auto') {
    const u = asRecord(r.usage)
    if (!u) return 'Usage must be "auto" or { inputTokens, outputTokens }'
    for (const k of Object.keys(u)) {
      if (k !== 'inputTokens' && k !== 'outputTokens') return `Unknown usage field: ${k}`
    }
    for (const k of ['inputTokens', 'outputTokens'] as const) {
      const v = u[k]
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > LLM_MAX_USAGE_TOKENS) {
        return `Usage ${k} must be a whole number between 0 and ${LLM_MAX_USAGE_TOKENS}`
      }
    }
  }
  return null
}
