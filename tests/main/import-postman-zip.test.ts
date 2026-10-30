/**
 * Issue #276 follow-up — a .zip through the Postman import: a Postman data
 * export (collections + environments + globals as JSON files, or a zipped
 * `postman_dump.json`), zipped collection / environment JSON files, and a
 * zipped Postman v3 Native Git folder.
 *
 * The zips are BUILT HERE: archiver for the equivalence cases (what users'
 * tools write), `tests/fixtures/raw-zip.ts` for crafted archives no archiver
 * would write (`..`, absolute names, backslashes, symlink mode bits, the
 * encryption flag, lying sizes).
 *
 * Fail-before: `import:openFile` read every file as UTF-8 text — a zip
 * reached the importer as mangled bytes and failed with a JSON parse error.
 * Each refusal case asserts the user-facing message of its own guard.
 *
 * Real production schema (`initDatabase` in a temp userData dir) and the real
 * IPC handlers; only the native file dialog is stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import archiver from 'archiver'
import { rawZip, unixMode, type RawZipEntry } from '../fixtures/raw-zip'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-pmzip-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()
const dialogState: { pick: string | null } = { pick: null }

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {
    showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      dialogState.pick
        ? { canceled: false, filePaths: [dialogState.pick] }
        : { canceled: true, filePaths: [] },
  },
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
import { readPostmanArchive, NOT_POSTMAN_ZIP_MESSAGE } from '../../src/main/import/postman/archive'
import { ZIP_LIMITS, type ZipLimits } from '../../src/main/import/postman/zip'
import { isZipMagic } from '../../src/shared/postman-detect'
import * as trust from '../../src/main/lib/mcp-stdio-trust'

const FIX = path.join(__dirname, '..', 'fixtures', 'postman')
const V3_WORKSPACE = path.join(FIX, 'v3', 'workspace')

let workspaceId = ''
let seq = 0
function newProject(): string {
  const id = `pmzip-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, id, now, now)
  return id
}

interface ImportData {
  success?: boolean
  error?: string
  endpointCount?: number
  folderCount?: number
  warnings?: string[]
}
interface OpenResult {
  success: boolean
  error?: string
  data?: {
    filePath: string
    content: string
    archive?: {
      handle: string
      folderName: string
      source: string
      kind: string
      collections: string[]
      requestCount: number
      environmentCount: number
      globalsCount: number
    }
  } | null
}

let fileSeq = 0
async function openZip(buf: Buffer, format = 'postman', name?: string): Promise<OpenResult> {
  const file = path.join(tmpDir, name ?? `pick-${++fileSeq}.zip`)
  fs.writeFileSync(file, buf)
  dialogState.pick = file
  return (await ipcHandlers.get('import:openFile')!({}, { format })) as OpenResult
}

async function importZip(projectId: string, buf: Buffer): Promise<ImportData> {
  const opened = await openZip(buf)
  expect(opened.success, opened.error).toBe(true)
  const handle = opened.data!.archive!.handle
  const res = (await ipcHandlers.get('import:postmanFolder')!(
    {},
    { projectId, handle, folderId: null },
  )) as { success: boolean; data?: ImportData }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

async function importText(projectId: string, content: string): Promise<ImportData> {
  const res = (await ipcHandlers.get('import:postman')!(
    {},
    { projectId, content, folderId: null },
  )) as { success: boolean; data?: ImportData }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

async function importFolder(projectId: string, folder: string): Promise<ImportData> {
  dialogState.pick = folder
  const picked = (await ipcHandlers.get('import:pickPostmanFolder')!({})) as OpenResult & {
    data?: { handle: string }
  }
  expect(picked.success, picked.error).toBe(true)
  const res = (await ipcHandlers.get('import:postmanFolder')!(
    {},
    { projectId, handle: (picked.data as unknown as { handle: string }).handle, folderId: null },
  )) as { success: boolean; data?: ImportData }
  return res.data ?? {}
}

/** A zip written by archiver (a real archiving tool). `dirs` adds explicit folder entries. */
async function archiverZip(
  files: Array<{ name: string; data: Buffer | string }>,
  dirs = false,
): Promise<Buffer> {
  const zip = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  zip.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve())
    zip.on('error', reject)
  })
  if (dirs) {
    const seen = new Set<string>()
    for (const f of files) {
      const parts = f.name.split('/').slice(0, -1)
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/') + '/'
        if (seen.has(d)) continue
        seen.add(d)
        zip.append('', { name: d })
      }
    }
  }
  for (const f of files) zip.append(f.data, { name: f.name })
  await zip.finalize()
  await done
  return Buffer.concat(chunks)
}

/** Every file under `root` (dotfiles included), POSIX paths, prefixed. */
function filesUnder(root: string, prefix: string): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = []
  const walk = (abs: string, rel: string): void => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, d.name)
      const r = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) walk(a, r)
      else if (d.isFile()) out.push({ name: `${prefix}${r}`, data: fs.readFileSync(a) })
    }
  }
  walk(root, '')
  return out
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Everything one import wrote for a project, without ids or timestamps:
 * folders and endpoints by their tree path, environments with their
 * variables, saved examples by owner. Two imports of the same content
 * compare equal.
 */
function snapshot(pid: string): unknown {
  const db = getDb()
  const folders = db.prepare('SELECT * FROM folders WHERE project_id = ?').all(pid) as Array<
    Record<string, unknown>
  >
  const folderPath = new Map<string, string>()
  const pathOf = (id: unknown): string => {
    if (typeof id !== 'string') return '/'
    const cached = folderPath.get(id)
    if (cached) return cached
    const f = folders.find((x) => x.id === id)
    const p = f ? `${pathOf(f.parent_id)}${String(f.name)}/` : '?/'
    folderPath.set(id, p)
    return p
  }
  const endpoints = db.prepare('SELECT * FROM endpoints WHERE project_id = ?').all(pid) as Array<
    Record<string, unknown>
  >
  const label = new Map<string, string>()
  for (const f of folders) label.set(String(f.id), `folder:${pathOf(f.id)}`)
  for (const e of endpoints)
    label.set(String(e.id), `endpoint:${pathOf(e.folder_id)}${String(e.name)}`)
  const clean = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (['id', 'project_id', 'workspace_id', 'created_at', 'updated_at'].includes(k)) continue
      if (typeof v === 'string' && label.has(v)) out[k] = label.get(v)
      else if (typeof v === 'string')
        // Random row ids inside JSON columns (UUIDs, `genKvId`, MQTT topic/message ids)
        // differ per import; mask every `"id"` value whatever its shape or length.
        out[k] = v.replace(UUID_RE, '<uuid>').replace(/"id":"[^"]*"/g, '"id":"<id>"')
      else out[k] = v
    }
    return out
  }
  const sorted = (rows: Array<Record<string, unknown>>): string[] =>
    rows.map((r) => JSON.stringify(clean(r))).sort()
  const envs = db.prepare('SELECT * FROM environments WHERE project_id = ?').all(pid) as Array<
    Record<string, unknown>
  >
  return {
    folders: sorted(folders),
    endpoints: sorted(endpoints),
    environments: envs
      .map((env) => ({
        env: JSON.stringify(clean(env)),
        vars: sorted(
          (
            db
              .prepare('SELECT * FROM environment_variables WHERE environment_id = ?')
              .all(env.id) as Array<Record<string, unknown>>
          ).map(({ environment_id: _e, ...rest }) => (void _e, rest)),
        ),
      }))
      .sort((a, b) => a.env.localeCompare(b.env)),
    examples: sorted(
      db.prepare('SELECT * FROM saved_responses WHERE project_id = ?').all(pid) as Array<
        Record<string, unknown>
      >,
    ),
  }
}

const trustStore = new Map<string, unknown>()

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  trust.setStdioTrustStoreForTests({
    get: (k) => trustStore.get(k),
    set: (k, v) => void trustStore.set(k, v),
  })
})
beforeEach(() => {
  dialogState.pick = null
})

// ── A data export / a set of JSON files ───────────────────────────────────

const v21 = fs.readFileSync(path.join(FIX, 'baseline-v21.json'), 'utf8')
const v1 = fs.readFileSync(path.join(FIX, 'transformer', 'postman-echo.v1.json'), 'utf8')
const envDoc = {
  id: 'e1',
  name: 'Staging',
  values: [
    { key: 'host', value: 'https://staging.example.test', enabled: true, type: 'default' },
    { key: 'token', value: 's3cret-token', enabled: true, type: 'secret' },
  ],
}
const globalValues = [{ key: 'tenant', value: 'acme', enabled: true, type: 'default' }]

/** The same content as one legacy `postman_dump.json`. */
const equivalentDump = {
  version: 1,
  collections: [JSON.parse(v21), JSON.parse(v1)],
  environments: [envDoc],
  globals: globalValues,
}

describe('issue #276 follow-up — a Postman data export .zip', () => {
  it('magic bytes, not the name, decide a zip', () => {
    expect(isZipMagic(Buffer.from('PK\u0003\u0004rest'))).toBe(true)
    expect(isZipMagic(Buffer.from('{"info":{}}'))).toBe(false)
    expect(isZipMagic('PK\u0003\u0004')).toBe(true)
    expect(isZipMagic('PK\u0005\u0006')).toBe(false)
  })

  it('account data export layout (collection/, environment/ without the scope key, archive.json) → the same rows as the equivalent dump', async () => {
    const zip = await archiverZip([
      {
        name: 'archive.json',
        data: JSON.stringify({ collection: { a: true, b: true }, environment: { e1: true } }),
      },
      { name: 'collection/1-baseline.json', data: v21 },
      { name: 'collection/2-echo.json', data: v1 },
      { name: 'environment/e1.json', data: JSON.stringify(envDoc) },
      {
        name: 'globals/workspace.json',
        data: JSON.stringify({ name: 'Globals', values: globalValues }),
      },
    ])
    const opened = await openZip(zip, 'postman', 'export.zip')
    expect(opened.success, opened.error).toBe(true)
    expect(opened.data?.content).toBe('')
    expect(opened.data?.archive).toMatchObject({
      folderName: 'export.zip',
      source: 'zip',
      collections: ['Baseline Parity Collection', 'Postman Echo (shamasified)'],
      environmentCount: 1,
      globalsCount: 1,
      eachInFolder: true,
    })
    // The path of the file never reaches the renderer through the summary.
    expect(JSON.stringify(opened.data?.archive)).not.toContain(tmpDir)

    const pZip = newProject()
    const fromZip = await importZip(pZip, zip)
    const pDump = newProject()
    const fromDump = await importText(pDump, JSON.stringify(equivalentDump))
    expect(fromZip.success).toBe(true)
    expect(fromZip.endpointCount).toBe(fromDump.endpointCount)
    expect(fromZip.endpointCount).toBeGreaterThan(5)
    expect(snapshot(pZip)).toEqual(snapshot(pDump))
    expect(fromZip.warnings?.join('\n')).toMatch(
      /Found in the archive and not imported: archive\.json/,
    )
  })

  it('a zipped postman_dump.json → the same rows as the dump file itself', async () => {
    const zip = await archiverZip([
      { name: 'postman_dump.json', data: JSON.stringify(equivalentDump) },
    ])
    const pZip = newProject()
    const fromZip = await importZip(pZip, zip)
    const pDump = newProject()
    await importText(pDump, JSON.stringify(equivalentDump))
    expect(fromZip.success).toBe(true)
    expect(snapshot(pZip)).toEqual(snapshot(pDump))
  })

  // dump.ts puts EVERY collection in its own folder; the summary must say so,
  // or the modal names the destination after the one collection and the
  // import nests "Shop/Shop/…".
  it('one collection + its environment: the summary says each collection gets its own folder', async () => {
    const zip = await archiverZip([
      { name: 'Baseline.postman_collection.json', data: v21 },
      {
        name: 'Staging.postman_environment.json',
        data: JSON.stringify({ ...envDoc, _postman_variable_scope: 'environment' }),
      },
    ])
    const opened = await openZip(zip)
    expect(opened.data?.archive).toMatchObject({
      collections: ['Baseline Parity Collection'],
      environmentCount: 1,
      eachInFolder: true,
    })
    const pid = newProject()
    const res = await importZip(pid, zip)
    expect(res.success).toBe(true)
    const top = getDb()
      .prepare('SELECT name FROM folders WHERE project_id = ? AND parent_id IS NULL')
      .all(pid) as Array<{ name: string }>
    expect(top.map((f) => f.name)).toEqual(['Baseline Parity Collection'])
  })

  it('a zip of only Postman v3 JSON files is refused when picked, not at Import', async () => {
    const v3 = fs.readFileSync(path.join(FIX, 'v3', 'all-kinds.v3.json'), 'utf8')
    const two = await openZip(
      await archiverZip([
        { name: 'a.json', data: v3 },
        { name: 'b.json', data: v3 },
      ]),
    )
    expect(two.success).toBe(false)
    expect(two.error).toMatch(/only Postman v3 JSON files that cannot be imported together/)
    const part = await openZip(
      await archiverZip([{ name: 'Ping.json', data: '{"$kind":"http-request","url":"x"}' }]),
    )
    expect(part.success).toBe(false)
    expect(part.error).toMatch(/one file of a v3 collection folder/)
    // One v3 JSON collection on its own is fine (the single-file import).
    const one = await openZip(await archiverZip([{ name: 'a.json', data: v3 }]))
    expect(one.success, one.error).toBe(true)
    expect(one.data?.archive?.collections.length).toBe(1)
  })

  it('an archive over the size cap is refused from its size, before it is read', async () => {
    const file = path.join(tmpDir, 'huge.zip')
    fs.writeFileSync(file, Buffer.from('PK\u0003\u0004'))
    fs.truncateSync(file, ZIP_LIMITS.maxArchiveBytes + 1) // sparse
    dialogState.pick = file
    const opened = (await ipcHandlers.get('import:openFile')!(
      {},
      { format: 'postman' },
    )) as OpenResult
    expect(opened.success).toBe(false)
    expect(opened.error).toMatch(/refused: the file is larger than 100 MB/)
    fs.rmSync(file, { force: true })
  })

  it('one zipped collection JSON imports exactly like the file (into the chosen folder, no wrapper)', async () => {
    const zip = await archiverZip([{ name: 'Baseline.postman_collection.json', data: v21 }])
    const opened = await openZip(zip)
    expect(opened.data?.archive).toMatchObject({ eachInFolder: false })
    const pZip = newProject()
    const fromZip = await importZip(pZip, zip)
    const pFile = newProject()
    await importText(pFile, v21)
    expect(fromZip.success).toBe(true)
    expect(snapshot(pZip)).toEqual(snapshot(pFile))
  })

  it('a zipped environment file → a project environment, no folder', async () => {
    const zip = await archiverZip([
      {
        name: 'Staging.postman_environment.json',
        data: JSON.stringify({ ...envDoc, _postman_variable_scope: 'environment' }),
      },
    ])
    const opened = await openZip(zip)
    expect(opened.data?.archive).toMatchObject({ collections: [], environmentCount: 1 })
    const pid = newProject()
    const res = await importZip(pid, zip)
    expect(res.success).toBe(true)
    const envs = getDb()
      .prepare('SELECT name FROM environments WHERE project_id = ?')
      .all(pid) as Array<{ name: string }>
    expect(envs.map((e) => e.name)).toEqual(['Staging'])
  })

  it('a zip with no Postman content is refused when picked, with a clear message', async () => {
    const zip = await archiverZip([
      { name: 'readme.txt', data: 'hello' },
      { name: 'data.json', data: '{"foo":1}' },
      { name: 'openapi.yaml', data: 'openapi: 3.0.0\ninfo: {title: x}\n' },
    ])
    const opened = await openZip(zip)
    expect(opened.success).toBe(false)
    expect(opened.error).toBe(NOT_POSTMAN_ZIP_MESSAGE)
  })

  it('another Import card refuses a zip instead of reading it as text', async () => {
    const zip = await archiverZip([{ name: 'c.json', data: v21 }])
    const opened = await openZip(zip, 'openapi')
    expect(opened.success).toBe(false)
    expect(opened.error).toMatch(/Only the Postman import reads \.zip files/)
  })

  it('a plain JSON file is still returned as text', async () => {
    const file = path.join(tmpDir, 'plain.json')
    fs.writeFileSync(file, v21)
    dialogState.pick = file
    const opened = (await ipcHandlers.get('import:openFile')!(
      {},
      { format: 'postman' },
    )) as OpenResult
    expect(opened.success).toBe(true)
    expect(opened.data?.content).toBe(v21)
    expect(opened.data?.archive).toBeUndefined()
  })
})

// ── A zipped Postman v3 folder ────────────────────────────────────────────

describe('issue #276 follow-up — a zipped Postman v3 folder', () => {
  for (const dirs of [false, true]) {
    it(`same rows as importing the folder (${dirs ? 'with' : 'without'} folder entries, under a top folder)`, async () => {
      const zip = await archiverZip(filesUnder(V3_WORKSPACE, 'my-workspace/'), dirs)
      const opened = await openZip(zip, 'postman', 'my-workspace.zip')
      expect(opened.success, opened.error).toBe(true)
      expect(opened.data?.archive).toMatchObject({
        source: 'zip',
        kind: 'workspace',
        collections: ['Shop API', 'Status'],
        eachInFolder: true,
      })
      const pZip = newProject()
      const fromZip = await importZip(pZip, zip)
      const pDir = newProject()
      const fromDir = await importFolder(pDir, V3_WORKSPACE)
      expect(fromZip.success).toBe(true)
      expect(fromZip.endpointCount).toBe(fromDir.endpointCount)
      expect(fromZip.endpointCount).toBeGreaterThan(5)
      expect(snapshot(pZip)).toEqual(snapshot(pDir))
      // The same safety report: the script outside the collection is refused in both.
      expect(fromZip.warnings).toEqual(fromDir.warnings)
    })
  }

  it('a Finder-made zip (__MACOSX/, ._ files, .DS_Store) reads like the folder', async () => {
    const files = filesUnder(path.join(FIX, 'v3', 'collection-only'), 'collection-only/')
    const junk = [
      { name: '__MACOSX/collection-only/._Ping.request.yaml', data: Buffer.from([0, 5, 22, 7]) },
      { name: 'collection-only/.DS_Store', data: Buffer.from([0, 0, 0, 1]) },
    ]
    const zip = await archiverZip([...files, ...junk])
    const pZip = newProject()
    const fromZip = await importZip(pZip, zip)
    const pDir = newProject()
    await importFolder(pDir, path.join(FIX, 'v3', 'collection-only'))
    expect(fromZip.success).toBe(true)
    expect(snapshot(pZip)).toEqual(snapshot(pDir))
  })

  it('the v3 reader limits apply to a zipped folder too (one owner)', async () => {
    // Stored (not deflated): ratio 1, so the archive's own guards let it
    // through and the v3 reader's 5 MB per-file cap is what refuses it.
    const big = 'a: ' + 'x'.repeat(6 * 1024 * 1024) + '\n'
    const zip = rawZip([
      { name: '.resources/definition.yaml', data: '$kind: collection\nname: Big\n' },
      { name: 'Huge.request.yaml', data: big, method: 0 },
    ])
    const opened = await openZip(zip)
    expect(opened.success).toBe(false)
    expect(opened.error).toMatch(/"Huge\.request\.yaml" is larger than 5 MB/)
  })
})

// ── Unsafe archives ───────────────────────────────────────────────────────

const OK_JSON = JSON.stringify({ ...envDoc, _postman_variable_scope: 'environment' })
const tight = (over: Partial<ZipLimits>): ZipLimits => ({ ...ZIP_LIMITS, ...over })

async function expectRefused(
  entries: RawZipEntry[],
  message: RegExp,
  limits?: ZipLimits,
): Promise<void> {
  const zip = rawZip(entries)
  if (limits) {
    await expect(readPostmanArchive(zip, limits)).rejects.toThrow(message)
    return
  }
  const before = getDb().prepare('SELECT COUNT(*) AS n FROM endpoints').get() as { n: number }
  const opened = await openZip(zip)
  expect(opened.success).toBe(false)
  expect(opened.error).toMatch(message)
  const after = getDb().prepare('SELECT COUNT(*) AS n FROM endpoints').get() as { n: number }
  expect(after.n).toBe(before.n)
}

describe('issue #276 follow-up — unsafe .zip archives are refused', () => {
  it('a sound raw archive is accepted (the writer itself is fine)', async () => {
    const opened = await openZip(rawZip([{ name: 'env.json', data: OK_JSON }]))
    expect(opened.success, opened.error).toBe(true)
  })

  it('path traversal ("..")', async () => {
    await expectRefused(
      [
        { name: 'env.json', data: OK_JSON },
        { name: '../evil.json', data: OK_JSON },
      ],
      /refused: the entry "\.\.\/evil\.json" climbs out of the archive/,
    )
    await expectRefused(
      [{ name: 'a/../../evil.json', data: OK_JSON }],
      /refused: the entry "a\/\.\.\/\.\.\/evil\.json" climbs out of the archive/,
    )
  })

  it('absolute paths and drive letters', async () => {
    await expectRefused(
      [{ name: '/etc/evil.json', data: OK_JSON }],
      /refused: the entry "\/etc\/evil\.json" is an absolute path/,
    )
    await expectRefused(
      [{ name: 'C:/evil.json', data: OK_JSON }],
      /refused: the entry "C:\/evil\.json" is an absolute path/,
    )
  })

  it('backslash tricks are never rewritten to "/"', async () => {
    await expectRefused(
      [{ name: 'a\\..\\..\\evil.json', data: OK_JSON }],
      /refused: the entry "a\\\.\.\\\.\.\\evil\.json" contains a backslash/,
    )
  })

  it('a symbolic-link entry', async () => {
    await expectRefused(
      [
        { name: 'env.json', data: OK_JSON },
        { name: 'link.json', data: '/etc/passwd', method: 0, externalAttr: unixMode(0o120777) },
      ],
      /refused: the entry "link\.json" is a symbolic link/,
    )
  })

  it('an encrypted entry', async () => {
    await expectRefused(
      [{ name: 'env.json', data: OK_JSON, flags: 0x1 }],
      /refused: the entry "env\.json" is encrypted/,
    )
  })

  it('too many entries', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `e${i}.json`, data: OK_JSON }))
    await expectRefused(entries, /refused: it holds more than 5 entries/, tight({ maxEntries: 5 }))
  })

  it('an oversized entry, and too many bytes in total', async () => {
    await expectRefused(
      [{ name: 'env.json', data: OK_JSON }],
      /refused: the entry "env\.json" is larger than/,
      tight({ maxEntryBytes: 100 }),
    )
    await expectRefused(
      [
        { name: 'a.json', data: OK_JSON },
        { name: 'b.json', data: OK_JSON },
      ],
      /refused: its entries add up to more than/,
      tight({ maxTotalBytes: OK_JSON.length + 10 }),
    )
  })

  it('a zip bomb (compression ratio) — with the default limits', async () => {
    await expectRefused(
      [{ name: 'bomb.json', data: Buffer.alloc(4 * 1024 * 1024, 0x20) }],
      /refused: the entry "bomb\.json" expands more than 100 times/,
    )
  })

  it('an entry that inflates past its declared size', async () => {
    await expectRefused(
      [{ name: 'env.json', data: OK_JSON, declaredSize: 10 }],
      /refused: (the entry "env\.json" inflates past its declared size|an entry's size does not match)/,
    )
  })

  it('a duplicate entry name', async () => {
    await expectRefused(
      [
        { name: 'env.json', data: OK_JSON },
        { name: 'env.json', data: OK_JSON },
      ],
      /refused: the entry "env\.json" appears twice/,
    )
  })

  it('a damaged archive', async () => {
    const zip = rawZip([{ name: 'env.json', data: OK_JSON }])
    const opened = await openZip(zip.subarray(0, zip.length - 10))
    expect(opened.success).toBe(false)
    expect(opened.error).toMatch(/not a readable \.zip archive/)
  })

  it('the deflate stream is really inflated (sanity of the raw writer)', () => {
    expect(zlib.inflateRawSync(zlib.deflateRawSync(Buffer.from('x'))).toString()).toBe('x')
  })
})
