/**
 * The ONE SSE writer of the HTTP mock engine (issue #221, design Ek C
 * R03 / R04 / R06 / R08). `server.ts` decides THAT a response streams (and
 * writes its status line + headers); this module owns how the blocks go out.
 *
 * Contract:
 *  - Blocks (`sse-blocks.ts`) are written verbatim after their own render,
 *    each followed by one blank line. The first block goes out right away,
 *    the next ones `intervalMs` apart; a block that renders to nothing is
 *    skipped (it does not count as a frame).
 *  - `seq` is 1-based and counts the frames written on THIS connection
 *    (heartbeats do not count); `iteration` is the 1-based pass over the
 *    list (it grows with `loop`).
 *  - Lifecycle comes from the RESPONSE (`res` `close` / `error`), never from
 *    `req` `close` — that one fires when the request body has been read,
 *    which for a POST is before the stream even starts (R03).
 *  - One idempotent `finish(reason)` serves normal end, client abort, Stop
 *    and write errors: it clears the frame + heartbeat timers and every
 *    listener this module added, and reports the summary exactly once.
 *  - Backpressure (R04): when `res.write()` returns false, nothing more is
 *    produced — no frame, no heartbeat — until `drain` (or the end). A client
 *    that stops reading therefore holds at most one frame in the queue.
 *  - Snapshot (R06): the plan is captured at open; nothing here reads the
 *    server definition again, so a hot reload never changes or closes an
 *    open stream.
 *  - Nothing is written synchronously from `startSseStream`, and the next
 *    block is always scheduled (`setTimeout`, or `setImmediate` for 0 ms), so
 *    a long list never starves the event loop.
 */

import type http from 'node:http'
import type { MockSseStreamConfig } from '../../../shared/mock-stream'
import type { SseBlock } from '../../../shared/mock-sse-blocks'

/** A rendered frame larger than this ends the stream (it is never cut). */
export const SSE_MAX_FRAME_BYTES = 64 * 1024
/** A body with more blocks than this is refused with 503. */
export const SSE_MAX_PLAN_FRAMES = 10_000
/** Open streams per mock server; one more is refused with 503. */
export const SSE_MAX_OPEN_STREAMS = 64
/** Characters of written frames the log entry shows (after masking). */
export const SSE_LOG_PREVIEW_BYTES = 16 * 1024
/**
 * Bytes of written frames the writer keeps for the log: the preview plus a
 * slack, so the log can MASK first and clip after (issue #196's Console
 * rule). Clipping first cut a credential that straddled byte 16 384 in two,
 * and the cut prefix no longer matched the value scrub or the name rule.
 */
export const SSE_LOG_WINDOW_BYTES = SSE_LOG_PREVIEW_BYTES + 64 * 1024
/**
 * When the window itself was cut, its last characters may hold the cut-off
 * (so unrecognisable) start of a secret; that tail is always dropped. Longer
 * than any realistic credential.
 */
export const SSE_LOG_MASK_TAIL = 16 * 1024

/** The heartbeat comment. Clients ignore comment lines. */
export const SSE_HEARTBEAT = ': keep-alive\n\n'

export type SseFinishReason = 'completed' | 'client' | 'stopped' | 'error' | 'frame-too-large'

export interface SseFrameContext {
  /** 1-based number of the frame being rendered on this connection. */
  seq: number
  /** 1-based pass over the list. */
  iteration: number
  /** ISO time of the render. */
  now: string
}

export interface SseStreamPlan {
  /** The FULL list — resume only moves `startIndex`. */
  blocks: readonly SseBlock[]
  startIndex: number
  config: MockSseStreamConfig
  /** Render one block's template (called once per written frame). */
  render: (raw: string, frame: SseFrameContext) => string
}

export interface SseStreamSummary {
  reason: SseFinishReason
  framesSent: number
  startedAt: number
  durationMs: number
  /**
   * The first `SSE_LOG_WINDOW_BYTES` of the written frames, RAW — mask it,
   * then `clipMaskedPreview` it; never show it as it is.
   */
  preview: string
  /** More frames were written than the window holds (the window was cut). */
  previewTruncated: boolean
  error: string | null
}

export interface SseStreamHandle {
  /** Stop the stream (ends the response). Idempotent. */
  close(reason?: SseFinishReason): void
  readonly framesSent: number
  readonly finished: boolean
  /** Bytes queued in the response but not yet handed to the socket. */
  readonly writableLength: number
  /** True while waiting for `drain`. */
  readonly paused: boolean
}

/** Headers every SSE response carries unless the user set them. */
export function sseResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Reverse proxies (nginx) must not buffer the stream.
    'x-accel-buffering': 'no',
  }
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v
  return out
}

/** One server-sent event built by code (the LLM encoders), before framing. */
export interface SseEvent {
  /** `event:` field; absent = the default `message` event. */
  event?: string
  /** `data:` payload; each line of it becomes its own `data:` line. */
  data: string
}

/**
 * The framing of a code-built event, as a writer block (WHATWG: `event:`
 * then one `data:` line per data line; the writer adds the blank line).
 * Producers that build events instead of a body (the LLM encoders) go
 * through here, so the SSE wire format has one owner.
 */
export function sseEventBlock(e: SseEvent): SseBlock {
  const lines: string[] = []
  if (e.event !== undefined) lines.push(`event: ${e.event}`)
  for (const line of e.data.split(/\r\n|\n|\r/)) lines.push(`data: ${line}`)
  return { raw: lines.join('\n'), separator: '\n\n', id: null, dynamicId: false }
}

/** Render every block once, back to back — the body of a non-streamed reply. */
export function renderBlocksOnce(
  blocks: readonly SseBlock[],
  render: SseStreamPlan['render'],
): string {
  let seq = 0
  let out = ''
  for (const b of blocks) {
    const text = safeRender(render, b, {
      seq: seq + 1,
      iteration: 1,
      now: new Date().toISOString(),
    })
    if (text.trim() === '') continue
    seq++
    out += text + b.separator
  }
  return out
}

/**
 * The log preview of a MASKED window: at most `SSE_LOG_PREVIEW_BYTES`
 * characters, ending in `\n…` when anything was left out. `windowCut`: the
 * raw window was cut, so its masked tail may end in a partial secret —
 * `SSE_LOG_MASK_TAIL` characters of it are dropped (`console-logger.ts`
 * `clipBody`). A cut inside a mask (`•••`) leaks nothing: the secret is
 * already gone.
 */
export function clipMaskedPreview(masked: string, windowCut: boolean): string {
  const keep = windowCut
    ? Math.max(0, Math.min(SSE_LOG_PREVIEW_BYTES, masked.length - SSE_LOG_MASK_TAIL))
    : Math.min(SSE_LOG_PREVIEW_BYTES, masked.length)
  if (keep === masked.length) return masked
  // Never end on half a surrogate pair.
  return masked.slice(0, keep).replace(/[\uD800-\uDBFF]$/, '') + '\n…'
}

function safeRender(render: SseStreamPlan['render'], b: SseBlock, f: SseFrameContext): string {
  try {
    return render(b.raw, f).replace(/(?:\r\n|\n|\r)+$/, '')
  } catch {
    return b.raw
  }
}

// ─── Live timer count (test hook) ────────────────────────────────

let liveTimers = 0

/** Number of frame / heartbeat timers currently scheduled by every SSE writer. */
export function sseWriterLiveTimers(): number {
  return liveTimers
}

/**
 * Start writing `plan` to `res`. The status line and headers must already
 * have been written by the caller. `onFinish` runs exactly once, never
 * synchronously from this call.
 */
export function startSseStream(
  res: http.ServerResponse,
  plan: SseStreamPlan,
  onFinish: (summary: SseStreamSummary) => void,
): SseStreamHandle {
  const { blocks, config, render } = plan
  const startedAt = Date.now()
  let cursor = Math.max(0, Math.min(plan.startIndex, blocks.length))
  let iteration = 1
  let framesSent = 0
  let paused = false
  let finished = false
  let listDone = false
  let preview = ''
  let previewBytes = 0
  let previewTruncated = false

  let frameTimer:
    | { kind: 'timeout'; t: NodeJS.Timeout }
    | { kind: 'immediate'; t: NodeJS.Immediate }
    | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null

  const clearFrameTimer = (): void => {
    if (!frameTimer) return
    if (frameTimer.kind === 'timeout') clearTimeout(frameTimer.t)
    else clearImmediate(frameTimer.t)
    frameTimer = null
    liveTimers--
  }

  const scheduleFrame = (ms: number): void => {
    if (finished || frameTimer) return
    liveTimers++
    const fire = (): void => {
      frameTimer = null
      liveTimers--
      tick()
    }
    frameTimer =
      ms > 0
        ? { kind: 'timeout', t: setTimeout(fire, ms) }
        : { kind: 'immediate', t: setImmediate(fire) }
  }

  // The log window (raw): whole frames while they fit, then a cut one.
  const addPreview = (text: string): void => {
    if (previewTruncated) return
    const bytes = Buffer.byteLength(text)
    if (previewBytes + bytes <= SSE_LOG_WINDOW_BYTES) {
      preview += text
      previewBytes += bytes
      return
    }
    const room = SSE_LOG_WINDOW_BYTES - previewBytes
    preview += Buffer.from(text)
      .subarray(0, room)
      .toString('utf8')
      .replace(/\uFFFD$/, '')
    previewBytes = SSE_LOG_WINDOW_BYTES
    previewTruncated = true
  }

  /** Write a chunk; false = the queue is full, stop producing until `drain`. */
  const write = (chunk: string): boolean => {
    if (res.destroyed || res.writableEnded) {
      finish('client')
      return false
    }
    const ok = res.write(chunk)
    if (!ok) paused = true
    return ok
  }

  const onDrain = (): void => {
    if (finished || !paused) return
    paused = false
    if (!listDone) scheduleFrame(config.intervalMs)
  }

  const onClose = (): void => {
    // Ended by us → finish already ran; otherwise the client (or the socket) went away.
    finish(res.writableFinished ? 'completed' : 'client')
  }

  const onError = (e: Error): void => finish('error', e.message)

  let finishError: string | null = null

  function finish(reason: SseFinishReason, error: string | null = null): void {
    if (finished) return
    finished = true
    finishError = error
    clearFrameTimer()
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
      liveTimers--
    }
    res.off('drain', onDrain)
    res.off('close', onClose)
    res.off('error', onError)
    if (!res.writableEnded && !res.destroyed) {
      try {
        if (reason === 'error') res.destroy()
        else res.end()
      } catch {
        /* socket already gone */
      }
    }
    const summary: SseStreamSummary = {
      reason,
      framesSent,
      startedAt,
      durationMs: Date.now() - startedAt,
      preview,
      previewTruncated,
      error: finishError,
    }
    try {
      onFinish(summary)
    } catch {
      /* a logging failure must not break the socket teardown */
    }
  }

  function endOfList(): void {
    listDone = true
    if (config.onEnd === 'close') finish('completed')
    // 'keep-open': nothing more to send; heartbeats (if any) keep running.
  }

  function tick(): void {
    if (finished) return
    if (res.destroyed || res.writableEnded) {
      finish('client')
      return
    }
    if (paused) return // `drain` reschedules
    if (cursor >= blocks.length) {
      if (config.loop && blocks.length > 0) {
        cursor = 0
        iteration++
      } else {
        endOfList()
        return
      }
    }
    const block = blocks[cursor++]
    const text = safeRender(render, block, {
      seq: framesSent + 1,
      iteration,
      now: new Date().toISOString(),
    })
    if (text.trim() === '') {
      scheduleFrame(config.intervalMs)
      return
    }
    const frame = text + block.separator
    if (Buffer.byteLength(frame) > SSE_MAX_FRAME_BYTES) {
      write(`: testnizer mock: event larger than ${SSE_MAX_FRAME_BYTES} bytes, stream closed\n\n`)
      finish('frame-too-large', `An event rendered to more than ${SSE_MAX_FRAME_BYTES} bytes`)
      return
    }
    framesSent++
    addPreview(frame)
    if (!write(frame)) return
    if (cursor >= blocks.length && !config.loop) {
      // Last frame written: end now rather than after another interval.
      endOfList()
      return
    }
    scheduleFrame(config.intervalMs)
  }

  res.on('drain', onDrain)
  res.on('close', onClose)
  res.on('error', onError)

  if (config.heartbeatMs > 0) {
    liveTimers++
    heartbeatTimer = setInterval(() => {
      if (finished || paused) return
      write(SSE_HEARTBEAT)
    }, config.heartbeatMs)
  }
  scheduleFrame(0)

  return {
    close(reason: SseFinishReason = 'stopped') {
      finish(reason)
    },
    get framesSent() {
      return framesSent
    },
    get finished() {
      return finished
    },
    get writableLength() {
      return res.writableLength
    },
    get paused() {
      return paused
    },
  }
}
