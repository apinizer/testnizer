/**
 * Mock templates never read secret variables (release 1.6.0).
 *
 * A mock renders response text with the project's variables, and it serves
 * whoever can reach its port. `loadEnvVars` handed it decrypted secrets, so a
 * response with `{{apiKey}}` gave the key away. Now every template (hand-written
 * or not, HTTP, SSE, LLM, Mock MCP) sees only non-secret variables and a
 * `{{secretName}}` stays literal. Real servers on loopback, real rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createTestDb, seedProject, seedWorkspace } from './handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

const { mockServerManager } = await import('../../src/main/mock/server')
const { mockMcpServerManager } = await import('../../src/main/mock-mcp/server')
const { invalidateSecretInventory } = await import('../../src/main/lib/secret-inventory-cache')
const { renderTemplate } = await import('../../src/main/mock/template')
const { loadMockTemplateVars } = await import('../../src/main/lib/env-vars')
const { freePort, llmResponse, rawRead, serverDef, sseResponse } =
  await import('./mock-sse-fixtures')
type RouteSpec = import('./mock-sse-fixtures').RouteSpec

const ID = 'secret-template-mock'
const ENV_SECRET = 'CANARY-ENV-SECRET-90ab12'
const GLOBAL_SECRET = 'CANARY-GLOBAL-SECRET-34cd56'
const SHADOWED_GLOBAL = 'global-value-under-a-secret'
const PLAIN = 'plain-value-rendered'

let projectId = ''
let workspaceId = ''

beforeEach(() => {
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES ('env1', ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(workspaceId, projectId, now, now)
  const envVar = testDb.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, 'env1', ?, ?, 1, ?, ?)`,
  )
  envVar.run('e1', 'envSecret', ENV_SECRET, 1, ENV_SECRET)
  envVar.run('e2', 'plainVar', PLAIN, 0, PLAIN)
  envVar.run('e3', 'token', ENV_SECRET, 1, ENV_SECRET)
  envVar.run('e4', 'overridden', PLAIN, 0, PLAIN)
  const globalVar = testDb.prepare(
    `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  globalVar.run('g1', workspaceId, projectId, 'globalSecret', GLOBAL_SECRET, 1, GLOBAL_SECRET)
  // A secret environment value over a plain global: must not fall through to it.
  globalVar.run('g2', workspaceId, projectId, 'token', SHADOWED_GLOBAL, 0, SHADOWED_GLOBAL)
  // A plain environment value over a secret global: plain wins, as in Send.
  globalVar.run('g3', workspaceId, projectId, 'overridden', GLOBAL_SECRET, 1, GLOBAL_SECRET)
  invalidateSecretInventory()
})

afterEach(async () => {
  await mockServerManager.stopAll()
  await mockMcpServerManager.stopAll()
  invalidateSecretInventory()
})

async function start(routes: RouteSpec[]): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(serverDef(ID, port, routes, { projectId, workspaceId }))
  expect(r.ok).toBe(true)
  return port
}

const noSecret = (text: string): void => {
  expect(text).not.toContain(ENV_SECRET)
  expect(text).not.toContain(GLOBAL_SECRET)
  expect(text).not.toContain(SHADOWED_GLOBAL)
}

describe('loadMockTemplateVars', () => {
  it('returns non-secret values and the secret names, the winning definition deciding', () => {
    const { envVars, secretVarNames } = loadMockTemplateVars({ projectId })
    expect(envVars).toEqual({ plainVar: PLAIN, overridden: PLAIN })
    expect([...(secretVarNames ?? [])].sort()).toEqual(['envSecret', 'globalSecret', 'token'])
  })
})

describe('a secret global named like an inherited object property', () => {
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
    '%s stays secret: the environment does not define it',
    async (name) => {
      testDb
        .prepare(
          `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
        )
        .run(`g-${name}`, workspaceId, projectId, name, GLOBAL_SECRET, GLOBAL_SECRET)
      invalidateSecretInventory()
      const { envVars, secretVarNames } = loadMockTemplateVars({ projectId })
      expect(Object.hasOwn(envVars, name)).toBe(false)
      expect(secretVarNames).toContain(name)
      const port = await start([
        { path: '/r', response: { bodyType: 'text', body: `v={{${name}}}` } },
      ])
      const r = await rawRead(port, '/r')
      noSecret(r.text)
      expect(r.text).toBe(`v={{${name}}}`)
    },
  )
})

describe('an HTTP mock with a hand-written response', () => {
  it('body: a secret stays literal, a non-secret variable is rendered', async () => {
    const port = await start([
      {
        path: '/r',
        response: {
          bodyType: 'text',
          body: 'e={{envSecret}} g={{ globalSecret }} t={{token}} o={{overridden}} p={{plainVar}}',
        },
      },
    ])
    const r = await rawRead(port, '/r')
    expect(r.status).toBe(200)
    expect(r.text).toBe(`e={{envSecret}} g={{globalSecret}} t={{token}} o=${PLAIN} p=${PLAIN}`)
  })

  it('headers too', async () => {
    const port = await start([
      {
        path: '/h',
        response: {
          bodyType: 'text',
          body: 'ok',
          headers: [
            { name: 'x-secret', value: 'v={{envSecret}}' },
            { name: 'x-plain', value: '{{plainVar}}' },
          ],
        },
      },
    ])
    const r = await rawRead(port, '/h')
    expect(r.headers['x-secret']).toBe('v={{envSecret}}')
    expect(r.headers['x-plain']).toBe(PLAIN)
  })

  it('the Handlebars context holds no secret either: {{envVars.x}}, {{json this}}, {{#each envVars}}', async () => {
    const port = await start([
      {
        path: '/ctx',
        response: {
          bodyType: 'text',
          body: '[{{envVars.envSecret}}][{{json this}}][{{#each envVars}}{{@key}}={{this}};{{/each}}]',
        },
      },
    ])
    const r = await rawRead(port, '/ctx')
    noSecret(r.text)
    expect(r.text).toContain(`plainVar=${PLAIN};`)
    expect(r.text).not.toContain('secretVarNames')
  })

  it('a non-secret variable that refers to a secret does not resolve it', async () => {
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES ('e9', 'env1', 'chain', '{{envSecret}}', 1, 0, '')`,
      )
      .run()
    const port = await start([{ path: '/c', response: { bodyType: 'text', body: '{{chain}}' } }])
    expect((await rawRead(port, '/c')).text).toBe('{{envSecret}}')
  })

  it('a script sees the rendered response, so it has no secret to read', async () => {
    const port = await start([
      {
        path: '/s',
        response: {
          bodyType: 'text',
          body: '{{envSecret}}|{{plainVar}}',
          script: 'response.body = response.body + "|" + JSON.stringify(Object.keys(this))',
        },
      },
    ])
    const r = await rawRead(port, '/s')
    noSecret(r.text)
    expect(r.text).toContain(`{{envSecret}}|${PLAIN}`)
  })

  it('the log still masks a secret a client sends and the mock echoes', async () => {
    const port = await start([
      { path: '/e', response: { bodyType: 'text', body: 'got={{request.headers.x-trace}}' } },
    ])
    const r = await rawRead(port, '/e', { headers: { 'x-trace': ENV_SECRET } })
    expect(r.text).toBe(`got=${ENV_SECRET}`) // the client's own value
    expect(JSON.stringify(mockServerManager.getLogs(ID))).not.toContain(ENV_SECRET)
  })
})

describe('streams', () => {
  it('SSE frames', async () => {
    const port = await start([
      {
        path: '/sse',
        response: sseResponse('data: {{envSecret}}\n\ndata: {{plainVar}}', { intervalMs: 0 }),
      },
    ])
    expect((await rawRead(port, '/sse')).text).toBe(`data: {{envSecret}}\n\ndata: ${PLAIN}\n\n`)
  })

  it('an LLM stream', async () => {
    const port = await start([
      {
        path: '/v1/chat/completions',
        method: 'POST',
        response: llmResponse('s={{envSecret}} p={{plainVar}}', {}),
      },
    ])
    const r = await rawRead(port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'm',
        stream: false,
        messages: [{ role: 'user', content: 'x' }],
      }),
    })
    noSecret(r.text)
    expect(r.text).toContain(`s={{envSecret}} p=${PLAIN}`)
  })
})

describe('a Mock MCP server', () => {
  it('a template tool, a template resource and a prompt: secret literal, non-secret rendered', async () => {
    const port = await freePort()
    const started = await mockMcpServerManager.start({
      id: 'secret-mcp',
      name: 'Mock',
      description: '',
      host: '127.0.0.1',
      port,
      path: '/mcp',
      legacySse: false,
      authMode: 'none',
      bearerToken: '',
      latencyMs: 0,
      errorMode: { kind: 'none' },
      protocolPin: null,
      legacyMode: 'stateless',
      cacheTtlMs: 0,
      projectId,
      workspaceId,
      tools: [
        {
          name: 'leak',
          inputSchema: { type: 'object' },
          response: { kind: 'template', body: 's={{envSecret}} p={{plainVar}} [{{json envVars}}]' },
        },
      ],
      resources: [],
      prompts: [
        { name: 'p', messages: [{ role: 'user', text: 's={{globalSecret}} p={{plainVar}}' }] },
      ],
    } as Parameters<typeof mockMcpServerManager.start>[0])
    if (!started.ok) throw new Error(started.error)
    const client = new Client({ name: 't', version: '1' })
    const transport = new StreamableHTTPClientTransport(new URL(started.state.url as string))
    await client.connect(transport)
    try {
      const tool = JSON.stringify(await client.callTool({ name: 'leak', arguments: {} }))
      noSecret(tool)
      expect(tool).toContain(`s={{envSecret}} p=${PLAIN}`)
      const prompt = JSON.stringify(await client.getPrompt({ name: 'p', arguments: {} }))
      noSecret(prompt)
      expect(prompt).toContain(`s={{globalSecret}} p=${PLAIN}`)
    } finally {
      await client.close()
    }
  })
})

describe('renderTemplate', () => {
  const base = {
    request: {
      method: 'GET',
      path: '/',
      headers: {},
      query: {},
      params: {},
      body: null,
      bodyText: '',
    },
  }

  it('an escaped tag and a tag with no variable behind it behave as before', () => {
    const ctx = { ...base, envVars: { a: '1' }, secretVarNames: ['s'] }
    expect(renderTemplate('\\{{s}} {{unknown}}|{{a}}', ctx)).toBe('{{s}} |1')
  })

  it('a secret named like a request field cannot answer for it', () => {
    const ctx = { ...base, envVars: {}, secretVarNames: ['request.path'] }
    expect(renderTemplate('{{request.path}}', ctx)).toBe('/')
  })
})
