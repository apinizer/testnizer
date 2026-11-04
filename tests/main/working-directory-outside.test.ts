/**
 * Files outside the working directory (security rule, 1.6.0).
 *
 * An imported collection or a pulled project can hold `src: /Users/x/.ssh/id_rsa`;
 * Send and Run used to upload it, because `resolveBodyFilePaths` used absolute
 * paths as they were. Now an absolute path outside the project's Working
 * directory is refused unless the machine-local setting
 * `readFilesOutsideWorkingDirectory` is on.
 *
 * Real engine, real import handler, real Runner against a local server with a
 * canary file: the assertion that matters is what the server received.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { NO_PROJECT_SETTINGS_SCOPE } from '../../src/shared/request-settings'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './handlers/helpers'

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
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(key: string, value: unknown): void {
    storeState.values[key] = value
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRequestHandlers } = await import('../../src/main/ipc/request.handler')
const { registerRunnerHandlers } = await import('../../src/main/ipc/runner.handler')
const { importPostman } = await import('../../src/main/ipc/import-export.handler')
const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
const { allowPickedBodyFiles, resolveBodyFilePaths } = await import('../../src/main/lib/working-directory')

const CANARY = 'CANARY-OUTSIDE-WD-7f3a91'
const root = realpathSync(mkdtempSync(join(tmpdir(), 'testnizer-outside-')))
const wd = join(root, 'wd')
mkdirSync(wd)
const INSIDE = join(wd, 'inside.txt')
writeFileSync(INSIDE, 'inside-content')
const OUTSIDE = join(root, 'id_rsa')
writeFileSync(OUTSIDE, CANARY)

const REFUSED = /Project Settings → Read files outside the working directory/

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
          received += body
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

const setLocal = (settings: Record<string, unknown>): void => {
  storeState.values[`project.${projectId}.settings`] = settings
}

const form = (filePath: string, over: Record<string, unknown> = {}) => ({
  type: 'form-data',
  formData: [{ id: 'f', key: 'upload', value: '', enabled: true, type: 'file', filePath, ...over }],
})

const sawCanary = (): boolean =>
  received.includes(CANARY) || received === Buffer.from(CANARY).toString('base64')

async function send(body: unknown): Promise<{ status?: number; error?: string }> {
  const res = (await harness.invoke('request:send', {
    method: 'POST',
    url: `${base}/upload`,
    body,
    _projectId: projectId,
  })) as { data?: { status?: number; error?: string }; error?: string }
  return res.data ?? { error: res.error }
}

describe('resolveBodyFilePaths: absolute paths', () => {
  it('outside the working directory is refused, naming the setting and where it lives', async () => {
    setLocal({ workingDirectory: wd })
    const r = await send(form(OUTSIDE))
    expect(r.status).toBeUndefined()
    expect(r.error).toContain(OUTSIDE)
    expect(r.error).toMatch(REFUSED)
    expect(sawCanary()).toBe(false)
    expect((await send({ type: 'binary', binaryPath: OUTSIDE })).error).toMatch(REFUSED)
    expect(sawCanary()).toBe(false)
  })

  it('no working directory set: every absolute path is outside', async () => {
    const r = await send(form(INSIDE))
    expect(r.error).toMatch(REFUSED)
    expect(received).toBe('')
  })

  it('a relative "working directory" contains nothing', async () => {
    setLocal({ workingDirectory: 'relative/dir' })
    expect((await send(form(INSIDE))).error).toMatch(REFUSED)
  })

  it('inside the working directory is allowed', async () => {
    setLocal({ workingDirectory: wd })
    expect((await send(form(INSIDE))).status).toBe(200)
    expect(received).toContain('inside-content')
  })

  it('the comparison is real path to real path (macOS /var → /private/var)', async () => {
    const linkedRoot = join(root, 'wd-link')
    symlinkSync(wd, linkedRoot)
    setLocal({ workingDirectory: linkedRoot })
    expect((await send(form(INSIDE))).status).toBe(200)
    setLocal({ workingDirectory: wd })
    expect((await send(form(join(linkedRoot, 'inside.txt')))).status).toBe(200)
  })

  it('a symlink inside the folder that points out of it is refused', async () => {
    const link = join(wd, 'looks-inside.txt')
    symlinkSync(OUTSIDE, link)
    setLocal({ workingDirectory: wd })
    expect((await send(form(link))).error).toMatch(REFUSED)
    expect(sawCanary()).toBe(false)
  })

  it('a ../ walk out of the folder is refused', async () => {
    setLocal({ workingDirectory: wd })
    expect((await send(form(`${wd}/../id_rsa`))).error).toMatch(REFUSED)
    expect(sawCanary()).toBe(false)
  })

  it('a missing file outside is refused, a missing file inside reaches the engine', async () => {
    setLocal({ workingDirectory: wd })
    expect((await send(form(join(root, 'nope')))).error).toMatch(REFUSED)
    const inside = await send(form(join(wd, 'nope')))
    expect(inside.error).not.toMatch(REFUSED)
    expect(inside.error).toMatch(/cannot read/)
  })

  it('with the setting on, an absolute path outside is read', async () => {
    setLocal({ workingDirectory: wd, readFilesOutsideWorkingDirectory: true })
    expect((await send(form(OUTSIDE))).status).toBe(200)
    expect(sawCanary()).toBe(true)
  })

  it('only `true` turns it on', async () => {
    setLocal({ readFilesOutsideWorkingDirectory: 'true' })
    expect((await send(form(OUTSIDE))).error).toMatch(REFUSED)
  })

  it('a relative escape stays refused with the setting on (issue #290)', async () => {
    setLocal({ workingDirectory: wd, readFilesOutsideWorkingDirectory: true })
    expect((await send(form('../id_rsa'))).error).toMatch(/resolves outside/)
    expect(sawCanary()).toBe(false)
  })

  it('a disabled row and a body type that reads no file are not refused', async () => {
    const disabled = form(OUTSIDE, { enabled: false })
    expect(await resolveBodyFilePaths(disabled, projectId)).toBe(disabled)
    const unnamed = form(OUTSIDE, { key: '' })
    expect(await resolveBodyFilePaths(unnamed, projectId)).toBe(unnamed)
    const stale = { type: 'json', content: '{}', binaryPath: OUTSIDE }
    expect(await resolveBodyFilePaths(stale, projectId)).toBe(stale)
    const textRow = form(OUTSIDE, { type: 'text' })
    expect(await resolveBodyFilePaths(textRow, projectId)).toBe(textRow)
  })

  it('a Windows-shaped path follows path.isAbsolute on this host', async () => {
    const win = 'C:\\Users\\x\\.ssh\\id_rsa'
    setLocal({ workingDirectory: wd })
    if (isAbsolute(win)) {
      await expect(resolveBodyFilePaths(form(win), projectId)).rejects.toThrow(REFUSED)
    } else {
      // Not absolute here: a file name inside the folder, never C:\ on this host.
      const r = await resolveBodyFilePaths(form(win), projectId)
      expect(r?.formData?.[0].filePath).toBe(join(wd, win))
    }
  })
})

describe('no project: nothing to read the setting from, so nothing is read', () => {
  it('Send with no project id refuses an absolute path (Quick Test, or a project request that lost its id)', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'POST',
      url: `${base}/upload`,
      body: form(OUTSIDE),
    })) as { data?: { status?: number; error?: string } }
    expect(res.data?.status).toBeUndefined()
    expect(res.data?.error).toMatch(/not part of a project/)
    expect(sawCanary()).toBe(false)
  })

  it('the engine refuses it directly too', async () => {
    const r = await executeHttpRequest({
      method: 'POST',
      url: `${base}/upload`,
      headers: [],
      params: [],
      body: { type: 'binary', binaryPath: OUTSIDE },
      auth: { type: 'none' },
    } as Parameters<typeof executeHttpRequest>[0])
    expect(r.error).toMatch(/not part of a project/)
    expect(sawCanary()).toBe(false)
  })
})

describe('a real Postman import with an absolute src', () => {
  const collection = () => ({
    info: {
      name: 'Hostile',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Steal key',
        request: {
          method: 'POST',
          url: `${base}/upload`,
          body: {
            mode: 'formdata',
            formdata: [{ key: 'f', type: 'file', src: OUTSIDE }],
          },
        },
      },
    ],
  })

  async function importAndRun(): Promise<{ status: number | null; error?: string }> {
    const result = await importPostman(projectId, JSON.stringify(collection()))
    expect(result.warnings?.join('\n')).toContain(OUTSIDE)
    expect(result.warnings?.join('\n')).toContain('Steal key')
    const { id } = testDb
      .prepare('SELECT id FROM endpoints WHERE project_id = ?')
      .get(projectId) as { id: string }
    const res = (await harness.invoke('runner:execute', { projectId, endpointIds: [id] })) as {
      data?: { results: Array<{ status: number | null; error?: string }> }
    }
    return res.data!.results[0]
  }

  it('Run does not upload the canary with the setting off, and the row says why', async () => {
    const row = await importAndRun()
    expect(row.error).toMatch(REFUSED)
    expect(row.error).toContain(OUTSIDE)
    expect(sawCanary()).toBe(false)
  })

  it('Send of the imported body does not upload it either', async () => {
    await importPostman(projectId, JSON.stringify(collection()))
    const { request_schema } = testDb
      .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
      .get(projectId) as { request_schema: string }
    const r = await send((JSON.parse(request_schema) as { body: unknown }).body)
    expect(r.error).toMatch(REFUSED)
    expect(sawCanary()).toBe(false)
  })

  it('with the setting on, the same row uploads', async () => {
    setLocal({ readFilesOutsideWorkingDirectory: true })
    const row = await importAndRun()
    expect(row.status).toBe(200)
    expect(sawCanary()).toBe(true)
  })
})

describe('a Quick Test file the user picked', () => {
  it('is read after a pick, and only then', async () => {
    const body = { type: 'binary', binaryPath: OUTSIDE }
    await expect(resolveBodyFilePaths(body, null)).rejects.toThrow(/not part of a project/)
    await allowPickedBodyFiles(NO_PROJECT_SETTINGS_SCOPE, [OUTSIDE])
    await expect(resolveBodyFilePaths(body, null)).resolves.toBe(body)
  })
})
