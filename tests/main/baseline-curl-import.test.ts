/**
 * BASELINE / CHARACTERIZATION — cURL import + export
 * (src/main/ipc/import-export.handler.ts: parseCurlCommand, tokenizeCurl,
 * importCurl via the `import:curl` IPC channel, exportAsCurl via `export:curl`).
 *
 * Pins ONLY inputs whose current parsed result is correct. The inputs below
 * were broken in the pre-#279 parser; the shared parser (`src/shared/curl/`,
 * issue #279) fixes every one and the describe block "previously broken
 * inputs" at the end of the parse section asserts the corrected result:
 *
 * BROKEN BEFORE ISSUE #279 (now asserted, see below):
 *  1. `curl -XPOST url`            attached short option value -> method stays GET
 *  2. `curl --request=POST url`    `--opt=value` long form unsupported -> GET
 *  3. `curl -I url`                HEAD ignored -> GET
 *  4. `curl -G -d 'a=1' url`       -G should keep GET and move data into the query; parser says POST + body
 *  5. `curl -d a=1 -d b=2 url`     repeated -d should join with `&` ("a=1&b=2"); parser keeps only the last ("b=2")
 *  6. `curl -d '{"a":1}' -d '{"b":2}'` same: last wins instead of concatenation
 *  7. `curl -s -o /dev/null url`   `-o`/`--output` value is not consumed -> url becomes "/dev/null"
 *  8. `curl --max-time 5 --connect-timeout 2 url`  value-taking flags not consumed -> url becomes "5"
 *  9. `curl --json '{"a":1}' url`  --json unsupported -> url becomes the JSON text
 * 10. `curl -F 'a=b;type=text/plain' url` and `-F 'json={..};type=application/json'`
 *     `;type=` modifier on a TEXT part is left inside the value
 * 11. `curl -d @file.json url`     @file should be read from disk; body is the literal "@file.json"
 * 12. `curl --data-urlencode 'q=a b' url`  value is not percent-encoded ("q=a b")
 * 13. `curl\n  url\n  -H 'A: b'`   bare newlines (no backslash) are not whitespace -> url "curl\n"
 * 14. `curl -H 'X-A: 1' -H 'X-A: 2' url`    duplicate header names collapse (last wins)
 * 15. `curl -H 'X-Empty;' url` / `-H 'Accept:'`  empty-value header forms dropped / kept as ''
 * 16. `curl -u admin url`         user without ":" is dropped (curl would prompt)
 * 17. `curl -H "..." -d '{"a":"it\'s"}' url`  backslash-escaped quote inside single quotes
 *     (invalid shell anyway) mangles url/body
 * 19. `$ curl url` (shell prompt prefix): importCurl's gate accepts it but the parser
 *     tokenizes "$" as the URL -> endpoint "GET $" with path "$"
 * 18. importCurl() drops `-b` cookies and `-k` insecure (parsed but never persisted)
 *     and always stores an unrecognised/absent Content-Type body as type 'raw'
 *     (not 'text'); the endpoint name is `${METHOD} ${pathname}` (query dropped).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-baseline-curl-'))

type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

vi.mock('../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import { curlToRequest, parseCurl } from '../../src/shared/curl'
import {
  registerImportExportHandlers,
  parseCurlCommand,
  tokenizeCurl,
} from '../../src/main/ipc/import-export.handler'

// ─── parseCurlCommand — inputs that are correct today ──────────────────

const GOOD_INPUTS: Record<string, string> = {
  'simple GET': `curl https://api.example.com/users`,
  'simple GET with --url flag': `curl --url https://x.test/u`,
  '-X POST -H -d JSON': `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"Ada","n":[1,2]}'`,
  '--data-raw JSON (method inferred POST)': `curl --data-raw '{"a":1}' -H 'Content-Type: application/json' https://x.test/p`,
  '--data-binary (method inferred POST)': `curl https://x.test --data-binary 'raw bytes'`,
  '--data-ascii': `curl --data-ascii 'a=1' https://x.test`,
  '-d with explicit -X PUT adds urlencoded content-type': `curl -X PUT -d 'a=1&b=2' https://x.test/f`,
  '-d with -X DELETE keeps DELETE': `curl -d '{"a":1}' https://x.test/ -X DELETE`,
  'lowercase content-type header suppresses the default': `curl -X POST https://x.test -d 'a=1' -H 'content-type: text/plain'`,
  '-X lowercase method is upper-cased': `curl https://x.test -X post`,
  '-u user:pass': `curl -u admin:s3cret https://x.test/secure`,
  '--user with colon in password and space in user': `curl -u 'us er:pa:ss' https://x.test`,
  'multi-line with backslash continuations': `curl 'https://x.test/a?b=1&c=2' \\\n  -H 'Accept: application/json' \\\n  -H 'X-Trace: 1'`,
  'multi-line with CRLF continuations': `curl https://x.test \\\r\n -H 'A: b'`,
  '--header with colons in the value (bearer)': `curl -H 'Authorization: Bearer abc:def:ghi' -H 'Origin: http://localhost:3000' https://x.test`,
  '--header long form with time value': `curl --header 'X-Time: 12:30:45' https://x.test`,
  '-F text + file with ;type= modifier': `curl -F 'name=Ada' -F 'avatar=@/tmp/a.png;type=image/png' https://x.test/up`,
  '--form long form, file only': `curl --form 'doc=@/var/data/report.pdf' https://x.test/up`,
  '-F with "<" (treated as text today)': `curl -F 'a=<file.txt' https://x.test`,
  'double-quoted body with escaped quotes': `curl -X POST "https://x.test" -d "{\\"a\\": \\"b\\"}" -H "Content-Type: application/json"`,
  "ANSI-C $'...' quoting": `curl $'https://x.test' -d $'line1\\nline2'`,
  'cookie, user-agent, referer': `curl -b 'a=1; b=2' -A 'agent/1.0' -e http://ref.test https://x.test`,
  '--compressed -L -k flags': `curl --compressed -L -k https://x.test`,
  '--proxy value does not leak into url': `curl -x http://proxy:3128 https://x.test`,
  'single --data-urlencode adds urlencoded content-type': `curl --data-urlencode 'r=2' https://x.test`,
  '{{var}} placeholders survive': `curl -H 'Content-Type: application/json' -d '{{body}}' '{{baseUrl}}/x'`,
  'percent-encoded URL stays as typed': `curl http://localhost:3000/a?b=c%20d`,
}

describe('baseline cURL import — tokenizeCurl / parseCurlCommand', () => {
  it('tokenizeCurl: quotes, escapes, ANSI-C', () => {
    expect({
      single: tokenizeCurl(`curl -H 'X: a b c' https://x`),
      double: tokenizeCurl(`curl -H "X: a b" -d "q\\"r" https://x`),
      ansi: tokenizeCurl(`curl -d $'a\\tb\\nc' https://x`),
    }).toMatchSnapshot()
  })

  for (const [label, input] of Object.entries(GOOD_INPUTS)) {
    it(`parse: ${label}`, () => {
      expect(parseCurlCommand(input)).toMatchSnapshot()
    })
  }
})

// ─── The 19 inputs the pre-#279 parser got wrong ───────────────────────

let rowId = 0
const toReq = (cmd: string): ReturnType<typeof curlToRequest> =>
  curlToRequest(parseCurl(cmd), { makeId: () => `r${++rowId}` })
const headerPairs = (cmd: string): string[] => toReq(cmd).headers.map((h) => `${h.key}: ${h.value}`)
const codes = (cmd: string): string[] => toReq(cmd).warnings.map((w) => w.code)

describe('baseline cURL import — previously broken inputs (issue #279)', () => {
  it('#1 glued -XPOST sets the method', () => {
    expect(parseCurlCommand('curl -XPOST https://x.test').method).toBe('POST')
  })

  it('#2 --request=POST (long --opt=value) sets the method', () => {
    expect(parseCurlCommand('curl --request=POST https://x.test').method).toBe('POST')
  })

  it('#3 -I is HEAD', () => {
    expect(toReq('curl -I https://x.test').method).toBe('HEAD')
  })

  it('#4 -G keeps GET and moves the data into the query', () => {
    const r = toReq(`curl -G -d 'a=1' https://x.test`)
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://x.test?a=1')
    expect(r.params.map((p) => [p.key, p.value])).toEqual([['a', '1']])
    expect(r.body).toEqual({ type: 'none' })
  })

  it('#5 repeated -d joins with &', () => {
    expect(parseCurlCommand('curl -d a=1 -d b=2 https://x.test').body).toBe('a=1&b=2')
    expect(toReq('curl -d a=1 -d b=2 https://x.test').body.urlEncoded?.map((r) => r.key)).toEqual([
      'a',
      'b',
    ])
  })

  it('#6 repeated JSON -d concatenates with & like curl', () => {
    expect(parseCurlCommand(`curl -d '{"a":1}' -d '{"b":2}' https://x.test`).body).toBe(
      '{"a":1}&{"b":2}',
    )
  })

  it('#7 -o value is consumed, not taken as the URL', () => {
    expect(parseCurlCommand('curl -s -o /dev/null https://x.test').url).toBe('https://x.test')
  })

  it('#8 --max-time / --connect-timeout values are consumed and become the timeout', () => {
    const r = toReq('curl --max-time 5 --connect-timeout 2 https://x.test')
    expect(r.url).toBe('https://x.test')
    expect(r.settings).toEqual({ timeout: 5000 })
  })

  it('#9 --json sets the body, JSON Content-Type + Accept and POST', () => {
    const r = toReq(`curl --json '{"a":1}' https://x.test`)
    expect(r.url).toBe('https://x.test')
    expect(r.method).toBe('POST')
    expect(r.body).toEqual({ type: 'json', content: '{"a":1}' })
    expect(headerPairs(`curl --json '{"a":1}' https://x.test`)).toEqual([
      'Content-Type: application/json',
      'Accept: application/json',
    ])
  })

  it('#10 ;type= on a TEXT form part is stripped from the value (and reported)', () => {
    const r = toReq(
      `curl -F 'a=b;type=text/plain' -F 'json={"x":1};type=application/json' https://x.test`,
    )
    expect(r.body.formData?.map((f) => [f.key, f.value, f.type])).toEqual([
      ['a', 'b', 'text'],
      ['json', '{"x":1}', 'text'],
    ])
    expect(r.warnings.filter((w) => w.code === 'form-type-ignored')).toHaveLength(2)
  })

  it('#11 -d @file is not read: binary body pointing at the path + a warning', () => {
    const r = toReq('curl -d @file.json https://x.test')
    expect(r.body).toEqual({ type: 'binary', binaryPath: 'file.json' })
    expect(r.warnings.map((w) => [w.code, w.arg])).toEqual([['file-reference', 'file.json']])
  })

  it('#12 --data-urlencode percent-encodes the value; the row holds it decoded', () => {
    expect(parseCurlCommand(`curl --data-urlencode 'q=a b' https://x.test`).body).toBe('q=a%20b')
    expect(toReq(`curl --data-urlencode 'q=a b' https://x.test`).body.urlEncoded).toEqual([
      { id: expect.any(String), key: 'q', value: 'a b', enabled: true },
    ])
  })

  it('#13 bare newlines (no backslash) are whitespace', () => {
    const r = toReq(`curl\n  https://x.test\n  -H 'A: b'`)
    expect(r.url).toBe('https://x.test')
    expect(headerPairs(`curl\n  https://x.test\n  -H 'A: b'`)).toEqual(['A: b'])
  })

  it('#14 duplicate header names are both kept, in order', () => {
    expect(headerPairs(`curl -H 'X-A: 1' -H 'X-A: 2' https://x.test`)).toEqual(['X-A: 1', 'X-A: 2'])
  })

  it('#15 `Name;` is an empty-value header, `Name:` removes the header', () => {
    expect(headerPairs(`curl -H 'X-Empty;' -H 'Accept:' https://x.test`)).toEqual(['X-Empty: '])
  })

  it('#16 -u user without ":" is basic auth with an empty password (+ warning)', () => {
    const r = toReq('curl -u admin https://x.test')
    expect(r.auth).toEqual({ type: 'basic', basic: { username: 'admin', password: '' } })
    expect(r.warnings.map((w) => w.code)).toEqual(['password-prompt'])
  })

  it("#17 invalid shell (`\\'` inside single quotes) still finds the URL and reports the unbalanced quote", () => {
    const cmd = `curl -H "X: y" -d '{"a":"it\\'s"}' https://x.test`
    const r = toReq(cmd)
    expect(r.url).toBe('https://x.test')
    expect(r.method).toBe('POST')
    expect(headerPairs(cmd)[0]).toBe('X: y')
    expect(codes(cmd)).toContain('unterminated-quote')
  })

  it('#19 a `$ ` prompt prefix is stripped before parsing', () => {
    expect(parseCurlCommand('$ curl https://x.test/a').url).toBe('https://x.test/a')
  })
})

// ─── import:curl IPC — persisted endpoint shape ────────────────────────

let projectId: string

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  const db = getDb()
  const workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = 'baseline-curl-project'
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, 'curl baseline', NULL, 'http', 0, ?, ?)`,
  ).run(projectId, workspaceId, now, now)
})

interface Persisted {
  name: string
  method: string | null
  path: string
  protocol: string
  status: string
  request_schema: unknown
}

/** Replace random ids inside request_schema rows so snapshots are stable. */
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = k === 'id' ? '<id>' : stripIds(val)
    }
    return o
  }
  return v
}

async function importCurlVia(cmd: string): Promise<{ res: unknown; row: Persisted | undefined }> {
  const db = getDb()
  db.prepare('DELETE FROM endpoints WHERE project_id = ?').run(projectId)
  const handler = ipcHandlers.get('import:curl')
  if (!handler) throw new Error('no import:curl handler')
  const res = await handler({}, { projectId, curlCommand: cmd })
  const row = db.prepare('SELECT * FROM endpoints WHERE project_id = ?').get(projectId) as
    | (Persisted & { request_schema: string | null })
    | undefined
  return {
    res,
    row: row
      ? {
          name: row.name,
          method: row.method,
          path: row.path,
          protocol: row.protocol,
          status: row.status,
          request_schema: row.request_schema
            ? stripIds(JSON.parse(row.request_schema as unknown as string))
            : null,
        }
      : undefined,
  }
}

const IMPORT_INPUTS: Record<string, string> = {
  'GET with query (name drops the query)': `curl 'https://api.example.com/users/42?expand=1'`,
  'POST JSON body': `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"Ada"}'`,
  'POST XML body': `curl https://x.test/soap -H 'Content-Type: text/xml' -d '<a/>'`,
  'POST urlencoded body is split into rows': `curl https://x.test/login -d 'user=ada&pass=p%26ss'`,
  'POST body with other content-type becomes raw': `curl https://x.test/n -H 'Content-Type: text/plain' -d 'hello'`,
  'basic auth': `curl -u admin:s3cret https://x.test/secure`,
  'form-data text + file': `curl -F 'name=Ada' -F 'avatar=@/tmp/a.png' https://x.test/up`,
}

describe('baseline cURL import — import:curl IPC (persisted endpoint)', () => {
  for (const [label, cmd] of Object.entries(IMPORT_INPUTS)) {
    it(label, async () => {
      expect(await importCurlVia(cmd)).toMatchSnapshot()
    })
  }

  it('rejects non-cURL text', async () => {
    expect(await importCurlVia('wget https://x.test')).toMatchSnapshot()
  })

  it('rejects a curl command with no URL', async () => {
    expect(await importCurlVia('curl -X POST')).toMatchSnapshot()
  })

  it('#18 -b becomes a Cookie header, -k/-L/-m become request settings, a plain body is text', async () => {
    const { row } = await importCurlVia(
      `curl -b 'a=1; b=2' -k -L --max-redirs 3 -m 2.5 -d 'hello' -H 'Content-Type: text/plain' https://x.test/n`,
    )
    const schema = row?.request_schema as Record<string, unknown>
    expect(schema.body).toEqual({ type: 'text', content: 'hello' })
    expect(
      (schema.headers as Array<{ key: string; value: string }>).map((h) => `${h.key}: ${h.value}`),
    ).toEqual(['Content-Type: text/plain', 'Cookie: a=1; b=2'])
    expect(schema).toMatchObject({
      sslVerification: false,
      followRedirects: true,
      maxRedirects: 3,
      timeout: 2500,
      url: 'https://x.test/n',
    })
  })

  it('#19 a `$ ` prompt is stripped — the endpoint is the real URL, not "$"', async () => {
    const { row } = await importCurlVia('$ curl https://x.test/a?b=1')
    expect(row?.name).toBe('GET /a')
    expect(row?.path).toBe('/a')
    expect((row?.request_schema as { url: string }).url).toBe('https://x.test/a?b=1')
  })

  it('accepts PowerShell and CMD commands and returns parser warnings', async () => {
    const ps = await importCurlVia(
      "PS> curl.exe -X PUT 'https://x.test/p' `\n  -o out.txt --frobnicate",
    )
    expect(ps.row?.method).toBe('PUT')
    expect((ps.res as { data: { warnings?: string[] } }).data.warnings).toEqual([
      '--frobnicate is not a known curl option and was ignored.',
    ])
    const cmd = await importCurlVia('curl ^"https://x.test/c^" ^\r\n  -H ^"A: 1^"')
    expect(cmd.row?.path).toBe('/c')
  })
})

// ─── export:curl IPC — exportAsCurl output ─────────────────────────────

describe('baseline cURL export — export:curl IPC', () => {
  const EXPORTS: Record<string, Record<string, unknown>> = {
    'GET no extras': { method: 'GET', url: 'https://api.example.com/users' },
    'POST json + headers + bearer': {
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        { key: 'X-Off', value: 'no', enabled: false },
      ],
      body: { type: 'json', content: `{"name":"it's"}` },
      auth: { type: 'bearer', bearer: { token: 'tok' } },
    },
    'basic auth + cookies + insecure': {
      method: 'GET',
      url: 'https://x.test',
      auth: { type: 'basic', basic: { username: 'a', password: 'b:c' } },
      cookies: 'a=1; b=2',
      sslVerification: false,
    },
    'urlencoded rows': {
      method: 'POST',
      url: 'https://x.test',
      body: {
        type: 'urlencoded',
        urlEncoded: [
          { key: 'q', value: 'a b', enabled: true },
          { key: 'skip', value: 'x', enabled: false },
        ],
      },
    },
    'form-data text + file': {
      method: 'POST',
      url: 'https://x.test',
      body: {
        type: 'form-data',
        formData: [
          { key: 'title', value: 'T', enabled: true, type: 'text' },
          { key: 'f', value: 'a.png', enabled: true, type: 'file', filePath: '/tmp/a.png' },
        ],
      },
    },
  }
  for (const [label, req] of Object.entries(EXPORTS)) {
    it(label, async () => {
      const handler = ipcHandlers.get('export:curl')
      if (!handler) throw new Error('no export:curl handler')
      expect(await handler({}, req)).toMatchSnapshot()
    })
  }
})
