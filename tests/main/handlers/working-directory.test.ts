/**
 * Issue #276 — Project Settings → "Working directory" is read: a RELATIVE
 * form-data file part or binary body path (what a Postman import carries)
 * resolves against it, on Send (`request:send`) AND Run (`runner:execute`).
 *
 * Before: the setting was saved and never read; a relative path was read
 * against the app's own current directory and failed with "cannot read".
 * Rules: absolute paths behave exactly as before; a relative path with no
 * working directory fails with a message naming the setting.
 *
 * Real engine, real handlers, a local server that echoes what it received;
 * electron-store is a fake so the (machine-local) project setting is under
 * the test's control.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { resolveBodyFilePaths } = await import('../../../src/main/lib/working-directory')

const CONTENT = 'WD-FILE-CONTENT-276'
const workDir = mkdtempSync(join(tmpdir(), 'testnizer-wd-'))
mkdirSync(join(workDir, 'data'))
writeFileSync(join(workDir, 'data', 'upload.txt'), CONTENT)
const ABSOLUTE = join(workDir, 'data', 'upload.txt')

let server: Server
let base = ''
let received = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += String(c)))
        req.on('end', () => {
          received = body
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let projectId = ''

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  storeState.values = {}
  received = ''
  registerRequestHandlers()
  registerRunnerHandlers()
})

const setWorkingDirectory = (dir: string): void => {
  storeState.values[`project.${projectId}.settings`] = { workingDirectory: dir }
}

const formBody = (filePath: string) => ({
  type: 'form-data',
  formData: [{ id: 'f1', key: 'upload', value: '', enabled: true, type: 'file', filePath }],
})

/** What a binary body puts on the wire (the engine sends it base64-encoded). */
const sawBinary = (): boolean =>
  received.includes(CONTENT) || received === Buffer.from(CONTENT).toString('base64')

async function send(body: unknown): Promise<{ status?: number; error?: string }> {
  const res = (await harness.invoke('request:send', {
    method: 'POST',
    url: `${base}/upload`,
    body,
    _projectId: projectId,
  })) as { success: boolean; data?: { status?: number; error?: string }; error?: string }
  return res.data ?? { error: res.error }
}

function seedEndpoint(body: unknown): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Upload', 'http', 'POST', '/upload', 'developing', ?, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      JSON.stringify({ method: 'POST', url: `${base}/upload`, body, auth: { type: 'none' } }),
      now,
      now,
    )
  return id
}

async function run(body: unknown): Promise<{ status: number | null; error?: string }> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    endpointIds: [seedEndpoint(body)],
  })) as { data?: { results: Array<{ status: number | null; error?: string }> } }
  return res.data!.results[0]
}

describe('Send (request:send) — relative file paths read from the Working directory', () => {
  it('a relative form-data file part resolves against the working directory', async () => {
    setWorkingDirectory(workDir)
    const r = await send(formBody('data/upload.txt'))
    expect(r.status).toBe(200)
    expect(received).toContain(CONTENT)
    expect(received).toContain('filename="upload.txt"')
  })

  it('a relative binary path resolves too', async () => {
    setWorkingDirectory(workDir)
    const r = await send({ type: 'binary', binaryPath: 'data/upload.txt' })
    expect(r.status).toBe(200)
    expect(sawBinary()).toBe(true)
  })

  it('no working directory: a relative path fails with a message naming the setting', async () => {
    const r = await send(formBody('data/upload.txt'))
    expect(r.status).toBeUndefined()
    expect(r.error).toMatch(/"data\/upload\.txt" is relative\. Set Project Settings → Working directory/)
    expect(received).toBe('')
  })

  it('an absolute path works exactly as before, with or without a working directory', async () => {
    expect((await send(formBody(ABSOLUTE))).status).toBe(200)
    expect(received).toContain(CONTENT)
    setWorkingDirectory(join(workDir, 'elsewhere'))
    received = ''
    expect((await send(formBody(ABSOLUTE))).status).toBe(200)
    expect(received).toContain(CONTENT)
  })
})

describe('Run (runner:execute) — the same rule', () => {
  it('a relative form-data file part resolves against the working directory', async () => {
    setWorkingDirectory(workDir)
    const r = await run(formBody('data/upload.txt'))
    expect(r.status).toBe(200)
    expect(received).toContain(CONTENT)
  })

  it('a relative binary path resolves too', async () => {
    setWorkingDirectory(workDir)
    const r = await run({ type: 'binary', binaryPath: 'data/upload.txt' })
    expect(r.status).toBe(200)
    expect(sawBinary()).toBe(true)
  })

  it('no working directory: the row fails with the same message', async () => {
    const r = await run(formBody('data/upload.txt'))
    expect(r.error).toMatch(/Set Project Settings → Working directory/)
    expect(received).toBe('')
  })
})

describe('resolveBodyFilePaths', () => {
  it('reads no settings when nothing is relative; ignores disabled parts and other body types', async () => {
    const abs = formBody(ABSOLUTE)
    expect(await resolveBodyFilePaths(abs, projectId)).toBe(abs)
    const disabled = {
      type: 'form-data',
      formData: [{ key: 'f', enabled: false, type: 'file', filePath: 'rel.txt' }],
    }
    expect(await resolveBodyFilePaths(disabled, projectId)).toBe(disabled)
    const stale = { type: 'json', binaryPath: 'rel.bin' }
    expect(await resolveBodyFilePaths(stale, projectId)).toBe(stale)
  })

  it('a relative working directory is refused', async () => {
    setWorkingDirectory('relative/dir')
    await expect(resolveBodyFilePaths(formBody('a.txt'), projectId)).rejects.toThrow(
      /must be an absolute folder path/,
    )
  })
})

/**
 * Issue #290 (security) — a RELATIVE path may not leave the working directory.
 * `../../etc/passwd` used to resolve against it and the file was uploaded: a
 * shared project (or a Postman import) could make a teammate's Send / Run
 * read any file the app can read. Absolute paths are unchanged (existing
 * requests hold them; the user picked them).
 */
describe('a relative path that escapes the working directory is refused (issue #290)', () => {
  const OUTSIDE = 'WD-OUTSIDE-SECRET-290'
  const root = mkdtempSync(join(tmpdir(), 'testnizer-wd290-'))
  const wd = join(root, 'wd')
  mkdirSync(join(wd, 'data'), { recursive: true })
  writeFileSync(join(root, 'secret.txt'), OUTSIDE)
  writeFileSync(join(wd, 'data', 'in.txt'), CONTENT)
  writeFileSync(join(wd, '..dotdot.txt'), CONTENT)
  let linked = false
  try {
    symlinkSync(join(root, 'secret.txt'), join(wd, 'link.txt'))
    linked = true
  } catch {
    /* no symlink permission (Windows without developer mode) */
  }
  const refused = /resolves outside Project Settings → Working directory/

  it('Send: ../ escaping the folder is refused (form-data and binary); nothing is read', async () => {
    setWorkingDirectory(wd)
    const r = await send(formBody('../secret.txt'))
    expect(r.status).toBeUndefined()
    expect(r.error).toMatch(refused)
    const b = await send({ type: 'binary', binaryPath: 'data/../../secret.txt' })
    expect(b.error).toMatch(refused)
    expect(received).toBe('')
  })

  it('Run: the same rule', async () => {
    setWorkingDirectory(wd)
    const r = await run(formBody('../secret.txt'))
    expect(r.error).toMatch(refused)
    expect(received).toBe('')
  })

  it.skipIf(!linked)('a symlink inside the folder that points outside it is refused', async () => {
    setWorkingDirectory(wd)
    const r = await send(formBody('link.txt'))
    expect(r.error).toMatch(refused)
    expect(received).toBe('')
  })

  it('paths that stay inside still work; an absolute path outside still works', async () => {
    setWorkingDirectory(wd)
    expect((await send(formBody('data/../data/in.txt'))).status).toBe(200)
    expect(received).toContain(CONTENT)
    received = ''
    expect((await send(formBody('..dotdot.txt'))).status).toBe(200)
    expect(received).toContain(CONTENT)
    received = ''
    expect((await send(formBody(join(root, 'secret.txt')))).status).toBe(200)
    expect(received).toContain(OUTSIDE)
  })
})
