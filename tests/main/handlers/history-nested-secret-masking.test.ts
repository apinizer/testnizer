/**
 * Issue #195 review — History kept credentials in fields the name rule never
 * reached, through the real handlers (`graphql:execute`, `soap:execute`,
 * `request:send`, `history:add`) into the real `addHistory`:
 *
 *  - GraphQL `variables` (a JSON string) — flat field + `configured.meta`;
 *  - SOAP `params` with a nested `Credentials.Password`;
 *  - WebSocket `composerContent` / Socket.IO `emitPayload` in `configured`;
 *  - an OAuth token endpoint's reply (`access_token`, `refresh_token`) in
 *    `response_snapshot`;
 *  - URL userinfo on a templated host (`https://u:p@{{host}}`), which
 *    `stripUrlCredentials` cannot parse — flat url, snapshot url, `configured.url`.
 *
 * Fail-before: each value below was stored verbatim.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const PW = 'hunter2-login-pw'
const SOAP_PW = 'soap-nested-pw-777'
const WS_TOKEN = 'ws-composer-tok-31337'
const SIO_KEY = 'sio-emit-apikey-4242'
const ACCESS = 'oauth-access-token-AAAA1111'
const REFRESH = 'oauth-refresh-token-BBBB2222'
const URL_PW = 'url-userinfo-pw-9999'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/protocols/graphql.engine', () => ({
  executeQuery: vi.fn(async (o: { query: string; variables?: string }) => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{"data":{"login":{"ok":true}}}',
    bodySize: 30,
    timing: { total: 4 },
    actualRequest: {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: o.query, variables: JSON.parse(o.variables ?? '{}') }),
    },
  })),
  introspect: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../../src/main/protocols/soap.engine', () => ({
  parseWsdl: vi.fn(),
  parseWsdlFromContent: vi.fn(),
  generateEnvelope: vi.fn(),
  executeSoap: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '<Envelope><Body><Ok/></Body></Envelope>',
    bodySize: 30,
    timing: { total: 5 },
    actualRequest: {
      headers: {},
      body: `<Envelope><Body><Login><Password>${SOAP_PW}</Password></Login></Body></Envelope>`,
    },
  })),
}))

vi.mock('../../../src/main/protocols/http.engine', () => ({
  // The real one cannot parse a templated host and returns the URL as is.
  stripUrlCredentials: (u: string) => u,
  fetchOAuth2Token: vi.fn(),
  executeHttpRequest: vi.fn(async (o: { method: string; url: string }) => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      access_token: ACCESS,
      refresh_token: REFRESH,
      token_type: 'Bearer',
      expires_in: 3600,
    }),
    bodySize: 100,
    timing: { total: 3 },
    actualRequest: {
      method: o.method,
      url: o.url,
      headers: {},
      body: 'grant_type=client_credentials',
    },
  })),
}))

vi.mock('../../../src/main/db/certificate.repo', () => ({
  listCertificatesForHost: () => [],
  getCertificate: () => undefined,
}))

const { registerGraphqlHandlers } = await import('../../../src/main/ipc/graphql.handler')
const { registerSoapHandlers } = await import('../../../src/main/ipc/soap.handler')
const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerHistoryHandlers } = await import('../../../src/main/ipc/history.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerGraphqlHandlers()
  registerSoapHandlers()
  registerRequestHandlers()
  registerHistoryHandlers()
})

function historyText(): string {
  return JSON.stringify(
    testDb.prepare('SELECT url, request_snapshot, response_snapshot FROM history').all(),
  )
}

describe('History masks nested / body-like credentials (issue #195)', () => {
  it('GraphQL login mutation variables {"password": …} — flat + configured', async () => {
    const variables = `{\n  "email": "a@b.c",\n  "password": "${PW}"\n}`
    const res = (await harness.invoke('graphql:execute', {
      url: 'https://api.test/graphql',
      query: 'mutation Login($email: String!, $password: String!) { login { ok } }',
      variables,
      _configured: {
        url: 'https://api.test/graphql',
        meta: { graphql: { url: 'https://api.test/graphql', query: 'q', variables } },
      },
    })) as { success: boolean }
    expect(res.success).toBe(true)
    const text = historyText()
    expect(text).toContain('a@b.c')
    expect(text).not.toContain(PW)
  })

  it('SOAP params with nested Credentials.Password', async () => {
    const res = (await harness.invoke('soap:execute', {
      wsdlUrl: 'https://soap.test/svc?wsdl',
      endpointUrl: 'https://soap.test/svc',
      operationName: 'Login',
      soapVersion: '1.1',
      params: { Login: { Credentials: { Username: 'bob', Password: SOAP_PW } } },
    })) as { success: boolean }
    expect(res.success).toBe(true)
    const text = historyText()
    expect(text).toContain('bob')
    expect(text).not.toContain(SOAP_PW)
  })

  it('WebSocket composerContent and Socket.IO emitPayload (configured)', async () => {
    await harness.invoke('history:add', {
      protocol: 'websocket',
      method: 'CONNECT',
      url: 'wss://ws.test',
      request_snapshot: JSON.stringify({
        url: 'wss://ws.test',
        configured: {
          url: 'wss://ws.test',
          meta: {
            websocket: { composerContent: `{\n  "type": "auth",\n  "token": "${WS_TOKEN}"\n}` },
          },
        },
      }),
    })
    await harness.invoke('history:add', {
      protocol: 'socketio',
      method: 'CONNECT',
      url: 'https://sio.test',
      request_snapshot: JSON.stringify({
        configured: { meta: { socketio: { emitPayload: `{"auth":{"apiKey":"${SIO_KEY}"}}` } } },
      }),
    })
    const text = historyText()
    expect(text).not.toContain(WS_TOKEN)
    expect(text).not.toContain(SIO_KEY)
  })

  it('OAuth token endpoint reply: access_token / refresh_token masked in response_snapshot; the live result is not', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'POST',
      url: 'https://as.test/oauth/token',
      headers: [],
      params: [],
    })) as { success: boolean; data: { body: string } }
    expect(res.success).toBe(true)
    // What the editor's response pane shows: untouched.
    expect(res.data.body).toContain(ACCESS)
    const text = historyText()
    expect(text).not.toContain(ACCESS)
    expect(text).not.toContain(REFRESH)
    expect(text).toContain('3600')
  })

  it('URL userinfo on a templated host — flat url, snapshot url, configured.url', async () => {
    const url = `https://admin:${URL_PW}@{{host}}/x`
    await harness.invoke('request:send', {
      method: 'GET',
      url,
      headers: [],
      params: [],
      _configured: { method: 'GET', url },
    })
    expect(historyText()).not.toContain(URL_PW)
    const row = testDb.prepare('SELECT request_snapshot FROM history').get() as {
      request_snapshot: string
    }
    // A {{var}} userinfo in the template would be kept; this one is a literal.
    expect(JSON.parse(row.request_snapshot).configured.url).toBe('https://••••••@{{host}}/x')
  })
})
