/**
 * "New mock server" presets for HTTP mocks (issue #140) — the HTTP twin of
 * `mock-mcp/mock-mcp-presets.ts`. Pure factories plus one orchestrator
 * (`createFromHttpPreset`) that replays a preset over the existing
 * `window.api.mock` IPC: server → (settings) → endpoints → responses.
 *
 * Every template here is rendered by the real engine (`src/main/mock/`):
 * path params come from `pathMode: 'param'` + `:id`, the template context is
 * `request.{method,path,headers,query,params,body}`, `{{json x}}` is the
 * engine's JSON helper and `{{$randomInt(a,b)}}` / `{{$isoTimestamp}}` are
 * dynamic values. The preset unit test renders them with that engine.
 * Never write `}}}` in a template: Handlebars reads it as a triple-stash close.
 */
import type {
  MockAuthConfig,
  MockBodyType,
  MockCondition,
  MockFailureConfig,
  MockMethod,
  MockPathMode,
  MockResponseHeader,
  MockServer,
} from '../../types'

export type MockHttpPresetId = 'blank' | 'rest' | 'echo' | 'auth' | 'faults'

export const MOCK_HTTP_PRESET_IDS: readonly MockHttpPresetId[] = [
  'blank',
  'rest',
  'echo',
  'auth',
  'faults',
]

/** i18n keys per preset — literal so the key-coverage test can see them. */
export const MOCK_HTTP_PRESET_LABEL_KEYS: Record<MockHttpPresetId, string> = {
  blank: 'mockHttp.preset.blank',
  rest: 'mockHttp.preset.rest',
  echo: 'mockHttp.preset.echo',
  auth: 'mockHttp.preset.auth',
  faults: 'mockHttp.preset.faults',
}

export const MOCK_HTTP_PRESET_HINT_KEYS: Record<MockHttpPresetId, string> = {
  blank: 'mockHttp.preset.blankHint',
  rest: 'mockHttp.preset.restHint',
  echo: 'mockHttp.preset.echoHint',
  auth: 'mockHttp.preset.authHint',
  faults: 'mockHttp.preset.faultsHint',
}

/** Default server names (English on purpose: they become data). */
export const MOCK_HTTP_PRESET_NAMES: Record<MockHttpPresetId, string> = {
  blank: 'Mock Server',
  rest: 'Users API',
  echo: 'Echo API',
  auth: 'Auth API',
  faults: 'Faults API',
}

export interface HttpPresetResponse {
  name: string
  statusCode: number
  headers: MockResponseHeader[]
  bodyType: MockBodyType
  body: string
  delayMs: number
  condition: MockCondition
}

export interface HttpPresetEndpoint {
  endpoint: {
    method: MockMethod
    path: string
    pathMode: MockPathMode
    description: string
    authOverride?: MockAuthConfig
  }
  responses: HttpPresetResponse[]
}

export interface HttpPresetServer {
  description: string
  /** Server settings `mock:server:create` does not take — applied with `server.update` right after. */
  authConfig?: MockAuthConfig
  failureConfig?: MockFailureConfig
}

export interface HttpPreset {
  server: HttpPresetServer
  endpoints: HttpPresetEndpoint[]
}

const ALWAYS: MockCondition = { type: 'always' }

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function res(
  r: Partial<HttpPresetResponse> & Pick<HttpPresetResponse, 'name'>,
): HttpPresetResponse {
  return {
    statusCode: 200,
    headers: [],
    bodyType: 'json',
    body: '',
    delayMs: 0,
    condition: ALWAYS,
    ...r,
  }
}

function ep(
  method: MockMethod,
  path: string,
  description: string,
  responses: HttpPresetResponse[],
  extra: Partial<HttpPresetEndpoint['endpoint']> = {},
): HttpPresetEndpoint {
  const pathMode: MockPathMode = path.includes('/:') ? 'param' : 'exact'
  return { endpoint: { method, path, pathMode, description, ...extra }, responses }
}

/** Random bearer token for the "Auth required" preset. */
export function generateMockToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `mock_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

const USERS = [1, 2, 3].map((id) => ({ id, name: `User ${id}`, email: `user${id}@example.com` }))

// `:id` is constrained to 1–3 by the response condition, so the bare number is valid JSON.
const USER_TEMPLATE = `{
  "id": {{request.params.id}},
  "name": "User {{request.params.id}}",
  "email": "user{{request.params.id}}@example.com"
}`

const NOT_FOUND_TEMPLATE = `{
  "error": "not_found",
  "id": {{json request.params.id}}
}`

const CREATED_TEMPLATE = `{
  "id": {{$randomInt(4,9999)}},
  "createdAt": "{{$isoTimestamp}}",
  "user": {{json request.body}}
}`

const ECHO_TEMPLATE = `{
  "method": {{json request.method}},
  "path": {{json request.path}},
  "query": {{json request.query}},
  "headers": {{json request.headers}},
  "body": {{json request.body}}
}`

function restEndpoints(): HttpPresetEndpoint[] {
  return [
    ep('GET', '/users', 'List users', [res({ name: 'All users', body: json(USERS) })]),
    ep('GET', '/users/:id', 'One user — ids 1–3 exist, any other id is 404', [
      res({
        name: 'Known user',
        body: USER_TEMPLATE,
        condition: { type: 'pathParam', name: 'id', op: 'regex', value: '^[1-3]$' },
      }),
      res({ name: 'Unknown user', statusCode: 404, body: NOT_FOUND_TEMPLATE }),
    ]),
    ep('POST', '/users', 'Create a user — echoes the JSON body back', [
      res({ name: 'Created', statusCode: 201, body: CREATED_TEMPLATE }),
    ]),
    ep('DELETE', '/users/:id', 'Delete a user', [
      res({ name: 'Deleted', statusCode: 204, bodyType: 'text' }),
    ]),
  ]
}

export function buildHttpPreset(id: MockHttpPresetId): HttpPreset {
  switch (id) {
    case 'blank':
      return { server: { description: '' }, endpoints: [] }
    case 'rest':
      return {
        server: { description: 'Users CRUD example: ids 1–3 exist, others return 404.' },
        endpoints: restEndpoints(),
      }
    case 'echo':
      return {
        server: { description: 'ANY /echo returns the request it received.' },
        endpoints: [
          ep('ANY', '/echo', 'Echoes method, path, query, headers and body', [
            res({ name: 'Echo', body: ECHO_TEMPLATE }),
          ]),
        ],
      }
    case 'auth': {
      const token = generateMockToken()
      return {
        server: {
          description: `Requests need "Authorization: Bearer ${token}" (GET /public is open).`,
          authConfig: { type: 'bearer', tokens: [token] },
        },
        endpoints: [
          ep(
            'GET',
            '/public',
            'Open endpoint — overrides the server auth',
            [res({ name: 'Public', body: json({ message: 'No credentials needed.' }) })],
            { authOverride: { type: 'none' } },
          ),
          ep('GET', '/me', 'Needs the bearer token, 401 otherwise', [
            res({ name: 'Authorized', body: json({ authenticated: true, user: USERS[0] }) }),
          ]),
        ],
      }
    }
    case 'faults':
      return {
        server: {
          description:
            'GET /slow waits 1500 ms; failure injection answers ~1 in 3 requests with 500.',
          failureConfig: {
            enabled: true,
            probability: 33,
            mode: 'status',
            status: 500,
            timeoutMs: 30000,
          },
        },
        endpoints: [
          ep('GET', '/slow', 'Answers after 1500 ms', [
            res({ name: 'Slow', delayMs: 1500, body: json({ message: 'Answered after 1500 ms' }) }),
          ]),
          ep('GET', '/items', 'Plain list — still hit by failure injection', [
            res({ name: 'Items', body: json({ items: [{ id: 1 }, { id: 2 }] }) }),
          ]),
        ],
      }
  }
}

export type CreateHttpPresetResult =
  | { server: MockServer; error?: undefined }
  | { server?: undefined; error: string }

function serverPatch(s: HttpPresetServer): Partial<MockServer> | null {
  const patch: Partial<MockServer> = {}
  if (s.authConfig) patch.authConfig = s.authConfig
  if (s.failureConfig) patch.failureConfig = s.failureConfig
  return Object.keys(patch).length > 0 ? patch : null
}

function stepError(r: { error?: string }, fallback: string): Error {
  return new Error(r.error ?? fallback)
}

/**
 * Create an HTTP mock server from a preset: `server.create` → `server.update`
 * (only for auth / failure settings) → per endpoint `endpoint.create` → its
 * `response.create`s, in order. A failure after the server exists deletes it
 * again (the delete cascades), so a half-built preset never lingers.
 */
export async function createFromHttpPreset(
  projectId: string,
  preset: HttpPreset,
  name: string,
  port: number,
): Promise<CreateHttpPresetResult> {
  const api = window.api.mock
  const created = await api.server.create({
    projectId,
    name,
    port,
    description: preset.server.description,
  })
  if (!created.success || !created.data) return { error: created.error ?? 'Create failed' }
  let server = created.data
  try {
    const patch = serverPatch(preset.server)
    if (patch) {
      const updated = await api.server.update(server.id, patch)
      if (!updated.success || !updated.data) throw stepError(updated, 'Update failed')
      server = updated.data
    }
    for (const [i, item] of preset.endpoints.entries()) {
      const e = await api.endpoint.create({ serverId: server.id, ...item.endpoint, sortOrder: i })
      if (!e.success || !e.data) throw stepError(e, 'Endpoint create failed')
      for (const [j, response] of item.responses.entries()) {
        const r = await api.response.create({ endpointId: e.data.id, ...response, order: j })
        if (!r.success || !r.data) throw stepError(r, 'Response create failed')
      }
    }
    return { server }
  } catch (e) {
    await api.server.delete(server.id).catch(() => undefined)
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
