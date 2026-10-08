/**
 * HTTP mock presets of the "New mock server" dialog (issue #140).
 *
 * A preset's description must be TRUE to what it creates, so the templates,
 * paths and conditions are exercised with the REAL main-process engine
 * pieces (`matchEndpoint`, `evaluateCondition`, `renderTemplate`,
 * `checkAuth`) — not a renderer copy. `createFromHttpPreset` is checked
 * against a recording `window.api.mock` bridge: create → (update) →
 * endpoint → its responses, in that order, with rollback on failure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildHttpPreset,
  createFromHttpPreset,
  MOCK_HTTP_PRESET_HINT_KEYS,
  MOCK_HTTP_PRESET_IDS,
  MOCK_HTTP_PRESET_LABEL_KEYS,
  type HttpPreset,
  type HttpPresetResponse,
} from '../../src/renderer/components/mock/mock-http-presets'
import { matchEndpoint, type MatchableEndpoint } from '../../src/main/mock/matcher'
import { evaluateCondition } from '../../src/main/mock/condition'
import { renderTemplate, type TemplateContext } from '../../src/main/mock/template'
import { checkAuth, resolveAuthConfig } from '../../src/main/mock/auth'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import {
  HTTP_MOCK_PORT_START,
  MCP_MOCK_PORT_START,
  suggestPort,
  uniqueName,
} from '../../src/renderer/components/mock/mock-create-helpers'
import * as mcpPresets from '../../src/renderer/components/mock-mcp/mock-mcp-presets'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY', 'ANY']
const PATH_MODES = ['exact', 'param', 'wildcard', 'regex']

function matchable(preset: HttpPreset): MatchableEndpoint[] {
  return preset.endpoints.map((e, i) => ({
    id: String(i),
    method: e.endpoint.method,
    path: e.endpoint.path,
    pathMode: e.endpoint.pathMode,
    priority: 0,
    enabled: true,
  }))
}

/** Route a request through the engine's matcher + response picker, like `server.ts`. */
function route(preset: HttpPreset, method: string, path: string, body: unknown = null) {
  const m = matchEndpoint(matchable(preset), method, path)
  if (!m) return null
  const item = preset.endpoints[Number(m.endpoint.id)]
  const condCtx = {
    method,
    headers: {},
    query: {},
    pathParams: m.params,
    body,
    bodyText: body == null ? '' : JSON.stringify(body),
  }
  const picked =
    item.responses.find((r) => evaluateCondition(r.condition, condCtx)) ?? item.responses[0]
  return { item, picked, params: m.params }
}

function ctx(over: Partial<TemplateContext['request']> = {}): TemplateContext {
  return {
    request: {
      method: 'POST',
      path: '/echo',
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      query: { q: '1' },
      params: { id: '2' },
      body: { name: 'Ada' },
      bodyText: '{"name":"Ada"}',
      ...over,
    },
    state: {},
    envVars: {},
  }
}

function render(r: HttpPresetResponse, c: TemplateContext = ctx()): string {
  return renderTemplate(r.body, c)
}

describe('shared name / port helpers (one implementation for HTTP and MCP)', () => {
  it("suggestPort starts at the kind's base and skips every taken port", () => {
    expect(HTTP_MOCK_PORT_START).toBe(3001)
    expect(MCP_MOCK_PORT_START).toBe(3100)
    expect(suggestPort([3001, 3002], HTTP_MOCK_PORT_START)).toBe(3003)
    expect(suggestPort(new Set([3100, 3101]), MCP_MOCK_PORT_START)).toBe(3102)
    expect(suggestPort([])).toBe(3100)
    expect(uniqueName('Users API', ['Users API'])).toBe('Users API 2')
  })

  it('the MCP preset module re-exports the very same helpers', () => {
    expect(mcpPresets.suggestPort).toBe(suggestPort)
    expect(mcpPresets.uniqueName).toBe(uniqueName)
  })
})

describe('HTTP mock presets — shape', () => {
  it.each(MOCK_HTTP_PRESET_IDS)('preset "%s" produces valid endpoint / response DTOs', (id) => {
    const preset = buildHttpPreset(id)
    for (const { endpoint, responses } of preset.endpoints) {
      expect(METHODS).toContain(endpoint.method)
      expect(PATH_MODES).toContain(endpoint.pathMode)
      expect(endpoint.path.startsWith('/')).toBe(true)
      expect(responses.length).toBeGreaterThan(0)
      for (const r of responses) {
        expect(r.statusCode).toBeGreaterThanOrEqual(100)
        expect(r.statusCode).toBeLessThan(600)
        expect(r.delayMs).toBeGreaterThanOrEqual(0)
        // Handlebars would read `}}}` as a triple-stash close and fail the render.
        expect(r.body).not.toContain('}}}')
        if (r.bodyType === 'json' && r.statusCode !== 204) {
          expect(() => JSON.parse(render(r)), `${id} ${endpoint.path} ${r.name}`).not.toThrow()
        }
      }
    }
  })

  it('every preset has a label and a hint in both locales', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale)
      for (const id of MOCK_HTTP_PRESET_IDS) {
        expect(t(MOCK_HTTP_PRESET_LABEL_KEYS[id])).not.toBe(MOCK_HTTP_PRESET_LABEL_KEYS[id])
        expect(t(MOCK_HTTP_PRESET_HINT_KEYS[id])).not.toBe(MOCK_HTTP_PRESET_HINT_KEYS[id])
      }
    }
    setLocale('en')
  })

  it('Blank creates no endpoints and no server settings', () => {
    const blank = buildHttpPreset('blank')
    expect(blank.endpoints).toEqual([])
    expect(blank.server.authConfig).toBeUndefined()
    expect(blank.server.failureConfig).toBeUndefined()
  })
})

describe('HTTP mock presets — behaviour on the real engine', () => {
  it('REST example: 4 endpoints with the right methods, paths and statuses', () => {
    const rest = buildHttpPreset('rest')
    expect(rest.endpoints.map((e) => `${e.endpoint.method} ${e.endpoint.path}`)).toEqual([
      'GET /users',
      'GET /users/:id',
      'POST /users',
      'DELETE /users/:id',
    ])
    expect(rest.endpoints.map((e) => e.responses.map((r) => r.statusCode))).toEqual([
      [200],
      [200, 404],
      [201],
      [204],
    ])
    expect(JSON.parse(rest.endpoints[0].responses[0].body)).toHaveLength(3)
  })

  it('REST example: ids 1–3 return the user, any other id is 404', () => {
    const rest = buildHttpPreset('rest')
    const known = route(rest, 'GET', '/users/2')!
    expect(known.params).toEqual({ id: '2' })
    expect(known.picked.statusCode).toBe(200)
    const body = JSON.parse(render(known.picked, ctx({ method: 'GET', params: known.params })))
    expect(body).toEqual({ id: 2, name: 'User 2', email: 'user2@example.com' })

    const unknown = route(rest, 'GET', '/users/42')!
    expect(unknown.picked.statusCode).toBe(404)
    expect(JSON.parse(render(unknown.picked, ctx({ params: unknown.params })))).toEqual({
      error: 'not_found',
      id: '42',
    })
  })

  it('REST example: POST /users answers 201 with the JSON body echoed; DELETE is 204', () => {
    const rest = buildHttpPreset('rest')
    const created = route(rest, 'POST', '/users', { name: 'Ada' })!
    expect(created.picked.statusCode).toBe(201)
    const body = JSON.parse(render(created.picked))
    expect(body.user).toEqual({ name: 'Ada' })
    expect(typeof body.id).toBe('number')
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false)

    const deleted = route(rest, 'DELETE', '/users/3')!
    expect(deleted.picked).toMatchObject({ statusCode: 204, body: '' })
    expect(route(rest, 'PUT', '/users/3')).toBeNull()
  })

  it('Echo: ANY /echo returns method, path, query, headers and body', () => {
    const echo = buildHttpPreset('echo')
    for (const method of ['GET', 'POST', 'PATCH']) {
      expect(route(echo, method, '/echo')).not.toBeNull()
    }
    const hit = route(echo, 'PUT', '/echo')!
    const out = JSON.parse(render(hit.picked, ctx({ method: 'PUT' })))
    expect(out).toEqual({
      method: 'PUT',
      path: '/echo',
      query: { q: '1' },
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      body: { name: 'Ada' },
    })
  })

  it('Auth required: bearer token on the server, /public open, /me 401 without the token', () => {
    const auth = buildHttpPreset('auth')
    const cfg = auth.server.authConfig
    expect(cfg?.type).toBe('bearer')
    if (cfg?.type !== 'bearer') return
    const [token] = cfg.tokens
    expect(token).toMatch(/^mock_[0-9a-f]{32}$/)
    expect(auth.server.description).toContain(token)
    expect(buildHttpPreset('auth').server.authConfig).not.toEqual(cfg)

    const check = (path: string, headers: Record<string, string>) => {
      const hit = route(auth, 'GET', path)!
      const effective = resolveAuthConfig(cfg, hit.item.endpoint.authOverride ?? null)
      return checkAuth({ config: effective, headers, query: {} })
    }
    expect(check('/public', {}).ok).toBe(true)
    const denied = check('/me', {})
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.failure.status).toBe(401)
    expect(check('/me', { authorization: `Bearer ${token}` }).ok).toBe(true)
  })

  it('Faults: 1500 ms latency on /slow and server failure injection (~1 in 3 → 500)', () => {
    const faults = buildHttpPreset('faults')
    expect(route(faults, 'GET', '/slow')!.picked.delayMs).toBe(1500)
    expect(route(faults, 'GET', '/items')!.picked.delayMs).toBe(0)
    expect(faults.server.failureConfig).toMatchObject({
      enabled: true,
      probability: 33,
      mode: 'status',
      status: 500,
    })
  })
})

// ─── createFromHttpPreset → IPC order ─────────────────────────────

const calls: string[] = []

function installRecordingBridge(opts: { failEndpointAt?: number } = {}) {
  let n = 0
  let endpoints = 0
  const ok = <T>(data: T) => Promise.resolve({ success: true as const, data })
  const rec =
    <A extends unknown[], R>(name: string, impl: (...a: A) => R) =>
    (...a: A): R => {
      calls.push(name)
      return impl(...a)
    }
  const bridge = {
    server: {
      create: vi.fn(
        rec('server.create', (input: { name: string; port: number }) =>
          ok({ id: 'srv-1', ...input }),
        ),
      ),
      update: vi.fn(
        rec('server.update', (id: string, patch: object) => ok({ id, name: 'x', ...patch })),
      ),
      delete: vi.fn(rec('server.delete', () => ok(true))),
    },
    endpoint: {
      create: vi.fn(
        rec('endpoint.create', (input: object) => {
          endpoints += 1
          if (opts.failEndpointAt === endpoints) {
            return Promise.resolve({ success: false as const, error: 'disk full' })
          }
          n += 1
          return ok({ id: `ep-${n}`, ...input })
        }),
      ),
    },
    response: {
      create: vi.fn(rec('response.create', (input: object) => ok({ id: 'r', ...input }))),
    },
  }
  ;(window as unknown as { api: Record<string, unknown> }).api = { mock: bridge }
  return bridge
}

describe('createFromHttpPreset', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('REST: server.create, then each endpoint followed by its responses, in order', async () => {
    const bridge = installRecordingBridge()
    const r = await createFromHttpPreset('p-1', buildHttpPreset('rest'), 'Users API', 3005)
    expect(r.error).toBeUndefined()
    expect(r.server?.id).toBe('srv-1')
    expect(calls).toEqual([
      'server.create',
      'endpoint.create',
      'response.create',
      'endpoint.create',
      'response.create',
      'response.create',
      'endpoint.create',
      'response.create',
      'endpoint.create',
      'response.create',
    ])
    expect(bridge.server.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-1', name: 'Users API', port: 3005 }),
    )
    const eps = bridge.endpoint.create.mock.calls.map((c) => c[0])
    expect(eps[1]).toMatchObject({
      serverId: 'srv-1',
      method: 'GET',
      path: '/users/:id',
      pathMode: 'param',
      sortOrder: 1,
    })
    const resp = bridge.response.create.mock.calls.map((c) => c[0])
    expect(resp[1]).toMatchObject({ endpointId: 'ep-2', statusCode: 200, order: 0 })
    expect(resp[2]).toMatchObject({ endpointId: 'ep-2', statusCode: 404, order: 1 })
  })

  it('Blank: only server.create', async () => {
    installRecordingBridge()
    const r = await createFromHttpPreset('p-1', buildHttpPreset('blank'), 'Mock Server', 3001)
    expect(r.server).toBeDefined()
    expect(calls).toEqual(['server.create'])
  })

  it('Auth / Faults: server settings go through server.update right after create', async () => {
    const bridge = installRecordingBridge()
    await createFromHttpPreset('p-1', buildHttpPreset('auth'), 'Auth API', 3001)
    expect(calls.slice(0, 3)).toEqual(['server.create', 'server.update', 'endpoint.create'])
    expect(bridge.server.update.mock.calls[0][1]).toMatchObject({
      authConfig: { type: 'bearer' },
    })
    expect(bridge.endpoint.create.mock.calls[0][0]).toMatchObject({
      path: '/public',
      authOverride: { type: 'none' },
    })

    calls.length = 0
    const b2 = installRecordingBridge()
    await createFromHttpPreset('p-1', buildHttpPreset('faults'), 'Faults API', 3002)
    expect(calls.slice(0, 2)).toEqual(['server.create', 'server.update'])
    expect(b2.server.update.mock.calls[0][1]).toMatchObject({
      failureConfig: { enabled: true, probability: 33 },
    })
  })

  it('a failing step deletes the half-built server and reports the error', async () => {
    const bridge = installRecordingBridge({ failEndpointAt: 2 })
    const r = await createFromHttpPreset('p-1', buildHttpPreset('rest'), 'Users API', 3001)
    expect(r.server).toBeUndefined()
    expect(r.error).toBe('disk full')
    expect(bridge.server.delete).toHaveBeenCalledWith('srv-1')
    expect(calls.at(-1)).toBe('server.delete')
  })
})
