/**
 * What an import may read: a regular file under the cap, and the same for a URL.
 * A FIFO blocks an open forever and a device has no end, so both must be refused
 * before anything opens them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import * as fs from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedProject, seedWorkspace } from './helpers'

const harness = setupHandlerHarness()
const picked = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [picked.path] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [] },
  }
})

let testDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))
vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
  isEncryptedSecret: (s: unknown): s is string => typeof s === 'string' && s.startsWith('enc:'),
  isEncryptionAvailable: () => true,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
    delete(): void {}
  },
}))

const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')

const FIFTY_ONE_MB = 51 * 1024 * 1024
// Not the OS temp dir: `save:importLocal` refuses system directories, /var among them.
const work = fs.mkdtempSync(join(process.cwd(), 'node_modules', '.import-read-limits-'))

let server: Server
let serverUrl = ''
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/big') {
      res.setHeader('Content-Length', String(FIFTY_ONE_MB))
      res.end(Buffer.alloc(FIFTY_ONE_MB, 0x20))
      return
    }
    res.end('{"openapi":"3.0.0"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(work, { recursive: true, force: true })
})

let projectId = ''
beforeEach(() => {
  harness.reset()
  testDb = realDb.openAndMigrate(':memory:')
  registerImportExportHandlers()
  registerSaveHandlers()
  projectId = seedProject(testDb, seedWorkspace(testDb), 'Limits')
})

type Result = { success: boolean; error?: string; data?: unknown }

function sparseFile(name: string): string {
  const path = join(work, name)
  fs.closeSync(fs.openSync(path, 'w'))
  fs.truncateSync(path, FIFTY_ONE_MB)
  return path
}

function fifo(name: string): string {
  const path = join(work, name)
  if (!fs.existsSync(path)) execFileSync('mkfifo', [path])
  return path
}

describe('a file bigger than the import cap', () => {
  it('import:openFile refuses it with its name and the limit', async () => {
    picked.path = sparseFile('big.json')
    const res = (await harness.invoke('import:openFile', {})) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/big\.json/)
    expect(res.error).toMatch(/50 MB/)
  })

  it.each([
    ['save:importTestSuite', () => ({ projectId })],
    ['save:importFolder', () => ({ projectId })],
    ['save:importProject', () => ({ workspaceId: 'w' })],
  ])('%s refuses it from the picker', async (channel, payload) => {
    picked.path = sparseFile('big-picked.json')
    const res = (await harness.invoke(channel, payload())) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/50 MB/)
  })

  it('save:importLocal refuses it', async () => {
    const filePath = sparseFile('big-local.json')
    const res = (await harness.invoke('save:importLocal', { filePath, projectId })) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/50 MB/)
  })
})

describe('a URL answering more than the import cap', () => {
  it('import:fetchUrl refuses it in words', async () => {
    const res = (await harness.invoke('import:fetchUrl', `${serverUrl}/big`)) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/50 MB/)
    expect(res.error).not.toMatch(/maxContentLength/)
  }, 20_000)

  it('still fetches a normal one', async () => {
    const res = (await harness.invoke('import:fetchUrl', `${serverUrl}/spec`)) as Result
    expect(res.success).toBe(true)
  })
})

// Not run against old code: a blocking open would hang the whole test process.
describe('something that is not a regular file', () => {
  it('import:openFile refuses a FIFO at once', async () => {
    const started = Date.now()
    picked.path = fifo('pipe.json')
    const res = (await harness.invoke('import:openFile', {})) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not a regular file/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('import:openFile refuses a link to /dev/zero', async () => {
    picked.path = join(work, 'zero.json')
    if (!fs.existsSync(picked.path)) fs.symlinkSync('/dev/zero', picked.path)
    const res = (await harness.invoke('import:openFile', {})) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not a regular file/)
  })

  it.each([
    ['save:importTestSuite', () => ({ projectId })],
    ['save:importFolder', () => ({ projectId })],
    ['save:importProject', () => ({ workspaceId: 'w' })],
  ])('%s refuses a FIFO from the picker', async (channel, payload) => {
    picked.path = fifo('picked-pipe.json')
    const res = (await harness.invoke(channel, payload())) as Result
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not a regular file/)
  })
})

describe('a .proto file’s imports', () => {
  const protoFolder = (): string => {
    const dir = join(work, crypto.randomUUID())
    fs.mkdirSync(dir)
    return dir
  }
  const importProto = (protoPath: string): Promise<Result & { data?: { success?: boolean } }> =>
    harness.invoke('import:proto', { projectId, protoPath }) as Promise<Result>
  const SERVICE =
    'syntax = "proto3";\nservice S { rpc Do (M) returns (M); }\nmessage M { string a = 1; }\n'

  it('a file next to it is read', async () => {
    const dir = protoFolder()
    fs.writeFileSync(join(dir, 'm.proto'), 'syntax = "proto3";\nmessage M { string a = 1; }\n')
    const main = join(dir, 'main.proto')
    fs.writeFileSync(
      main,
      'syntax = "proto3";\nimport "m.proto";\nservice S { rpc Do (M) returns (M); }\n',
    )
    const res = await importProto(main)
    expect(res.success, res.error).toBe(true)
    expect(res.data?.success).toBe(true)
  })

  it('the bundled google/protobuf types are not "outside"', async () => {
    const main = join(protoFolder(), 'main.proto')
    fs.writeFileSync(main, `import "google/protobuf/empty.proto";\n${SERVICE}`)
    expect((await importProto(main)).success).toBe(true)
  })

  it.each([
    ['above its folder', () => '../secret.proto'],
    ['an absolute path', () => join(work, 'secret.proto')],
    ['a device', () => '/dev/zero'],
  ])('%s is refused, naming the import', async (_label, target) => {
    const main = join(protoFolder(), 'main.proto')
    fs.writeFileSync(join(work, 'secret.proto'), 'syntax = "proto3";\nmessage Secret {}\n')
    fs.writeFileSync(main, `import "${target()}";\n${SERVICE}`)
    const res = await importProto(main)
    const message = res.error ?? (res.data as { error?: string } | undefined)?.error ?? ''
    expect(message).toMatch(/outside its folder/)
  })

  it('a commented-out import is not an import', async () => {
    const main = join(protoFolder(), 'main.proto')
    fs.writeFileSync(main, `// import "/dev/zero";\n${SERVICE}`)
    expect((await importProto(main)).success).toBe(true)
  })
})
