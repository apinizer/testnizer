/**
 * "New mock server" presets for AI mock servers (issue #221, design Ek D
 * §D.3.1) — the AI twin of `mock-sse-presets.ts`, built from the SAME shapes
 * (`HttpPreset`, `res`, `ep`) and created by the SAME orchestrator
 * (`createFromHttpPreset`); the additions are `server.kind: 'ai'` and each
 * `llm` response's settings (`streamConfig`, read as `MockLlmConfig`).
 *
 * An `llm` body is the assistant text (a template: `{{lastUserMessage}}`,
 * `{{lastToolResult}}`, `{{model}}`); whether it streams is decided by the
 * request's `stream` flag (`src/main/mock/stream/llm.ts`). Errors are plain
 * `json` responses with a 4xx / 5xx status, picked by the request's model
 * name — the AI Chat tab's Model field is enough to try them. The preset test
 * (`tests/main/mock-ai-presets.test.ts`) serves every preset on a real port
 * and talks to it with Testnizer's own AI Chat engine.
 */
import {
  LLM_CONFIG_DEFAULTS,
  type MockLlmConfig,
  type MockLlmProvider,
} from '../../../shared/mock-stream'
import type { MockCondition } from '../../types'
import { ep, json, res, type HttpPreset, type HttpPresetResponse } from './mock-http-presets'

export type MockAiPresetId = 'chat' | 'anthropic' | 'tools' | 'anthropicTools' | 'errors'

export const MOCK_AI_PRESET_IDS: readonly MockAiPresetId[] = [
  'chat',
  'anthropic',
  'tools',
  'anthropicTools',
  'errors',
]

/** i18n keys per preset — literal so the key-coverage test can see them. */
export const MOCK_AI_PRESET_LABEL_KEYS: Record<MockAiPresetId, string> = {
  chat: 'mockAi.preset.chat',
  anthropic: 'mockAi.preset.anthropic',
  tools: 'mockAi.preset.tools',
  anthropicTools: 'mockAi.preset.anthropicTools',
  errors: 'mockAi.preset.errors',
}

export const MOCK_AI_PRESET_HINT_KEYS: Record<MockAiPresetId, string> = {
  chat: 'mockAi.preset.chatHint',
  anthropic: 'mockAi.preset.anthropicHint',
  tools: 'mockAi.preset.toolsHint',
  anthropicTools: 'mockAi.preset.anthropicToolsHint',
  errors: 'mockAi.preset.errorsHint',
}

/** Default server names (English on purpose: they become data). */
export const MOCK_AI_PRESET_NAMES: Record<MockAiPresetId, string> = {
  chat: 'Chat API',
  anthropic: 'Messages API',
  tools: 'Tool-call API',
  anthropicTools: 'Tool-use Messages API',
  errors: 'Error API',
}

/** The model the AI Chat tab is opened with, and the one GET /v1/models lists. */
export const MOCK_LLM_MODEL = 'mock-model'

const HELLO = 'Hello from the mock LLM. You said: {{lastUserMessage}}'

/**
 * "Tool-call API" (issue #226): the request offers the echo tool as `echo` (a
 * plain SDK) or as AI Chat's namespaced `<server>__echo` — never matched by a
 * plain `name == 'echo'`. The condition and the `offeredTool` template helper
 * (main `mock/template.ts`) use the same rule, so the call names exactly the
 * tool that was offered. The `@.function &&` guard keeps a tool without a
 * `function` from failing the whole filter.
 */
const OFFERS_ECHO_PATH = '$.tools[?(@.function && /(^|__)echo$/.test(@.function.name))]'
const ECHO_TOOL_NAME = "{{offeredTool 'echo'}}"
/**
 * The same two rules on the Anthropic Messages wire (issue #222): a tool is
 * offered as `tools[].name` (no `function` wrapper), and a tool result
 * comes back as a `tool_result` block inside a user message's `content`.
 */
const ANTHROPIC_OFFERS_ECHO_PATH = '$.tools[?(@.name && /(^|__)echo$/.test(@.name))]'
const ANTHROPIC_TOOL_RESULT_PATH = "$.messages[*].content[?(@.type=='tool_result')]"
const ECHO_ARGUMENTS = { text: 'hello from the mock LLM' }

/** The tool round trip, in this order: answer the result, call echo, plain answer. */
function toolRoundTrip(
  provider: MockLlmProvider,
  offersEcho: string,
  hasToolResult: string,
): HttpPresetResponse[] {
  return [
    llm(
      'Answer with the tool result',
      'Tool said: {{lastToolResult}}',
      { provider },
      { type: 'jsonPath', path: hasToolResult, op: 'exists' },
    ),
    llm(
      'Call echo',
      '',
      {
        provider,
        stopReason: 'tool_calls',
        // The name the client offered: AI Chat namespaces MCP tools as
        // `<server>__echo` (`wireToolName`), a plain SDK sends `echo`.
        toolCalls: [{ name: ECHO_TOOL_NAME, arguments: { ...ECHO_ARGUMENTS } }],
      },
      { type: 'jsonPath', path: offersEcho, op: 'exists' },
    ),
    llm('Plain answer', HELLO, { provider }),
  ]
}

/** Fresh `llm` settings — a new `toolCalls` array each time (the defaults are frozen). */
export function llmConfig(over: Partial<MockLlmConfig> = {}): MockLlmConfig {
  return { ...LLM_CONFIG_DEFAULTS, toolCalls: [], ...over }
}

function llm(
  name: string,
  body: string,
  cfg: Partial<MockLlmConfig> = {},
  condition?: MockCondition,
): HttpPresetResponse {
  return res({
    name,
    bodyType: 'llm',
    body,
    streamConfig: llmConfig(cfg),
    ...(condition ? { condition } : {}),
  })
}

/**
 * The chat reply: what the Chat / Messages presets serve and what the
 * editor's "Add" creates on an AI server — one definition for both.
 */
export function chatResponse(provider: MockLlmProvider): HttpPresetResponse {
  return llm('Assistant reply', HELLO, { provider })
}

const MODELS = json({ object: 'list', data: [{ id: MOCK_LLM_MODEL, object: 'model' }] })

const modelIs = (value: string): MockCondition => ({
  type: 'jsonPath',
  path: '$.model',
  op: 'eq',
  value,
})

function apiError(
  name: string,
  statusCode: number,
  model: string,
  error: Record<string, string>,
  headers: HttpPresetResponse['headers'] = [],
): HttpPresetResponse {
  return res({
    name,
    statusCode,
    headers: [{ name: 'Content-Type', value: 'application/json' }, ...headers],
    body: json({ error }),
    condition: modelIs(model),
  })
}

export function buildAiPreset(id: MockAiPresetId): HttpPreset {
  switch (id) {
    case 'chat':
      return {
        server: {
          kind: 'ai',
          description:
            'OpenAI-compatible: POST /v1/chat/completions streams a canned reply word by word (stream: false answers with JSON); GET /v1/models lists mock-model. Point an SDK at <base URL>/v1. Expose on 0.0.0.0 only with auth.',
        },
        endpoints: [
          ep('POST', '/v1/chat/completions', 'Chat completions (OpenAI-compatible)', [
            chatResponse('openai'),
          ]),
          ep('GET', '/v1/models', 'Model list', [res({ name: 'Models', body: MODELS })]),
        ],
      }
    case 'anthropic':
      return {
        server: {
          kind: 'ai',
          description:
            'Anthropic-compatible: POST /v1/messages answers with the message_start … message_stop event stream; no x-api-key or anthropic-version needed.',
        },
        endpoints: [
          ep('POST', '/v1/messages', 'Messages (Anthropic-compatible)', [
            chatResponse('anthropic'),
          ]),
        ],
      }
    case 'tools':
      return {
        server: {
          kind: 'ai',
          description:
            'POST /v1/chat/completions: a request that offers an echo tool (echo, or AI Chat’s <server>__echo) gets a call to that exact name; the turn that carries the tool result gets "Tool said: …". Pair it with the Mock MCP "Echo" server in the AI Chat Tools tab.',
        },
        endpoints: [
          ep(
            'POST',
            '/v1/chat/completions',
            'Tool call round trip (OpenAI-compatible)',
            toolRoundTrip('openai', OFFERS_ECHO_PATH, "$.messages[?(@.role=='tool')]"),
          ),
        ],
      }
    case 'anthropicTools':
      return {
        server: {
          kind: 'ai',
          description:
            'POST /v1/messages: a request that offers an echo tool (echo, or AI Chat’s <server>__echo) gets a tool_use block for that exact name (input_json_delta, stop_reason tool_use); the turn that carries the tool_result gets "Tool said: …". Pair it with the Mock MCP "Echo" server in the AI Chat Tools tab (Anthropic provider).',
        },
        endpoints: [
          ep(
            'POST',
            '/v1/messages',
            'Tool use round trip (Anthropic-compatible)',
            toolRoundTrip('anthropic', ANTHROPIC_OFFERS_ECHO_PATH, ANTHROPIC_TOOL_RESULT_PATH),
          ),
        ],
      }
    case 'errors':
      return {
        server: {
          kind: 'ai',
          description:
            'POST /v1/chat/completions: model error-429 → 429 with retry-after, error-500 → 500, error-401 → 401, error-stream → 3 words, then a mid-stream error and the stream closes; any other model gets a normal reply. POST /v1/messages (Anthropic): error-529 → 529 overloaded_error, error-stream → 3 words, then event: error (overloaded_error).',
        },
        endpoints: [
          ep('POST', '/v1/chat/completions', 'Error per model name', [
            apiError(
              'Rate limited',
              429,
              'error-429',
              { message: 'Rate limit reached', type: 'rate_limit_error' },
              [{ name: 'retry-after', value: '2' }],
            ),
            apiError('Server error', 500, 'error-500', {
              message: 'The server had an error',
              type: 'server_error',
            }),
            apiError('Invalid key', 401, 'error-401', {
              message: 'Incorrect API key provided',
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            }),
            midStreamError('openai'),
            llm('Normal reply', HELLO),
          ]),
          ep('POST', '/v1/messages', 'Errors (Anthropic-compatible)', [
            res({
              name: 'Overloaded',
              statusCode: 529,
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              body: json({
                type: 'error',
                error: { type: 'overloaded_error', message: 'Overloaded' },
              }),
              condition: modelIs('error-529'),
            }),
            midStreamError('anthropic'),
            llm('Normal reply', HELLO, { provider: 'anthropic' }),
          ]),
        ],
      }
  }
}

/**
 * `model: error-stream` (issue #222): three chunks of the reply, then the
 * provider's own mid-stream error (OpenAI `{"error":{…}}`, Anthropic
 * `event: error` + `overloaded_error`) and the stream closes. A request
 * without `stream: true` gets the plain reply.
 */
function midStreamError(provider: MockLlmProvider): HttpPresetResponse {
  return llm(
    'Mid-stream error',
    HELLO,
    { provider, streamError: { afterChunks: 3 } },
    modelIs('error-stream'),
  )
}
