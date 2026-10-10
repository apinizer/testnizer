/**
 * Issues #195 / #196 — canary: a Send with a secret-typed variable's value in
 * the Authorization header, a literal X-API-Key, `?api_key=<secret>` and the
 * secret in the body used to land verbatim in `history.request_snapshot` and
 * in the Console's expanded row. Both are masked in MAIN now; the History row
 * keeps the `{{var}}` template for re-send.
 *
 * Fail-before: the snapshot was `JSON.stringify(options)` unmasked and
 * `emitConsoleEntry` sent the entry as built.
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

const SECRET = 'canary-S3CRET-value-42'
const LITERAL_KEY = 'literal-apikey-9f8e7d'

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

vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  fetchOAuth2Token: vi.fn(),
  // Echoes the request like httpbin does — the secret comes back in the body.
  executeHttpRequest: vi.fn(
    async (o: { method: string; url: string; headers?: Array<{ key: string; value: string }> }) => {
      const headers: Record<string, string> = {}
      for (const h of o.headers ?? []) headers[h.key] = h.value
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json', 'set-cookie': 'sid=session-cookie-1' },
        body: JSON.stringify({ headers, url: o.url }),
        bodySize: 10,
        timing: { total: 3 },
        actualRequest: {
          method: o.method,
          url: o.url,
          headers,
          body: `{"echo":"${SECRET}"}`,
        },
      }
    },
  ),
}))

vi.mock('../../../src/main/db/certificate.repo', () => ({
  listCertificatesForHost: () => [],
  getCertificate: () => undefined,
}))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')
const { registerHistoryHandlers } = await import('../../../src/main/ipc/history.handler')
const consoleLogger = await import('../../../src/main/lib/console-logger')
const envRepo = await import('../../../src/main/db/environment.repo')

let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  const ws = seedWorkspace(testDb)
  projectId = seedProject(testDb, ws)
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES ('env1', ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(ws, projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES ('v1', 'env1', 'secret', ?, 1, 1, ?)`,
    )
    .run(SECRET, SECRET)
  consoleLogger.setConsoleShowSecrets(false)
  registerRequestHandlers()
  registerConsoleHandlers()
  registerHistoryHandlers()
})

/** What the renderer sends: resolved request + the `{{var}}` template. */
function canarySend(): Promise<unknown> {
  return harness.invoke('request:send', {
    method: 'POST',
    url: `https://api.test/items?api_key=${SECRET}`,
    params: [{ key: 'api_key', value: SECRET, enabled: true }],
    headers: [
      { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
      { key: 'X-API-Key', value: LITERAL_KEY, enabled: true },
    ],
    body: { type: 'json', content: `{"note":"${SECRET}"}` },
    auth: { type: 'bearer', bearer: { token: SECRET } },
    _projectId: projectId,
    _configured: {
      method: 'POST',
      url: 'https://api.test/items?api_key={{secret}}',
      params: [{ key: 'api_key', value: '{{secret}}', enabled: true }],
      headers: [
        { key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
        { key: 'X-API-Key', value: LITERAL_KEY, enabled: true },
      ],
      body: { type: 'json', content: '{"note":"{{secret}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{secret}}' } },
    },
  })
}

function historyRowText(): string {
  const row = testDb
    .prepare('SELECT url, request_snapshot, response_snapshot FROM history')
    .get() as Record<string, string>
  return JSON.stringify(row)
}

describe('History row (issue #195)', () => {
  it('holds no secret value and no literal credential — URL, headers, query, body, auth, response', async () => {
    await canarySend()
    const text = historyRowText()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(LITERAL_KEY)
    expect(text).not.toContain('session-cookie-1')
  })

  it('keeps the {{var}} template for re-send; a literal credential is masked there too', async () => {
    await canarySend()
    const row = testDb.prepare('SELECT request_snapshot FROM history').get() as {
      request_snapshot: string
    }
    const snap = JSON.parse(row.request_snapshot)
    expect(snap.configured.url).toBe('https://api.test/items?api_key={{secret}}')
    expect(snap.configured.headers[0]).toMatchObject({
      key: 'Authorization',
      value: 'Bearer {{secret}}',
    })
    expect(snap.configured.headers[1]).toMatchObject({ key: 'X-API-Key', value: HISTORY_MASK })
    expect(snap.configured.auth).toEqual({ type: 'bearer', bearer: { token: '{{secret}}' } })
    expect(snap.configured.body.content).toBe('{"note":"{{secret}}"}')
    // The display copy still shows what was sent — masked.
    expect(snap.headers[0].value).toBe(HISTORY_MASK)
  })

  it('the template never reaches the engine', async () => {
    const { executeHttpRequest } = await import('../../../src/main/protocols/http.engine')
    vi.mocked(executeHttpRequest).mockClear()
    await canarySend()
    const arg = vi.mocked(executeHttpRequest).mock.calls[0][0] as Record<string, unknown>
    expect(arg._configured).toBeUndefined()
  })

  it('history:add from the renderer is masked too (every writer goes through addHistory)', async () => {
    await harness.invoke('history:add', {
      protocol: 'http',
      url: `https://x/?token=${SECRET}`,
      request_snapshot: JSON.stringify({ headers: { 'X-API-Key': LITERAL_KEY } }),
    })
    const text = historyRowText()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(LITERAL_KEY)
  })
})

describe('Console entry (issue #196)', () => {
  const consoleEntries = (): string[] =>
    sent.filter((s) => s.channel === 'console:log').map((s) => JSON.stringify(s.payload))

  it('is masked by default: no secret, no literal credential in the expanded row', async () => {
    await canarySend()
    const entries = consoleEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toContain(SECRET)
    expect(entries[0]).not.toContain(LITERAL_KEY)
    expect(entries[0]).toContain(HISTORY_MASK)
  })

  it('"Show secrets" on → NEW entries unmasked; the earlier entry stays masked; History stays masked', async () => {
    await canarySend()
    const res = (await harness.invoke('console:setShowSecrets', true)) as { data: boolean }
    expect(res.data).toBe(true)
    await canarySend()
    const [first, second] = consoleEntries()
    expect(first).not.toContain(SECRET)
    expect(second).toContain(SECRET)
    expect(second).toContain(LITERAL_KEY)
    // The toggle is a Console view switch — History never stores raw values.
    const rows = testDb.prepare('SELECT request_snapshot FROM history').all()
    expect(JSON.stringify(rows)).not.toContain(SECRET)
    await harness.invoke('console:setShowSecrets', false)
    await canarySend()
    expect(consoleEntries()[2]).not.toContain(SECRET)
  })

  it('console:maskEntry masks a renderer-built entry (Send script logs) — raw only with the toggle on', async () => {
    const entry = {
      protocol: 'http',
      level: 'info',
      category: 'system',
      message: 'Script logs (1) — GET https://x',
      scriptLogs: [{ level: 'log', message: `token=${SECRET}`, timestamp: 1 }],
    }
    const masked = (await harness.invoke('console:maskEntry', entry)) as {
      success: boolean
      data: typeof entry
    }
    expect(masked.success).toBe(true)
    expect(JSON.stringify(masked.data)).not.toContain(SECRET)
    consoleLogger.setConsoleShowSecrets(true)
    const raw = (await harness.invoke('console:maskEntry', entry)) as { data: typeof entry }
    expect(raw.data.scriptLogs[0].message).toBe(`token=${SECRET}`)
    consoleLogger.setConsoleShowSecrets(false)
    const bad = (await harness.invoke('console:maskEntry', 'nope')) as { success: boolean }
    expect(bad.success).toBe(false)
  })

  it('the toggle is held in memory only: off by default after a restart', async () => {
    consoleLogger.setConsoleShowSecrets(true)
    vi.resetModules()
    const fresh = await import('../../../src/main/lib/console-logger')
    expect(fresh.getConsoleShowSecrets()).toBe(false)
    const res = (await harness.invoke('console:getShowSecrets')) as { data: boolean }
    expect(res.data).toBe(true) // the running session still holds it
    // Nothing was written to settings / the DB.
    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%setting%'")
      .all() as Array<{ name: string }>
    for (const t of tables) {
      expect(JSON.stringify(testDb.prepare(`SELECT * FROM ${t.name}`).all())).not.toContain(
        'showSecrets',
      )
    }
  })
})

describe('Console secret inventory is cached, and variable writes invalidate it', () => {
  const consolePayloads = (): string[] =>
    sent.filter((s) => s.channel === 'console:log').map((s) => JSON.stringify(s.payload))

  it('a variable marked secret right now is masked in the very next entry (within the TTL)', () => {
    const NEW = 'freshly-marked-secret-321'
    consoleLogger.logEvent({ protocol: 'websocket', message: 'prime the cache' })
    envRepo.createVariable({ environment_id: 'env1', key: 'fresh', value: NEW, secret: true })
    consoleLogger.logEvent({ protocol: 'websocket', message: `frame ${NEW}` })
    const last = consolePayloads().at(-1) ?? ''
    expect(last).not.toContain(NEW)
    expect(last).toContain(HISTORY_MASK)
  })

  it('updating a variable invalidates too', () => {
    const v = envRepo.createVariable({
      environment_id: 'env1',
      key: 'k2',
      value: 'plain-value-0001',
    })
    consoleLogger.logEvent({ protocol: 'websocket', message: 'prime' })
    envRepo.updateVariable(v.id, { secret: true, value: 'now-secret-value-0002' })
    consoleLogger.logEvent({ protocol: 'websocket', message: 'x now-secret-value-0002' })
    expect(consolePayloads().at(-1)).not.toContain('now-secret-value-0002')
  })
})
