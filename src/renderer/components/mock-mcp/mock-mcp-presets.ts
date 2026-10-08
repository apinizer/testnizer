/**
 * "New Mock MCP server" presets (issue #140) — the public MCP playground
 * mocks (echo, auth-required, error kinds, complex schemas, slow) as one-click
 * starting points. The stateless mock is out of scope.
 *
 * Every factory must produce a config the backend validator accepts
 * (`validateMockMcpConfig`): tool inputSchemas with `type: "object"`, JSON
 * bodies that parse, unique names, error knobs in range. The preset unit test
 * enforces it.
 */
import type { MockMcpServerCreateInput, MockMcpTool } from '../../types/mock-mcp'
import { generateBearerToken } from './mock-mcp-draft'
import { MCP_MOCK_PORT_START, suggestPort, uniqueName } from '../mock/mock-create-helpers'

// Re-exported: the Tools / Prompts tabs and the preset tests import them from here.
export { suggestPort, uniqueName }

export type MockMcpPresetId = 'echo' | 'auth' | 'errors' | 'schemas' | 'slow'

export const MOCK_MCP_PRESET_IDS: readonly MockMcpPresetId[] = [
  'echo',
  'auth',
  'errors',
  'schemas',
  'slow',
]

/** i18n keys per preset — literal so the key-coverage test can see them. */
export const MOCK_MCP_PRESET_LABEL_KEYS: Record<MockMcpPresetId, string> = {
  echo: 'mockMcp.preset.echo',
  auth: 'mockMcp.preset.auth',
  errors: 'mockMcp.preset.errors',
  schemas: 'mockMcp.preset.schemas',
  slow: 'mockMcp.preset.slow',
}

export const MOCK_MCP_PRESET_HINT_KEYS: Record<MockMcpPresetId, string> = {
  echo: 'mockMcp.preset.echoHint',
  auth: 'mockMcp.preset.authHint',
  errors: 'mockMcp.preset.errorsHint',
  schemas: 'mockMcp.preset.schemasHint',
  slow: 'mockMcp.preset.slowHint',
}

/** Default server names (English on purpose: they become data, like the public mocks). */
export const MOCK_MCP_PRESET_NAMES: Record<MockMcpPresetId, string> = {
  echo: 'Echo MCP',
  auth: 'Auth MCP',
  errors: 'Error MCP',
  schemas: 'Schema MCP',
  slow: 'Slow MCP',
}

function echoTool(): MockMcpTool {
  return {
    name: 'echo',
    title: 'Echo',
    description: 'Echoes the given text back.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
    response: { kind: 'template', body: '{{args.text}}' },
  }
}

const NO_ARGS = { type: 'object', properties: {} }

/**
 * "Ask name (elicitation)" tool preset (issue #152) — a copy of the backend's
 * `exampleElicitationTool()` (`src/main/mock-mcp/config.ts`; the renderer
 * cannot import main). On 2026-07-28 the first call answers `input_required`
 * asking for a name; the retry greets with it. A test keeps the two equal.
 */
export function elicitationExampleTool(): MockMcpTool {
  return {
    name: 'ask_name',
    description: 'Asks the user for their name (2026-07-28 elicitation), then greets them.',
    inputSchema: { type: 'object', properties: {} },
    response: { kind: 'template', body: 'Hello, {{input.name}}!' },
    elicit: {
      key: 'name',
      message: 'What is your name?',
      schema: {
        type: 'object',
        properties: { name: { type: 'string', title: 'Name', minLength: 1 } },
        required: ['name'],
      },
    },
  }
}

function errorTools(): MockMcpTool[] {
  const msg = { type: 'object', properties: { note: { type: 'string' } } }
  return [
    {
      name: 'ok',
      description: 'Always succeeds — a control for the failing tools.',
      inputSchema: NO_ARGS,
      response: { kind: 'text', body: 'ok' },
    },
    {
      name: 'fail_jsonrpc',
      description: 'Answers with a JSON-RPC error (-32603 Internal error).',
      inputSchema: msg,
      response: { kind: 'text', body: 'unreachable' },
      error: { kind: 'jsonrpc', code: -32603, message: 'Internal error (mock)' },
    },
    {
      name: 'fail_is_error',
      description: 'Returns a tool result with isError: true.',
      inputSchema: msg,
      response: { kind: 'text', body: 'unreachable' },
      error: { kind: 'isError', message: 'Tool failed (mock)' },
    },
    {
      name: 'fail_http_500',
      description: 'The HTTP request carrying the call is answered with 500.',
      inputSchema: msg,
      response: { kind: 'text', body: 'unreachable' },
      error: { kind: 'http', httpStatus: 500 },
    },
    {
      name: 'fail_timeout',
      description: 'Never answers — exercises client-side timeouts / cancellation.',
      inputSchema: msg,
      response: { kind: 'text', body: 'unreachable' },
      error: { kind: 'timeout' },
    },
    {
      name: 'flaky',
      description: 'Fails every 3rd call with a JSON-RPC error.',
      inputSchema: msg,
      response: { kind: 'text', body: 'ok' },
      error: { kind: 'jsonrpc', code: -32000, message: 'Flaky failure (mock)', everyN: 3 },
    },
  ]
}

function schemaTools(): MockMcpTool[] {
  return [
    {
      name: 'create_order',
      title: 'Create order',
      description: 'Nested objects, arrays of objects, enums and numeric bounds.',
      inputSchema: {
        type: 'object',
        properties: {
          customer: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^C[0-9]+$' },
              email: { type: 'string', format: 'email' },
              tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
            },
            required: ['id'],
          },
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                quantity: { type: 'integer', minimum: 1, maximum: 99 },
              },
              required: ['sku', 'quantity'],
            },
          },
          priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
        },
        required: ['customer', 'items'],
      },
      response: {
        kind: 'json',
        body: JSON.stringify({ orderId: 'ORD-1001', status: 'accepted' }, null, 2),
      },
    },
    {
      name: 'notify',
      title: 'Notify',
      description: 'oneOf: either an email or an SMS target.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            oneOf: [
              {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' } },
                required: ['email'],
              },
              {
                type: 'object',
                properties: { phone: { type: 'string', pattern: '^\\+[0-9]{8,15}$' } },
                required: ['phone'],
              },
            ],
          },
          message: { type: 'string', maxLength: 160 },
        },
        required: ['target', 'message'],
      },
      response: { kind: 'template', body: 'Notification queued: {{uuid}}' },
    },
    {
      name: 'search',
      title: 'Search',
      description: 'Optional filters, arrays of enums, booleans.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tags: { type: 'array', items: { type: 'string', enum: ['api', 'mcp', 'mock'] } },
          includeArchived: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        },
        required: ['query'],
      },
      response: {
        kind: 'json',
        body: JSON.stringify({ total: 1, results: [{ id: 1, title: 'First hit' }] }, null, 2),
      },
    },
  ]
}

type PresetBody = Omit<MockMcpServerCreateInput, 'projectId' | 'name' | 'port'>

function presetBody(id: MockMcpPresetId): PresetBody {
  switch (id) {
    case 'echo':
      return { description: 'Echoes the given text back.', tools: [echoTool()] }
    case 'auth':
      return {
        description: 'Rejects requests without the bearer token (HTTP 401).',
        authMode: 'bearer',
        bearerToken: generateBearerToken(),
        tools: [
          echoTool(),
          {
            name: 'whoami',
            description: 'Shows the Authorization header the server received.',
            inputSchema: NO_ARGS,
            response: {
              kind: 'template',
              body: 'Authorized. Authorization: {{request.headers.authorization}}',
            },
          },
        ],
      }
    case 'errors':
      return {
        description: 'One tool per error kind: JSON-RPC, isError, HTTP 500, timeout, flaky.',
        tools: errorTools(),
      }
    case 'schemas':
      return {
        description: 'Tools with nested objects, arrays, enums and oneOf input schemas.',
        tools: schemaTools(),
      }
    case 'slow':
      return {
        description: 'Every request is answered after 1500 ms.',
        latencyMs: 1500,
        tools: [echoTool()],
      }
  }
}

export function buildPresetInput(
  id: MockMcpPresetId,
  ctx: { projectId: string; takenNames: readonly string[]; takenPorts: readonly number[] },
): MockMcpServerCreateInput {
  return {
    projectId: ctx.projectId,
    name: uniqueName(MOCK_MCP_PRESET_NAMES[id], ctx.takenNames),
    port: suggestPort(ctx.takenPorts, MCP_MOCK_PORT_START),
    // Explicit protocol-era posture (issue #152): 2025 clients are served
    // statelessly next to 2026-07-28, list results carry no cache lifetime.
    legacyMode: 'stateless',
    cacheTtlMs: 0,
    ...presetBody(id),
  }
}
