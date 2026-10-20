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
import type {
  MockLlmConfig,
  MockLlmProvider,
  MockLlmStopReason,
  MockLlmUsage,
} from '../../../shared/mock-stream'
import type { SseEvent } from './sse-writer'
import { openAiCompletion, openAiEvents } from './llm-openai'
import { anthropicEvents, anthropicMessage } from './llm-anthropic'

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
      stopReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : config.stopReason === 'tool_calls'
            ? 'stop'
            : config.stopReason,
      usage,
      includeUsage: request.includeUsage,
      chunking: config.chunking,
    },
  }
}

/** The non-streamed reply body (`chat.completion` / `message`). */
export function encodeLlmJson(plan: LlmPlan): string {
  return JSON.stringify(
    plan.provider === 'anthropic' ? anthropicMessage(plan) : openAiCompletion(plan),
  )
}

/** The streamed reply as server-sent events, in order. */
export function encodeLlmEvents(plan: LlmPlan): SseEvent[] {
  return plan.provider === 'anthropic' ? anthropicEvents(plan) : openAiEvents(plan)
}
