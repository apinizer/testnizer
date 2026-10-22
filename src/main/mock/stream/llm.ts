/**
 * The AI (`bodyType: 'llm'`) reply of the HTTP mock engine (issue #221,
 * design §6.3.4 / §6.6.2 / Ek D §D.3.5): request → "completion plan" →
 * provider wire shape. `server.ts` still decides THAT a response is an LLM
 * reply and how it goes out; this module only builds it.
 *
 *  - `readLlmRequest` reads `stream`, `model`, `stream_options` and the
 *    prompt text from the raw body (any content type — a cURL call without
 *    a JSON header is still a chat request), or answers the
 *    provider-shaped 400 a real API gives for a body it cannot read.
 *  - `buildLlmPlan` renders the tool calls (name and arguments are
 *    templates; object arguments are serialised ONCE, after their string
 *    values are rendered — no JSON is ever assembled inside a template),
 *    derives the stop reason and the usage numbers.
 *  - `encodeLlmJson` / `encodeLlmEvents` turn a plan into the non-streamed
 *    JSON body or the list of server-sent events. Framing of those events
 *    belongs to the SSE writer (`sseEventBlock`).
 *
 * Request fields such as `temperature`, `max_tokens`, `n` or the `tools`
 * schemas are ignored: the reply comes from the mock's definition; only
 * `model` is reflected (an empty one reads as `mock-model`).
 */
import { randomUUID } from 'node:crypto'
import {
  LLM_DEFAULT_STOP_SEQUENCE,
  LLM_STREAM_ERROR_DEFAULTS,
  stopReasonFor,
  type MockLlmConfig,
  type MockLlmProvider,
  type MockLlmStopReason,
  type MockLlmUsage,
} from '../../../shared/mock-stream'
import type { SseEvent } from './sse-writer'
import { openAiCompletion, openAiEvents } from './llm-openai'
import { anthropicEvents, anthropicMessage } from './llm-anthropic'
import { argumentPieceCount, countChunks } from './chunking'

export const LLM_DEFAULT_MODEL = 'mock-model'

export interface LlmRequest {
  /** The request's `stream === true`. */
  stream: boolean
  model: string
  /** OpenAI `stream_options.include_usage === true` (always false for Anthropic). */
  includeUsage: boolean
  /** Characters of the prompt's text (system + messages), for the usage estimate. */
  promptChars: number
}

/** A plain (non-streamed) reply: status + JSON body. */
export interface LlmPlainReply {
  status: number
  body: string
}

export type LlmResult<T> = { ok: true; value: T } | { ok: false; reply: LlmPlainReply }

export interface LlmPlanToolCall {
  id: string
  name: string
  /** Arguments as JSON text, exactly as streamed / returned (OpenAI wire value). */
  arguments: string
  /** Anthropic `input`: the arguments parsed as an object. */
  input: Record<string, unknown>
}

export interface LlmPlan {
  provider: MockLlmProvider
  /** `chatcmpl-…` / `msg_…`. */
  id: string
  /** Unix seconds (OpenAI `created`). */
  created: number
  model: string
  text: string
  toolCalls: LlmPlanToolCall[]
  /** `tool_calls` whenever there are tool calls. */
  stopReason: MockLlmStopReason
  usage: MockLlmUsage
  includeUsage: boolean
  chunking: MockLlmConfig['chunking']
  /** `fixed` chunking's size (undefined = the default). */
  chunkSize?: number
  /** Anthropic `stop_sequence` (the matched sequence) when the stop reason is `stop_sequence`, else null. */
  stopSequence: string | null
  /** Mid-stream error with the provider defaults filled in; null = none. */
  streamError: { afterChunks: number; type: string; message: string } | null
}

/**
 * One event of an encoded stream, as the encoders build it: `content`
 * marks a chunk of model output (a text piece, a tool-call argument piece),
 * `finish` the closing events (the finish / usage / `[DONE]` chunks,
 * `message_delta` / `message_stop`) — what a mid-stream error cuts at.
 */
export interface LlmEvent extends SseEvent {
  content?: true
  finish?: true
  /** The text piece a `content` event carries (for the log of a cut reply). */
  text?: string
}

/** Id + clock source; tests pass fixed ones. */
export interface LlmIds {
  newId(prefix: string): string
  nowSeconds(): number
}

export const DEFAULT_LLM_IDS: LlmIds = {
  newId: (prefix) => `${prefix}${randomUUID().replace(/-/g, '').slice(0, 24)}`,
  nowSeconds: () => Math.floor(Date.now() / 1000),
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** A provider's error envelope (`{error:{…}}` / `{type:'error', error:{…}}`). */
export function llmErrorBody(provider: MockLlmProvider, type: string, message: string): string {
  return provider === 'anthropic'
    ? JSON.stringify({ type: 'error', error: { type, message } })
    : JSON.stringify({ error: { message, type, param: null, code: null } })
}

function badRequest(provider: MockLlmProvider, message: string): LlmResult<never> {
  return {
    ok: false,
    reply: { status: 400, body: llmErrorBody(provider, 'invalid_request_error', message) },
  }
}

/** Length of the text a message `content` (or `system`) carries. */
function textChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const part of content) {
    const p = asRecord(part)
    if (!p) continue
    if (typeof p.text === 'string') n += p.text.length
    // Anthropic tool_result blocks nest their own content.
    if (p.type === 'tool_result') n += textChars(p.content)
  }
  return n
}

/** Read the parts of a chat request the mock uses, or the provider's 400. */
export function readLlmRequest(provider: MockLlmProvider, bodyText: string): LlmResult<LlmRequest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return badRequest(
      provider,
      provider === 'anthropic'
        ? 'The request body is not valid JSON'
        : 'We could not parse the JSON body of your request. The request body must be a JSON object.',
    )
  }
  const req = asRecord(parsed)
  if (!req) return badRequest(provider, 'The request body must be a JSON object')
  if (!Array.isArray(req.messages)) {
    return badRequest(
      provider,
      provider === 'anthropic' ? 'messages: Field required' : "'messages' is a required property",
    )
  }
  let promptChars = textChars(req.system)
  for (const m of req.messages) promptChars += textChars(asRecord(m)?.content)
  return {
    ok: true,
    value: {
      stream: req.stream === true,
      model: typeof req.model === 'string' && req.model !== '' ? req.model : LLM_DEFAULT_MODEL,
      includeUsage: provider === 'openai' && asRecord(req.stream_options)?.include_usage === true,
      promptChars,
    },
  }
}

/** Render every string value of an arguments object (keys stay as written). */
function renderValues(v: unknown, render: (s: string) => string): unknown {
  if (typeof v === 'string') return render(v)
  if (Array.isArray(v)) return v.map((x) => renderValues(x, render))
  const r = asRecord(v)
  if (!r) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(r)) out[k] = renderValues(x, render)
  return out
}

/** Tokens estimated from characters (≈ 4 per token), at least 1. */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

/**
 * The reply to build. `text` is the rendered (and scripted) body; `render`
 * renders one template string against the request context.
 *
 * A tool call whose rendered JSON-text arguments are not a JSON object is
 * served as written on the OpenAI wire (its `arguments` is text — a client's
 * malformed-arguments path can be tested), but cannot be an Anthropic
 * `input` object: the reply is then a provider-shaped 500 naming the call.
 */
export function buildLlmPlan(
  config: MockLlmConfig,
  request: LlmRequest,
  text: string,
  render: (s: string) => string,
  ids: LlmIds = DEFAULT_LLM_IDS,
): LlmResult<LlmPlan> {
  const provider = config.provider
  const toolCalls: LlmPlanToolCall[] = []
  for (const call of config.toolCalls) {
    const name = render(call.name)
    let args: string
    let input: Record<string, unknown> | null
    if (typeof call.arguments === 'string') {
      args = render(call.arguments)
      try {
        input = asRecord(JSON.parse(args))
      } catch {
        input = null
      }
    } else {
      const rendered = renderValues(call.arguments, render) as Record<string, unknown>
      args = JSON.stringify(rendered)
      input = rendered
    }
    if (input === null && provider === 'anthropic') {
      return {
        ok: false,
        reply: {
          status: 500,
          body: llmErrorBody(
            provider,
            'api_error',
            `Mock tool call "${name}": the arguments did not render to a JSON object`,
          ),
        },
      }
    }
    toolCalls.push({
      id: call.id ? render(call.id) : ids.newId(provider === 'anthropic' ? 'toolu_' : 'call_'),
      name,
      arguments: args,
      input: input ?? {},
    })
  }
  const outputChars = toolCalls.reduce(
    (n, c) => n + c.name.length + c.arguments.length,
    text.length,
  )
  // Tool calls always stop with tool_calls; otherwise the configured reason, as
  // this provider can say it (stop_sequence on OpenAI is `stop`).
  const stopReason: MockLlmStopReason =
    toolCalls.length > 0
      ? 'tool_calls'
      : config.stopReason === 'tool_calls'
        ? 'stop'
        : stopReasonFor(provider, config.stopReason)
  const usage: MockLlmUsage =
    config.usage === 'auto'
      ? {
          inputTokens: estimateTokens(request.promptChars),
          outputTokens: estimateTokens(outputChars),
        }
      : { ...config.usage }
  return {
    ok: true,
    value: {
      provider,
      id: ids.newId(provider === 'anthropic' ? 'msg_' : 'chatcmpl-'),
      created: ids.nowSeconds(),
      model: request.model,
      text,
      toolCalls,
      stopReason,
      usage,
      includeUsage: request.includeUsage,
      chunking: config.chunking,
      ...(config.chunkSize !== undefined ? { chunkSize: config.chunkSize } : {}),
      stopSequence:
        provider === 'anthropic' && stopReason === 'stop_sequence'
          ? (config.stopSequence ?? LLM_DEFAULT_STOP_SEQUENCE)
          : null,
      streamError: config.streamError
        ? {
            afterChunks: config.streamError.afterChunks,
            type: config.streamError.type || LLM_STREAM_ERROR_DEFAULTS[provider].type,
            message: config.streamError.message || LLM_STREAM_ERROR_DEFAULTS[provider].message,
          }
        : null,
    },
  }
}

/** The non-streamed reply body (`chat.completion` / `message`). */
export function encodeLlmJson(plan: LlmPlan): string {
  return JSON.stringify(
    plan.provider === 'anthropic' ? anthropicMessage(plan) : openAiCompletion(plan),
  )
}

/** The streamed reply as server-sent events, in order (the whole reply — no mid-stream error). */
export function encodeLlmEvents(plan: LlmPlan): LlmEvent[] {
  return plan.provider === 'anthropic' ? anthropicEvents(plan) : openAiEvents(plan)
}

/**
 * A provider's mid-stream error event — the shapes each official SDK raises
 * on:
 *  - OpenAI: an unnamed event whose data is `{"error": {…}}` (openai-python
 *    `_streaming.py`: `if is_mapping(data) and data.get("error"): raise
 *    APIError`; OpenAI does not document the shape itself — the SDK is the
 *    contract);
 *  - Anthropic: `event: error` + `{"type":"error","error":{type, message}}`
 *    (streaming docs, "Error events"; anthropic-sdk-typescript
 *    `core/streaming.ts`: `if (sse.event === 'error') throw new APIError`).
 */
export function llmStreamErrorEvent(
  provider: MockLlmProvider,
  error: { type: string; message: string },
): SseEvent {
  const data = llmErrorBody(provider, error.type, error.message)
  return provider === 'anthropic' ? { event: 'error', data } : { data }
}

export interface LlmStream {
  /** Events to stream before the error (all of them when there is none). */
  events: SseEvent[]
  /** The error event that ends the stream, or null. */
  error: SseEvent | null
  /** Chunks of output sent before the error. */
  chunksSent: number
  /** The text pieces sent before the error, joined. */
  textSent: string
}

/**
 * The streamed reply with its mid-stream error applied: the events up to
 * (not including) the chunk after `afterChunks` chunks of output — or up to
 * the first closing event when the reply has fewer — then the error. The
 * preamble (role chunk; `message_start` / `content_block_start` / `ping`)
 * always goes out, so `afterChunks: 0` is "an error before any output".
 */
export function encodeLlmStream(plan: LlmPlan): LlmStream {
  const all = encodeLlmEvents(plan)
  const err = plan.streamError
  if (!err) return { events: all, error: null, chunksSent: 0, textSent: '' }
  const events: SseEvent[] = []
  let chunksSent = 0
  let textSent = ''
  for (const ev of all) {
    if (ev.finish || (ev.content && chunksSent === err.afterChunks)) break
    events.push(ev)
    if (ev.content) {
      chunksSent++
      textSent += ev.text ?? ''
    }
  }
  return { events, error: llmStreamErrorEvent(plan.provider, err), chunksSent, textSent }
}

/**
 * `encodeLlmEvents(plan).length`, without encoding — the stream's frame
 * count, checked against the writer's plan limit BEFORE anything is built.
 * Counting the text chunks stops past `limit`: the result is then some
 * number above it. Mirrors the event lists of `llm-openai.ts` /
 * `llm-anthropic.ts` (golden-tested against them). A mid-stream error only
 * shortens the stream (it replaces at least two closing events with one
 * error event), so the count stays an upper bound there.
 */
export function llmStreamFrameCount(plan: LlmPlan, limit = Infinity): number {
  const text = countChunks(plan.text, plan.chunking, limit, plan.chunkSize)
  const calls = plan.toolCalls.reduce((n, c) => n + argumentPieceCount(c.arguments) + 2, 0)
  if (plan.provider === 'anthropic') {
    // message_start · (text block start + ping + deltas + stop | ping) · calls · message_delta · message_stop
    const textBlock = plan.text !== '' || plan.toolCalls.length === 0 ? text + 3 : 1
    // A tool call: start + pieces + stop.
    return 1 + textBlock + calls + 2
  }
  // role · deltas · calls (open + pieces) · finish · [usage] · [DONE]
  const openAiCalls = calls - plan.toolCalls.length
  return 1 + text + openAiCalls + 1 + (plan.includeUsage ? 1 : 0) + 1
}
