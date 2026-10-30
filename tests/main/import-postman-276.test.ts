/**
 * Issue #276 (part 1) — Postman v2.x import hardening.
 *
 * Real production schema (`initDatabase` in a temp userData dir) and the real
 * `import:postman` / `savedResponse:listByProject` IPC handlers; the OS
 * keychain is a reversible stand-in so secret values are really sealed.
 *
 * Fail-before (verified against the importer before this change, see the
 * issue report):
 *  - an object `description` aborted the import ("Too few parameter values");
 *  - a string `header` crashed `.map`, and the rows before it STAYED (partial
 *    import, no transaction);
 *  - `request` as a string imported with an EMPTY url;
 *  - `secret: true` collection variables were stored as plain text;
 *  - `disabled` collection variables were enabled; descriptions dropped;
 *  - folder / request variables, saved examples, path variables and
 *    protocolProfileBehavior were dropped silently;
 *  - OAuth 2.0 always became client_credentials; awsv4 / hawk / oauth1 / jwt
 *    became "No auth" without a word.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-pm276-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`k1|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer): string => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      return text.slice(text.indexOf('|') + 1)
    },
  },
}))
vi.mock('../../src/main/protocols/grpc.engine', () => ({ loadProto: () => Promise.resolve({}) }))

import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { registerSavedResponseHandlers } from '../../src/main/ipc/saved-response.handler'
import { importPostmanCollection } from '../../src/main/import/postman/v2'
import { loadEnvVars } from '../../src/main/lib/env-vars'
import {
  readSharedProjectSettings,
  writeSharedProjectSettings,
} from '../../src/main/lib/project-settings'
import {
  projectAuthToAuthConfig as mainProjectAuth,
  resolveEffectiveAuth as mainResolve,
} from '../../src/main/lib/auth-inheritance'
import {
  projectAuthToAuthConfig as rendererProjectAuth,
  resolveEffectiveAuth as rendererResolve,
} from '../../src/renderer/lib/auth-inheritance'
import type { PostmanCollection } from '../../src/main/import/postman/types'

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
let workspaceId = ''
let seq = 0

function newProject(): string {
  const id = `pm276-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, id, now, now)
  return id
}

function newFolder(projectId: string, name = 'Import'): string {
  const id = `f-${++seq}`
  getDb()
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)`,
    )
    .run(id, projectId, name)
  return id
}

interface ImportData {
  success?: boolean
  error?: string
  endpointCount?: number
  folderCount?: number
  exampleCount?: number
  warnings?: string[]
}

async function importDoc(projectId: string, doc: unknown, folderId?: string): Promise<ImportData> {
  const res = (await ipcHandlers.get('import:postman')!(
    {},
    { projectId, content: JSON.stringify(doc), folderId: folderId ?? null },
  )) as { success: boolean; data?: ImportData; error?: string }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

interface EndpointRow {
  id: string
  name: string
  folder_id: string | null
  method: string
  path: string
  description: string | null
  request_schema: string
}
function endpoints(projectId: string): Array<EndpointRow & { schema: Record<string, unknown> }> {
  return (
    getDb()
      .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order, rowid')
      .all(projectId) as EndpointRow[]
  ).map((r) => ({ ...r, schema: JSON.parse(r.request_schema) as Record<string, unknown> }))
}
const byName = (pid: string, name: string) => endpoints(pid).find((e) => e.name === name)!
const count = (table: string, pid: string): number =>
  (
    getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(pid) as {
      n: number
    }
  ).n

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  registerSavedResponseHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
})

// ─── 0. The verified code-read claims (fail before, pass after) ──────────────

describe('issue #276 — malformed-but-real v2.x shapes import instead of aborting', () => {
  it('an object description { content } is stored as its text (was: whole import aborted)', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: {
        name: 'D',
        schema: SCHEMA,
        description: { content: 'Coll **md**', type: 'text/markdown' },
      },
      item: [
        {
          name: 'x',
          request: {
            method: 'GET',
            url: 'http://h/x',
            description: { content: 'Request md', type: 'text/markdown' },
          },
        },
      ],
    })
    expect(data.success).toBe(true)
    expect(byName(pid, 'x').description).toBe('Request md')
  })

  it('a string header block "K: V\\n" becomes rows, // marks a disabled one (was: crash)', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'H', schema: SCHEMA },
      item: [
        {
          name: 'x',
          request: {
            method: 'GET',
            url: 'http://h/x',
            header: 'Accept: application/json\n//X-Off: 1\n',
          },
        },
      ],
    })
    expect(data.success).toBe(true)
    expect(byName(pid, 'x').schema.headers).toMatchObject([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Off', value: '1', enabled: false },
    ])
  })

  it('a request given as a bare URL string keeps its URL (was: empty URL, path "/")', async () => {
    const pid = newProject()
    await importDoc(pid, {
      info: { name: 'S', schema: SCHEMA },
      item: [{ name: 'x', request: 'http://h/str?q=1' }],
    })
    const ep = byName(pid, 'x')
    expect(ep.method).toBe('GET')
    expect(ep.schema.url).toBe('http://h/str?q=1')
    expect(ep.path).toBe('/str')
  })

  it('the item after a once-fatal one is imported too (was: partial import, then error)', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'P', schema: SCHEMA },
      item: [
        { name: 'ok1', request: { method: 'GET', url: 'http://h/1' } },
        { name: 'was-boom', request: { method: 'GET', url: 'http://h/2', header: 'A: b' } },
        { name: 'ok3', request: { method: 'GET', url: 'http://h/3' } },
      ],
    })
    expect(data.endpointCount).toBe(3)
    expect(endpoints(pid).map((e) => e.name)).toEqual(['ok1', 'was-boom', 'ok3'])
  })

  it('an unexpected failure mid-import rolls EVERYTHING back (one transaction)', () => {
    const pid = newProject()
    const boom = {
      get name(): string {
        throw new Error('boom on item 3')
      },
    }
    const collection = {
      info: { name: 'Tx', schema: SCHEMA },
      variable: [{ key: 'v', value: '1' }],
      event: [{ listen: 'prerequest', script: { exec: ['pre()'] } }],
      item: [
        { name: 'Folder', item: [{ name: 'a', request: { method: 'GET', url: 'http://h/a' } }] },
        { name: 'b', request: { method: 'GET', url: 'http://h/b' } },
        boom,
      ],
    } as unknown as PostmanCollection
    expect(() => importPostmanCollection(pid, collection, null, { apisTree: true })).toThrow(/boom/)
    expect(count('endpoints', pid)).toBe(0)
    expect(count('folders', pid)).toBe(0)
    expect(count('environments', pid)).toBe(0)
    // The collection variable written before the throw is rolled back too.
    expect(count('global_variables', pid)).toBe(0)
    expect(readSharedProjectSettings(pid)).toBeNull()
  })

  // Issue #281: collection variables are project variables — always active,
  // below the environment. They used to land in an inactive "<collection>
  // (imported)" environment that neither Send nor Run read.
  it('collection variables resolve while another environment is active', async () => {
    const pid = newProject()
    const now = Date.now()
    getDb()
      .prepare(
        `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
      )
      .run(`env-${pid}`, workspaceId, pid, now, now)
    const data = await importDoc(pid, {
      info: { name: 'Vars', schema: SCHEMA },
      variable: [{ key: 'baseUrl', value: 'http://coll' }],
      item: [{ name: 'x', request: { method: 'GET', url: '{{baseUrl}}/x' } }],
    })
    expect(loadEnvVars({ projectId: pid })).toMatchObject({ baseUrl: 'http://coll' })
    expect(count('environments', pid)).toBe(1)
    expect((data.warnings ?? []).join('\n')).not.toMatch(/active environment/)
  })
})

// ─── 5. Variables, secrets ───────────────────────────────────────────────────

describe('issue #276 — collection / folder / request variables', () => {
  it('disabled → enabled 0, secret:true and type secret → sealed, descriptions kept, folder vars appended', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'V', schema: SCHEMA },
      variable: [
        { key: 'plain', value: 'p', description: 'a plain one' },
        { key: 'off', value: 'x', disabled: true },
        { key: 'tok', value: 'TOP-SECRET-1', secret: true },
        { key: 'pwd', value: 'TOP-SECRET-2', type: 'secret' },
        { key: 'num', value: 5 },
        { key: 'vault', secret: true, source: { provider: 'postman', type: 'local' } },
      ],
      item: [
        {
          name: 'Users',
          variable: [{ key: 'userId', value: '42' }],
          item: [
            {
              name: 'Get',
              variable: [{ key: 'plain', value: 'request-wins' }],
              request: { method: 'GET', url: 'http://h/{{userId}}' },
            },
          ],
        },
      ],
    })
    // Issue #281: the project variables, no environment.
    expect(count('environments', pid)).toBe(0)
    const rows = getDb()
      .prepare(
        'SELECT key, value, initial_value, description, enabled, secret FROM global_variables WHERE project_id = ?',
      )
      .all(pid) as Array<Record<string, string | number | null>>
    const row = (k: string) => rows.find((r) => r.key === k)!
    // The first definition (collection) wins; the request-level one is reported.
    expect(row('plain')).toMatchObject({ value: 'p', enabled: 1, secret: 0 })
    expect(row('plain').description).toBe('a plain one')
    expect(row('off')).toMatchObject({ enabled: 0 })
    expect(row('num')).toMatchObject({ value: '5' })
    expect(row('userId')).toMatchObject({ value: '42' })
    for (const k of ['tok', 'pwd']) {
      expect(row(k).secret).toBe(1)
      expect(String(row(k).value)).toMatch(/^enc:v1:/)
      expect(String(row(k).initial_value)).toMatch(/^enc:v1:/)
    }
    expect(row('vault')).toMatchObject({ secret: 1, value: '' })
    expect(String(row('vault').description)).toMatch(/vault/i)
    // Plaintext never at rest, anywhere in the variable table.
    const raw = JSON.stringify(getDb().prepare('SELECT * FROM global_variables').all())
    expect(raw).not.toContain('TOP-SECRET-1')
    expect(raw).not.toContain('TOP-SECRET-2')
    // …but Run resolves them.
    expect(loadEnvVars({ projectId: pid, workspaceId })).toMatchObject({
      tok: 'TOP-SECRET-1',
      pwd: 'TOP-SECRET-2',
      userId: '42',
    })
    const w = data.warnings ?? []
    expect(w.some((x) => /"Users": folder\/request variables \(userId\)/.test(x))).toBe(true)
    expect(
      w.some((x) =>
        /the variable\(s\) "plain" are defined more than once with different values; the first definition was kept/.test(
          x,
        ),
      ),
    ).toBe(true)
    expect(w.some((x) => /"vault" is linked to a postman vault secret/.test(x))).toBe(true)
  })

  it('an environment export with secret values is sealed too', async () => {
    const pid = newProject()
    const res = (await ipcHandlers.get('import:postmanEnvironment')!(
      {},
      {
        projectId: pid,
        content: JSON.stringify({
          name: 'Prod',
          _postman_variable_scope: 'environment',
          values: [
            { key: 'apiKey', value: 'ENV-SECRET-3', type: 'secret', enabled: true },
            { key: 'host', value: 'h', description: 'the host' },
          ],
        }),
      },
    )) as { success: boolean }
    expect(res.success).toBe(true)
    const raw = JSON.stringify(getDb().prepare('SELECT * FROM environment_variables').all())
    expect(raw).not.toContain('ENV-SECRET-3')
    const host = getDb()
      .prepare(
        `SELECT description FROM environment_variables WHERE key = 'host' ORDER BY rowid DESC`,
      )
      .get() as { description: string }
    expect(host.description).toBe('the host')
  })
})

// ─── 5. Examples ─────────────────────────────────────────────────────────────

describe('issue #276 — saved examples (response[]) become saved responses', () => {
  it('lists them under the endpoint via savedResponse:listByProject, in file order, masked', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'Ex', schema: SCHEMA },
      item: [
        {
          name: 'Get user',
          request: { method: 'GET', url: '{{base}}/users/1' },
          response: [
            {
              name: 'Found',
              originalRequest: {
                method: 'GET',
                url: { raw: '{{base}}/users/1?verbose=1', query: [{ key: 'verbose', value: '1' }] },
                header: [
                  { key: 'Authorization', value: 'Bearer LEAKME' },
                  { key: 'Accept', value: 'application/json' },
                ],
              },
              status: 'OK',
              code: 200,
              _postman_previewlanguage: 'json',
              header: [{ key: 'X-Trace', value: 't1' }],
              body: '{"id":1}',
              responseTime: 12,
            },
            {
              name: 'Missing',
              status: 'Not Found',
              code: 404,
              header: 'Content-Type: text/plain',
              body: 'nope',
            },
          ],
        },
      ],
    })
    expect(data.exampleCount).toBe(2)
    const list = (await ipcHandlers.get('savedResponse:listByProject')!({}, pid)) as {
      success: boolean
      data: Array<{
        id: string
        name: string
        owner_type: string
        owner_id: string
        status_code: number
      }>
    }
    expect(list.success).toBe(true)
    expect(list.data.map((r) => [r.name, r.status_code])).toEqual([
      ['Found', 200],
      ['Missing', 404],
    ])
    const ep = byName(pid, 'Get user')
    expect(list.data.every((r) => r.owner_type === 'endpoint' && r.owner_id === ep.id)).toBe(true)
    const full = getDb()
      .prepare('SELECT response_json, request_json FROM saved_responses WHERE id = ?')
      .get(list.data[0].id) as { response_json: string; request_json: string }
    const resp = JSON.parse(full.response_json) as Record<string, unknown>
    expect(resp).toMatchObject({
      status: 200,
      statusText: 'OK',
      body: '{"id":1}',
      headers: { 'X-Trace': 't1', 'Content-Type': 'application/json' },
      timing: { total: 12 },
    })
    const req = JSON.parse(full.request_json) as {
      configured: Record<string, unknown>
      sent?: unknown
    }
    expect(req.sent).toBeUndefined()
    expect(req.configured).toMatchObject({ method: 'GET', url: '{{base}}/users/1?verbose=1' })
    expect(full.request_json).not.toContain('LEAKME')
  })
})

// ─── 5. Path variables, settings, scripts, body ──────────────────────────────

describe('issue #276 — path variables, protocolProfileBehavior, scripts, body modes', () => {
  it('keeps :id in the URL and stores the values as the Path Variables rows', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'PV', schema: SCHEMA },
      item: [
        {
          name: 'Get',
          request: {
            method: 'GET',
            url: {
              raw: '{{base}}/users/:id',
              variable: [{ key: 'id', value: '{{userId}}', description: 'user' }],
            },
          },
        },
      ],
    })
    const ep = byName(pid, 'Get')
    expect(ep.schema.url).toBe('{{base}}/users/:id')
    expect(ep.schema.pathVariables).toEqual([
      { id: expect.any(String), key: 'id', value: '{{userId}}', description: 'user' },
    ])
    // Path variables now work (Send / Run / codegen substitute them) — no warning.
    expect(data.warnings?.some((w) => /Path variables/.test(w)) ?? false).toBe(false)
  })

  it('maps followRedirects / maxRedirects / strictSSL, inherits from collection + folder, reports the rest once', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'PPB', schema: SCHEMA },
      protocolProfileBehavior: { strictSSL: false, disableCookies: true },
      item: [
        {
          name: 'F',
          protocolProfileBehavior: { maxRedirects: 3 },
          item: [
            {
              name: 'a',
              request: { method: 'GET', url: 'http://h/a' },
              protocolProfileBehavior: { followRedirects: false },
            },
            {
              name: 'b',
              request: { method: 'GET', url: 'http://h/b' },
              protocolProfileBehavior: { disableBodyPruning: true },
            },
          ],
        },
      ],
    })
    expect(byName(pid, 'a').schema).toMatchObject({
      followRedirects: false,
      maxRedirects: 3,
      sslVerification: false,
    })
    expect(byName(pid, 'b').schema).toMatchObject({ maxRedirects: 3, sslVerification: false })
    expect(byName(pid, 'b').schema).not.toHaveProperty('followRedirects')
    const ppbWarnings = (data.warnings ?? []).filter((w) =>
      /request settings Testnizer does not have/.test(w),
    )
    expect(ppbWarnings).toHaveLength(1)
    expect(ppbWarnings[0]).toMatch(/disableCookies=true/)
  })

  it('skips disabled events, reports pm.require / pm.vault / {{vault:}} / script.src / unknown listen', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'Sc', schema: SCHEMA },
      item: [
        {
          name: 'r',
          event: [
            { listen: 'prerequest', disabled: true, script: { exec: ['disabledPre()'] } },
            {
              listen: 'prerequest',
              script: {
                exec: ['const m = pm.require("npm:moment")'],
                packages: { 'npm:moment': { id: 'x' } },
              },
            },
            { listen: 'test', script: { exec: ['pm.vault.get("k")'] } },
            { listen: 'test', script: { exec: ['second()'] } },
            { listen: 'beforeInvoke', script: { exec: ['grpc()'] } },
            { listen: 'prerequest', script: { src: 'https://scripts.example/x.js' } },
          ],
          request: {
            method: 'GET',
            url: 'http://h/x',
            header: [{ key: 'X-Key', value: '{{vault:api-key}}' }],
          },
        },
      ],
    })
    const s = byName(pid, 'r').schema
    expect(s.preScript).toBe('const m = pm.require("npm:moment")')
    expect(s.postScript).toBe('pm.vault.get("k")\nsecond()')
    const w = (data.warnings ?? []).join('\n')
    expect(w).toMatch(/pre-request script is disabled in Postman/)
    expect(w).toMatch(/npm:moment via pm\.require/)
    expect(w).toMatch(/uses pm\.vault/)
    expect(w).toMatch(/\{\{vault:api-key\}\}/)
    expect(w).toMatch(/event "beforeInvoke" was not imported/)
    expect(w).toMatch(/loaded from a URL/)
  })

  it('reports an unknown body mode and a disabled body', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'B', schema: SCHEMA },
      item: [
        {
          name: 'weird',
          request: { method: 'POST', url: 'http://h/x', body: { mode: 'protobuf', raw: 'x' } },
        },
        {
          name: 'off',
          request: {
            method: 'POST',
            url: 'http://h/y',
            body: {
              mode: 'raw',
              raw: '{"a":1}',
              disabled: true,
              options: { raw: { language: 'json' } },
            },
          },
        },
      ],
    })
    expect(byName(pid, 'weird').schema.body).toEqual({ type: 'none' })
    expect(byName(pid, 'off').schema.body).toMatchObject({ type: 'none', content: '{"a":1}' })
    const w = (data.warnings ?? []).join('\n')
    expect(w).toMatch(/body mode "protobuf" is not supported/)
    expect(w).toMatch(/body is switched off in Postman/)
  })
})

// ─── 5. Auth ─────────────────────────────────────────────────────────────────

describe('issue #276 — auth types', () => {
  const kv = (o: Record<string, string>) =>
    Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }))

  it('maps the OAuth 2.0 grant, client authentication and reports what has no field', async () => {
    const pid = newProject()
    const data = await importDoc(pid, {
      info: { name: 'O', schema: SCHEMA },
      item: [
        {
          name: 'pwd',
          request: {
            method: 'GET',
            url: 'http://h/1',
            auth: {
              type: 'oauth2',
              oauth2: kv({
                grant_type: 'password_credentials',
                accessTokenUrl: 'https://as/token',
                clientId: 'c',
                clientSecret: 's',
                username: 'u',
                password: 'p',
                client_authentication: 'body',
                addTokenTo: 'queryParams',
              }),
            },
          },
        },
        {
          name: 'pkce',
          request: {
            method: 'GET',
            url: 'http://h/2',
            auth: {
              type: 'oauth2',
              oauth2: kv({
                grant_type: 'authorization_code_with_pkce',
                redirect_uri: 'https://cb',
                authUrl: 'https://as/auth',
              }),
            },
          },
        },
      ],
    })
    expect(byName(pid, 'pwd').schema.auth).toEqual({
      type: 'oauth2',
      oauth2: {
        grantType: 'password',
        tokenUrl: 'https://as/token',
        authUrl: '',
        clientId: 'c',
        clientSecret: 's',
        scope: '',
        token: '',
        username: 'u',
        password: 'p',
        clientAuth: 'body',
      },
    })
    expect(byName(pid, 'pkce').schema.auth).toMatchObject({
      oauth2: { grantType: 'authorization_code', authUrl: 'https://as/auth' },
    })
    const w = (data.warnings ?? []).join('\n')
    expect(w).toMatch(/"pwd": OAuth 2\.0 settings .*token location "queryParams"/)
    expect(w).toMatch(/"pkce": OAuth 2\.0 settings .*PKCE.*redirect_uri/)
  })

  it('awsv4 → AWS Signature, hawk → Hawk; oauth1 / jwt / edgegrid / asap → No auth with a named warning', async () => {
    const pid = newProject()
    const req = (name: string, auth: unknown) => ({
      name,
      request: { method: 'GET', url: `http://h/${name}`, auth },
    })
    const data = await importDoc(pid, {
      info: { name: 'A', schema: SCHEMA },
      item: [
        req('aws', {
          type: 'awsv4',
          awsv4: kv({
            accessKey: 'AK',
            secretKey: 'SK',
            region: 'eu-west-1',
            service: 's3',
            sessionToken: 'ST',
          }),
        }),
        req('hawk', {
          type: 'hawk',
          hawk: kv({ authId: 'id', authKey: 'key', algorithm: 'sha1', ext: 'e' }),
        }),
        req('o1', { type: 'oauth1', oauth1: kv({ consumerKey: 'k' }) }),
        req('jwt', { type: 'jwt', jwt: kv({ secret: 's' }) }),
        req('eg', { type: 'edgegrid', edgegrid: kv({ accessToken: 'a' }) }),
        req('asap', { type: 'asap', asap: kv({ iss: 'i' }) }),
      ],
    })
    expect(byName(pid, 'aws').schema.auth).toEqual({
      type: 'aws-signature',
      awsSignature: { accessKey: 'AK', secretKey: 'SK', region: 'eu-west-1', service: 's3' },
    })
    expect(byName(pid, 'hawk').schema.auth).toEqual({
      type: 'hawk',
      hawk: { authId: 'id', authKey: 'key', algorithm: 'sha1' },
    })
    for (const n of ['o1', 'jwt', 'eg', 'asap'])
      expect(byName(pid, n).schema.auth).toEqual({ type: 'none' })
    const w = (data.warnings ?? []).join('\n')
    expect(w).toMatch(/"aws": AWS Signature settings not imported: sessionToken/)
    expect(w).toMatch(/"hawk": Hawk settings not imported: ext/)
    for (const [n, t] of [
      ['o1', 'oauth1'],
      ['jwt', 'jwt'],
      ['eg', 'edgegrid'],
      ['asap', 'asap'],
    ])
      expect(w).toContain(`"${n}": ${t} authentication is not supported by Testnizer`)
  })
})

// ─── 5. Collection auth → project / import folder, inheritance kept ──────────

describe('issue #276 — collection auth is inherited instead of baked (APIs import)', () => {
  const coll = (token: string): Record<string, unknown> => ({
    info: { name: 'Inh', schema: SCHEMA },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: token, type: 'string' }] },
    item: [
      { name: 'root', request: { method: 'GET', url: 'http://h/root' } },
      {
        name: 'Keys',
        auth: {
          type: 'apikey',
          apikey: [
            { key: 'key', value: 'X-K' },
            { key: 'value', value: '{{k}}' },
          ],
        },
        item: [
          { name: 'inFolder', request: { method: 'GET', url: 'http://h/f' } },
          {
            name: 'noauth',
            request: { method: 'GET', url: 'http://h/n', auth: { type: 'noauth' } },
          },
        ],
      },
      { name: 'Plain', item: [{ name: 'deep', request: { method: 'GET', url: 'http://h/d' } }] },
    ],
  })
  /** Effective auth of every endpoint through BOTH resolvers (Send = renderer, Run = main). */
  function effective(pid: string): Record<string, unknown> {
    const folders = getDb()
      .prepare('SELECT * FROM folders WHERE project_id = ?')
      .all(pid) as Array<{
      id: string
      parent_id: string | null
      auth: string | null
    }>
    const byId = new Map(folders.map((f) => [f.id, f]))
    const settingsAuth = readSharedProjectSettings(pid)?.auth as never
    const out: Record<string, unknown> = {}
    for (const ep of endpoints(pid)) {
      const chain: typeof folders = []
      let id = ep.folder_id
      while (id) {
        const f = byId.get(id)!
        chain.unshift(f)
        id = f.parent_id
      }
      const send = rendererResolve(
        ep.schema.auth as never,
        chain,
        rendererProjectAuth(settingsAuth),
      )
      const run = mainResolve(
        ep.schema.auth as never,
        chain as never,
        mainProjectAuth(settingsAuth),
      )
      expect(send).toEqual(run)
      out[ep.name] = run
    }
    return out
  }
  const EXPECTED = {
    root: { type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } },
    inFolder: { type: 'api-key', apiKey: { key: 'X-K', value: '{{k}}', in: 'header' } },
    noauth: null,
    deep: { type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } },
  }

  it('project root: {{var}} bearer → project auth, requests inherit — same effective auth as the old baked import', async () => {
    const pid = newProject()
    await importDoc(pid, coll('{{tok}}'))
    expect(readSharedProjectSettings(pid)?.auth).toEqual({ type: 'bearer', bearerToken: '{{tok}}' })
    expect(byName(pid, 'root').schema.auth).toEqual({ type: 'inherit' })
    expect(byName(pid, 'inFolder').schema.auth).toEqual({ type: 'inherit' })
    expect(effective(pid)).toEqual(EXPECTED)

    // The parser-mode import (old shape: baked) resolves to exactly the same.
    const legacy = newProject()
    const { importPostman } = await import('../../src/main/import/postman')
    await importPostman(legacy, JSON.stringify(coll('{{tok}}')), null)
    expect(byName(legacy, 'root').schema.auth).toMatchObject({ type: 'bearer' })
    expect(effective(legacy)).toEqual(EXPECTED)
  })

  it('a literal token stays baked (project-auth credentials never leave the machine, #177)', async () => {
    const pid = newProject()
    await importDoc(pid, coll('LITERAL-TOKEN'))
    expect(readSharedProjectSettings(pid)?.auth).toBeUndefined()
    expect(byName(pid, 'root').schema.auth).toMatchObject({
      type: 'bearer',
      bearer: { token: 'LITERAL-TOKEN' },
    })
    expect(byName(pid, 'inFolder').schema.auth).toEqual({ type: 'inherit' })
  })

  it('a project that already has auth keeps it; the collection auth is baked', async () => {
    const pid = newProject()
    writeSharedProjectSettings(pid, {
      auth: { type: 'basic', basicUser: 'me', basicPass: '{{p}}' },
    })
    await importDoc(pid, coll('{{tok}}'))
    expect(readSharedProjectSettings(pid)?.auth).toEqual({
      type: 'basic',
      basicUser: 'me',
      basicPass: '{{p}}',
    })
    expect(byName(pid, 'root').schema.auth).toMatchObject({ type: 'bearer' })
  })

  it('import into the new (empty) folder: auth + collection scripts go on that folder', async () => {
    const pid = newProject()
    const folder = newFolder(pid)
    const doc = {
      ...coll('LITERAL'),
      event: [{ listen: 'test', script: { exec: ['collTest()'] } }],
    }
    const data = await importDoc(pid, doc, folder)
    const f = getDb().prepare('SELECT auth, post_script FROM folders WHERE id = ?').get(folder) as {
      auth: string
      post_script: string
    }
    expect(JSON.parse(f.auth)).toEqual({
      type: 'bearer',
      bearer: { token: 'LITERAL', prefix: 'Bearer' },
    })
    expect(f.post_script).toBe('collTest()')
    expect(byName(pid, 'root').schema.auth).toEqual({ type: 'inherit' })
    expect(readSharedProjectSettings(pid)).toBeNull()
    expect(
      data.warnings?.some((w) => /collection-level test script was not imported/.test(w)),
    ).not.toBe(true)
  })

  it('import into a folder that already has content: baked as before, scripts reported', async () => {
    const pid = newProject()
    const folder = newFolder(pid)
    await importDoc(
      pid,
      { info: { name: 'first', schema: SCHEMA }, item: [{ name: 'x', request: 'http://h/x' }] },
      folder,
    )
    const data = await importDoc(
      pid,
      { ...coll('{{tok}}'), event: [{ listen: 'test', script: { exec: ['t()'] } }] },
      folder,
    )
    expect(byName(pid, 'root').schema.auth).toMatchObject({ type: 'bearer' })
    expect(
      data.warnings?.some((w) => /collection-level test script was not imported/.test(w)),
    ).toBe(true)
  })

  it('export gives the project auth back as collection auth and keeps an explicit noauth', async () => {
    const pid = newProject()
    await importDoc(pid, coll('{{tok}}'))
    const res = (await ipcHandlers.get('export:postman')!({}, pid)) as { data: string }
    const col = JSON.parse(res.data) as PostmanCollection
    expect(col.auth).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{tok}}', type: 'string' }],
    })
    const keys = col.item.find((i) => i.name === 'Keys')!
    const noauth = keys.item!.find((i) => i.name === 'noauth')!
    expect((noauth.request as { auth?: unknown }).auth).toEqual({ type: 'noauth' })
    // Round trip into a fresh project resolves identically.
    const again = newProject()
    await importDoc(again, col)
    expect(effective(again)).toEqual(EXPECTED)
  })
})
