/**
 * Stream settings of an SSE mock response (`mock_responses.stream_config`
 * when `body_type` is `'sse'`, issue #221) — the single source for the main
 * process (`buildServerDef`, the SSE writer, save-time validation) and the
 * renderer (the response editor's stream row).
 *
 * `body_type` is the ONE switch that decides a response streams; this config
 * carries no `kind` of its own (design Ek C C.3-5). The AI (`llm`) settings
 * are a later phase and get their own normalizer next to this one.
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
