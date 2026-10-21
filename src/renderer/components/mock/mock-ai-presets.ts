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

export type MockAiPresetId = 'chat' | 'anthropic' | 'tools' | 'errors'

export const MOCK_AI_PRESET_IDS: readonly MockAiPresetId[] = [
  'chat',
  'anthropic',
  'tools',
  'errors',
]

/** i18n keys per preset — literal so the key-coverage test can see them. */
export const MOCK_AI_PRESET_LABEL_KEYS: Record<MockAiPresetId, string> = {
  chat: 'mockAi.preset.chat',
  anthropic: 'mockAi.preset.anthropic',
  tools: 'mockAi.preset.tools',
  errors: 'mockAi.preset.errors',
}

export const MOCK_AI_PRESET_HINT_KEYS: Record<MockAiPresetId, string> = {
  chat: 'mockAi.preset.chatHint',
  anthropic: 'mockAi.preset.anthropicHint',
  tools: 'mockAi.preset.toolsHint',
  errors: 'mockAi.preset.errorsHint',
}

/** Default server names (English on purpose: they become data). */
export const MOCK_AI_PRESET_NAMES: Record<MockAiPresetId, string> = {
  chat: 'Chat API',
  anthropic: 'Messages API',
  tools: 'Tool-call API',
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
          ep('POST', '/v1/chat/completions', 'Tool call round trip (OpenAI-compatible)', [
            llm(
              'Answer with the tool result',
              'Tool said: {{lastToolResult}}',
              {},
              { type: 'jsonPath', path: "$.messages[?(@.role=='tool')]", op: 'exists' },
            ),
            llm(
              'Call echo',
              '',
              {
                stopReason: 'tool_calls',
                // The name the client offered: AI Chat namespaces MCP tools as
                // `<server>__echo` (`wireToolName`), a plain SDK sends `echo`.
                toolCalls: [
                  { name: ECHO_TOOL_NAME, arguments: { text: 'hello from the mock LLM' } },
                ],
              },
              { type: 'jsonPath', path: OFFERS_ECHO_PATH, op: 'exists' },
            ),
            llm('Plain answer', HELLO),
          ]),
        ],
      }
    case 'errors':
      return {
        server: {
          kind: 'ai',
          description:
            'POST /v1/chat/completions: model error-429 → 429 with retry-after, error-500 → 500, error-401 → 401; any other model gets a normal reply.',
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
            llm('Normal reply', HELLO),
          ]),
        ],
      }
  }
}
