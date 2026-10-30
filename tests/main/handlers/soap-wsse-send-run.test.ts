/**
 * SOAP editor WS-Security on Send and Run (tester report 2026-10-30).
 *
 * Before: Send posted the raw envelope and swapped WS-Security for an HTTP
 * `Authorization: Basic` header built from the UsernameToken credentials; Run
 * ignored the saved `metadata.soap.wsSecurity` entirely. Neither put a
 * `wsse:Security` header in the envelope.
 *
 * Send here is the REAL renderer store (`soap.store.sendSoap`) wired to the
 * REAL `request:send` handler; Run is the real `runner:execute` loop. Both hit
 * one local server that records the body and the Authorization header — the
 * assertions are on what actually reached the wire. `{{user}}` / `{{pw}}` are
 * ordinary (non-secret) environment variables, so the masking checks prove the
 * WS-Security password itself is registered as a credential value.
 */
import 'reflect-metadata'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const sentToRenderer: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sentToRenderer.push({ channel, payload }),
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')
const { verifySignature, applyWsSecurity } = await import(
  '../../../src/main/protocols/wsse.engine'
)
const { useSoapStore } = await import('../../../src/renderer/stores/soap.store')
const { useEnvironmentStore } = await import('../../../src/renderer/stores/environment.store')
const { useResponseStore } = await import('../../../src/renderer/stores/response.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../../src/renderer/stores/workspace.store')

const CERTS = path.resolve(__dirname, '../../fixtures/certs')
const certPem = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
const keyPem = readFileSync(path.join(CERTS, 'server.key'), 'utf8')

const USER = 'alice-wsse'
const PW = 'Kq7-wsse-CANARY-5f3e91'

const ENVELOPE = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body>
      <tem:Add><tem:intA>{{a}}</tem:intA><tem:intB>2</tem:intB></tem:Add>
   </soapenv:Body>
</soapenv:Envelope>`

interface Received {
  body: string
  authorization?: string
}
let received: Received[] = []
let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += String(c)))
        req.on('end', () => {
          received.push({ body, authorization: req.headers.authorization })
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          // Echo the request back — the password must also be scrubbed from
          // the persisted RESPONSE (value scan), not only from the request.
          res.end(
            req.url?.startsWith('/echo')
              ? `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><Echo><![CDATA[${body}]]></Echo></soapenv:Body></soapenv:Envelope>`
              : '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><AddResponse>3</AddResponse></soapenv:Body></soapenv:Envelope>',
          )
        })
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

/** The variables both paths resolve: Send from the env store, Run from the DB. */
const VARS: Record<string, string> = { user: USER, pw: PW, a: '1' }

beforeEach(() => {
  harness.reset()
  received = []
  sentToRenderer.length = 0
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
  for (const [k, v] of Object.entries(VARS)) {
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES (?, 'env1', ?, ?, 1, 0, NULL)`,
      )
      .run(`v-${k}`, k, v)
  }
  registerRequestHandlers()
  registerRunnerHandlers()
  registerConsoleHandlers()

  // Renderer side of Send: the store's IPC goes straight to the main handler.
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      request: {
        send: (payload: unknown) => harness.invoke('request:send', payload),
        cancel: vi.fn(),
      },
    },
  }
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    globalVariables: [],
    environments: [
      {
        id: 'env1',
        name: 'Dev',
        variables: Object.entries(VARS).map(([key, value]) => ({
          id: `v-${key}`,
          key,
          value,
          initialValue: '',
          enabled: true,
          secret: false,
        })),
      },
    ] as never,
    activeEnvironmentId: 'env1',
  })
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId, activeProjectId: projectId })
})

afterEach(() => {
  testDb.close()
})

// ─── helpers ────────────────────────────────────────────────────

type WsSec = Record<string, unknown>

function utConfig(): WsSec {
  return {
    enabled: true,
    modes: ['username-token', 'timestamp'],
    usernameToken: {
      username: '{{user}}',
      password: '{{pw}}',
      passwordType: 'PasswordText',
      nonce: true,
      created: true,
    },
    timestamp: { ttlSeconds: 300 },
  }
}

function signConfig(): WsSec {
  return {
    enabled: true,
    modes: ['username-token', 'sign'],
    usernameToken: {
      username: '{{user}}',
      password: '{{pw}}',
      passwordType: 'PasswordText',
      nonce: false,
      created: false,
    },
    sign: {
      privateKeyPem: keyPem,
      certPem,
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    },
  }
}

/** The legacy single-mode shape an old row carries (the editor merges it over `modes: []`). */
function legacyConfig(): WsSec {
  return { enabled: true, type: 'username-token', username: '{{user}}', password: '{{pw}}' }
}

async function send(wsSecurity: WsSec, urlPath = '/svc'): Promise<Received> {
  useSoapStore.setState({
    ...useSoapStore.getState(),
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    mode: 'manual',
    rawXml: ENVELOPE,
    endpointUrl: `${base}${urlPath}`,
    manualSoapAction: 'http://tempuri.org/Add',
    manualSoapVersion: 'soap11',
    withheldCredentials: [],
    // The editor merges a restored config over its default (`modes: []`).
    wsSecurity: { modes: [], ...wsSecurity } as never,
  })
  const before = received.length
  await useSoapStore.getState().sendSoap()
  const res = useResponseStore.getState().response
  expect(res?.error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return received[received.length - 1]
}

/** A SOAP endpoint row as Ctrl+S writes it (`request_schema.metadata.soap`). */
function seedSoapEndpoint(wsSecurity: WsSec, urlPath = '/svc'): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'POST',
    url: `${base}${urlPath}`,
    params: [],
    headers: [],
    body: { type: 'xml', content: ENVELOPE },
    auth: { type: 'wsse' },
    assertions: [],
    metadata: {
      soap: {
        mode: 'manual',
        endpointUrl: `${base}${urlPath}`,
        rawXml: ENVELOPE,
        manualSoapAction: 'http://tempuri.org/Add',
        manualSoapVersion: 'soap11',
        wsSecurity,
      },
    },
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Add', 'soap', 'POST', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, urlPath, schema, now, now)
  return id
}

interface RunData {
  results: Array<Record<string, unknown>>
}

async function run(wsSecurity: WsSec, urlPath = '/svc'): Promise<{ wire: Received; data: RunData }> {
  const id = seedSoapEndpoint(wsSecurity, urlPath)
  const before = received.length
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: RunData }
  expect(res.success).toBe(true)
  expect(res.data?.results[0].error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return { wire: received[received.length - 1], data: res.data! }
}

/** What the server got, as a parsed DOM (fatal on malformed XML). */
function parseWire(xml: string) {
  return new DOMParser({
    onError: (level: string, msg: string) => {
      throw new Error(`XML ${level}: ${msg}`)
    },
  }).parseFromString(xml, 'text/xml')
}

function assertUsernameToken(wire: Received, withTimestamp: boolean): void {
  expect(wire.authorization).toBeUndefined()
  expect(wire.body).toContain('<wsse:Security')
  expect(wire.body).toContain(`<wsse:Username>${USER}</wsse:Username>`)
  expect(wire.body).toContain(`>${PW}</wsse:Password>`)
  expect(wire.body).not.toContain('{{')
  expect(wire.body).toContain('<tem:intA>1</tem:intA>')
  if (withTimestamp) expect(wire.body).toContain('<wsu:Timestamp')
  const doc = parseWire(wire.body)
  const sec = doc.getElementsByTagNameNS(
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
    'Security',
  )
  expect(sec.length).toBe(1)
  expect(sec[0].parentNode?.localName).toBe('Header')
}

// ─── Send ≡ Run ────────────────────────────────────────────────

describe('SOAP WS-Security reaches the wire on Send AND Run', () => {
  it('Send: UsernameToken + Timestamp in the envelope, {{var}} resolved, no Basic auth', async () => {
    assertUsernameToken(await send(utConfig()), true)
  })

  it('Run: the saved metadata.soap.wsSecurity is applied the same way', async () => {
    const { wire } = await run(utConfig())
    assertUsernameToken(wire, true)
  })

  it('Sign: the body the server received verifies on both paths', async () => {
    const sent = await send(signConfig())
    expect(verifySignature(sent.body, certPem).valid).toBe(true)
    assertUsernameToken(sent, false)
    const { wire } = await run(signConfig())
    expect(verifySignature(wire.body, certPem).valid).toBe(true)
    assertUsernameToken(wire, false)
  })

  it('a legacy single-mode row sends a UsernameToken on both paths', async () => {
    assertUsernameToken(await send(legacyConfig()), false)
    const { wire } = await run(legacyConfig())
    assertUsernameToken(wire, false)
  })

  it('WS-Security disabled → the envelope goes out as typed on both paths', async () => {
    const off = { ...utConfig(), enabled: false }
    const s = await send(off)
    expect(s.body).not.toContain('wsse:Security')
    expect(s.authorization).toBeUndefined()
    const { wire } = await run(off)
    expect(wire.body).not.toContain('wsse:Security')
  })

  it('a sign config without key material fails visibly instead of sending unsigned', async () => {
    const broken = {
      ...signConfig(),
      sign: { ...(signConfig().sign as object), privateKeyPem: '', certPem: '' },
    }
    useSoapStore.setState({
      ...useSoapStore.getState(),
      mode: 'manual',
      rawXml: ENVELOPE,
      endpointUrl: `${base}/svc`,
      wsSecurity: broken as never,
    })
    await useSoapStore.getState().sendSoap()
    expect(useResponseStore.getState().response?.error).toMatch(/private key/i)
    expect(received).toHaveLength(0)
  })
})

// ─── masking ───────────────────────────────────────────────────

function persisted(): string {
  const history = testDb.prepare('SELECT * FROM history').all()
  const runs = testDb.prepare('SELECT results_json FROM runner_history').all()
  return JSON.stringify({ history, runs })
}

function consoleEntries(): string {
  return JSON.stringify(sentToRenderer.filter((s) => s.channel === 'console:log'))
}

describe('the WS-Security password never reaches a persistent sink', () => {
  it('Send (echoing server): History row and Console are masked', async () => {
    const wire = await send(utConfig(), '/echo')
    expect(wire.body).toContain(PW) // it really went out
    expect(persisted()).not.toContain(PW)
    expect(consoleEntries().length).toBeGreaterThan(2)
    expect(consoleEntries()).not.toContain(PW)
  })

  it('Run (echoing server): run results, progress, runner_history, History and Console are masked', async () => {
    const { wire, data } = await run(utConfig(), '/echo')
    expect(wire.body).toContain(PW)
    expect(JSON.stringify(data.results)).not.toContain(PW)
    expect(
      JSON.stringify(sentToRenderer.filter((s) => s.channel === 'runner:progress')),
    ).not.toContain(PW)
    expect(persisted()).not.toContain(PW)
    expect(consoleEntries()).not.toContain(PW)
  })

  it('a short password (below the value-scan length) is masked by the wsse:Password name rule', async () => {
    const short = { ...utConfig(), usernameToken: { ...(utConfig().usernameToken as object), password: 'Zq9' } }
    await send(short)
    await run(short)
    expect(persisted()).not.toMatch(/>Zq9</)
    expect(consoleEntries()).not.toMatch(/>Zq9</)
  })

  it('Run History: the body is masked BEFORE it is clipped to 4 KiB', async () => {
    // Push the password across the 4096-character clip so a clip-then-mask
    // order would leave a password prefix with no closing tag to match.
    const cfg = {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: USER,
        password: PW,
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    }
    const probe = await applyWsSecurity(ENVELOPE.replace('{{a}}', '1'), cfg as never)
    const at = probe.indexOf(PW)
    // `xmlns:pad="urn:…" ` adds 17 characters around the padding.
    const pad = 'x'.repeat(4096 - 4 - at - 17)
    const padded = ENVELOPE.replace('xmlns:tem=', `xmlns:pad="urn:${pad}" xmlns:tem=`)
    const id = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'Pad', 'soap', 'POST', '/svc', 'developing', ?, 0, ?, ?)`,
      )
      .run(
        id,
        projectId,
        JSON.stringify({
          method: 'POST',
          url: `${base}/svc`,
          body: { type: 'xml', content: padded },
          metadata: { soap: { mode: 'manual', manualSoapVersion: 'soap11', wsSecurity: cfg } },
        }),
        now,
        now,
      )
    await harness.invoke('runner:execute', { projectId, workspaceId, endpointIds: [id] })
    const wire = received[received.length - 1].body
    const cut = wire.indexOf(PW)
    expect(cut).toBeLessThan(4096)
    expect(cut + PW.length).toBeGreaterThan(4096)
    const row = testDb.prepare('SELECT request_snapshot FROM history').get() as {
      request_snapshot: string
    }
    expect(row.request_snapshot).not.toContain(PW.slice(0, 3))
  })
})
