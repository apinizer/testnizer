/**
 * Canary scan follow-up (release 1.6.0) — a Send whose BODY carries a
 * credential-named field (`client_secret`) to an echo server that returns
 * the value under a neutral name. The request side was masked by name, but
 * the value came back verbatim in History `response_snapshot` and in the
 * Console entry's response body: `collectCredentialValues` never looked at
 * the body, so the value scrub did not know the value.
 *
 * Fail-before: both assertions below found the canary in the row / entry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedWorkspace,
  seedProject,
} from './helpers'
import { HISTORY_MASK } from '../../../src/shared/credential-headers'

const CANARY = 'CANARY-B-588a9c43-732c-40d0-b50e'

const sent: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

interface SentBody {
  type: string
  content?: string
  urlEncoded?: Array<{ key: string; value: string }>
}

vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  fetchOAuth2Token: vi.fn(),
  // An echo template like the canary scan's: the secret comes back under a
  // NEUTRAL name, so only the value scrub can catch it.
  executeHttpRequest: vi.fn(async (o: { method: string; url: string; body?: SentBody }) => {
    let wire = ''
    let secret = ''
    if (o.body?.type === 'json') {
      wire = o.body.content ?? ''
      secret = String((JSON.parse(wire) as Record<string, unknown>).client_secret ?? '')
    } else if (o.body?.urlEncoded) {
      wire = o.body.urlEncoded
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
      secret = o.body.urlEncoded.find((p) => p.key === 'client_secret')?.value ?? ''
    }
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: `Auth:[] Body:[${secret}] Said:hello`,
      bodySize: 10,
      timing: { total: 3 },
      actualRequest: { method: o.method, url: o.url, headers: {}, body: wire },
    }
  }),
}))

const SOAP_PW = 'CANARY-WSSE-pw-588a9c43-732c'

// WS-Security injected by the engine: the password is in the SENT envelope
// only (never in the payload's params), and the service echoes it back under
// a neutral element.
vi.mock('../../../src/main/protocols/soap.engine', () => ({
  parseWsdl: vi.fn(),
  parseWsdlFromContent: vi.fn(),
  generateEnvelope: vi.fn(),
  executeSoap: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/xml' },
    body: `<soapenv:Envelope><soapenv:Body><EchoResponse><Said>${SOAP_PW}</Said></EchoResponse></soapenv:Body></soapenv:Envelope>`,
    bodySize: 30,
    timing: { total: 5 },
    actualRequest: {
      headers: { 'content-type': 'text/xml' },
      body:
        '<soapenv:Envelope><soapenv:Header><wsse:Security><wsse:UsernameToken>' +
        '<wsse:Username>bob</wsse:Username>' +
        `<wsse:Password Type="#PasswordText">${SOAP_PW}</wsse:Password>` +
        '</wsse:UsernameToken></wsse:Security></soapenv:Header>' +
        '<soapenv:Body><Echo/></soapenv:Body></soapenv:Envelope>',
    },
  })),
}))

vi.mock('../../../src/main/db/certificate.repo', () => ({
  listCertificatesForHost: () => [],
  getCertificate: () => undefined,
}))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerSoapHandlers } = await import('../../../src/main/ipc/soap.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')
const consoleLogger = await import('../../../src/main/lib/console-logger')

let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  consoleLogger.setConsoleShowSecrets(false)
  registerRequestHandlers()
  registerConsoleHandlers()
  registerSoapHandlers()
})

function historyRow(): { url: string; request_snapshot: string; response_snapshot: string } {
  return testDb.prepare('SELECT url, request_snapshot, response_snapshot FROM history').get() as {
    url: string
    request_snapshot: string
    response_snapshot: string
  }
}

const consoleEntries = (): string[] =>
  sent.filter((s) => s.channel === 'console:log').map((s) => JSON.stringify(s.payload))

const BODIES: Array<[string, SentBody]> = [
  ['json body', { type: 'json', content: `{"grant_type":"x","client_secret":"${CANARY}"}` }],
  [
    'form body',
    {
      type: 'x-www-form-urlencoded',
      urlEncoded: [
        { key: 'grant_type', value: 'client_credentials' },
        { key: 'client_secret', value: CANARY },
      ],
    },
  ],
]

describe.each(BODIES)('body credential echoed by the server (%s)', (_label, body) => {
  async function send(): Promise<void> {
    const r = (await harness.invoke('request:send', {
      method: 'POST',
      url: 'https://echo.test/token',
      headers: [],
      body,
      _projectId: projectId,
    })) as { success: boolean; data: { body: string } }
    expect(r.success).toBe(true)
    // The live response is never masked — it is what the user debugs.
    expect(r.data.body).toContain(CANARY)
  }

  it('History row: the canary is absent from request AND response snapshot', async () => {
    await send()
    const row = historyRow()
    expect(JSON.stringify(row)).not.toContain(CANARY)
    expect(JSON.parse(row.response_snapshot).body).toBe(`Auth:[] Body:[${HISTORY_MASK}] Said:hello`)
  })

  it('Console entry: the canary is absent from the request and the response body', async () => {
    await send()
    const entries = consoleEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toContain(CANARY)
    expect(entries[0]).toContain(`Body:[${HISTORY_MASK}]`)
  })
})

describe('SOAP: WS-Security password echoed under a neutral element', () => {
  async function send(): Promise<void> {
    const r = (await harness.invoke('soap:execute', {
      wsdlUrl: 'https://soap.test/svc?wsdl',
      endpointUrl: 'https://soap.test/svc',
      operationName: 'Echo',
      soapVersion: '1.1',
      params: {},
      _projectId: projectId,
    })) as { success: boolean; data: { body: string } }
    expect(r.success).toBe(true)
    expect(r.data.body).toContain(SOAP_PW) // the live response is never masked
  }

  it('History row: absent from the envelope AND the response snapshot', async () => {
    await send()
    const row = historyRow()
    expect(JSON.stringify(row)).not.toContain(SOAP_PW)
    expect(JSON.parse(row.response_snapshot).body).toContain(`<Said>${HISTORY_MASK}</Said>`)
    // The rest of the reply stays readable (XML is what the user debugs).
    expect(JSON.parse(row.request_snapshot).envelope).toContain(
      '<wsse:Username>bob</wsse:Username>',
    )
  })

  it('Console entry: absent from the request and the response body', async () => {
    await send()
    const entries = consoleEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toContain(SOAP_PW)
    expect(entries[0]).toContain(`<Said>${HISTORY_MASK}</Said>`)
  })
})
