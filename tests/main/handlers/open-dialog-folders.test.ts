/**
 * macOS: a FOLDER named like a keystore (`certs.jks`, `client.p12`) could not
 * be opened or entered from Keystore Studio → Open while the Keystore filter
 * was active — NSOpenPanel treats it as a document package (tester report).
 *
 * 1. Every file picker in main asks for `treatPackageAsDirectory`
 *    (`src/main/lib/open-dialog.ts` → `openFileDialogOptions`).
 * 2. If a folder still arrives as the pick (or as a `keystore:open` path),
 *    the handler says so plainly instead of failing later with EISDIR.
 *
 * The NSOpenPanel behaviour itself can only be verified by hand on macOS.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
  },
}))

const { registerKeystoreHandlers } = await import('../../../src/main/ipc/keystore.handler')
const { registerCertificateHandlers } = await import('../../../src/main/ipc/certificate.handler')
const { registerDialogHandlers } = await import('../../../src/main/ipc/dialog.handler')
const { registerGrpcHandlers } = await import('../../../src/main/ipc/grpc.handler')
const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { openFileDialogOptions, pickedFolderError } =
  await import('../../../src/main/lib/open-dialog')
const { dialog } = await import('electron')

type Res<T = unknown> = { success: boolean; data?: T; error?: string }

let root: string
let jksFolder: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-open-dialog-'))
  jksFolder = join(root, 'certs.jks')
  mkdirSync(jksFolder)
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  vi.mocked(dialog.showOpenDialog).mockClear()
  registerKeystoreHandlers()
  registerCertificateHandlers()
  registerDialogHandlers()
  registerGrpcHandlers()
  registerImportExportHandlers()
  registerSaveHandlers()
})

/** The options object of the last showOpenDialog call (with or without a window arg). */
function lastDialogOptions(): { properties?: string[] } {
  const call = vi.mocked(dialog.showOpenDialog).mock.calls.at(-1) as unknown[]
  return (call.length > 1 ? call[1] : call[0]) as { properties?: string[] }
}

describe('openFileDialogOptions', () => {
  it('adds treatPackageAsDirectory to file pickers, keeps the rest', () => {
    const out = openFileDialogOptions({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Keystore', extensions: ['jks'] }],
    })
    expect(out.properties).toEqual(['openFile', 'multiSelections', 'treatPackageAsDirectory'])
    expect(out.filters).toEqual([{ name: 'Keystore', extensions: ['jks'] }])
  })

  it('leaves directory pickers and already-set options alone', () => {
    const dir = { properties: ['openDirectory' as const] }
    expect(openFileDialogOptions(dir)).toBe(dir)
    const set = { properties: ['openFile' as const, 'treatPackageAsDirectory' as const] }
    expect(openFileDialogOptions(set).properties).toHaveLength(2)
  })
})

describe('every file picker asks for treatPackageAsDirectory', () => {
  const pickers: Array<[string, unknown[]]> = [
    ['keystore:pickFile', []],
    ['certificate:pickFile', ['pfx']],
    ['certificate:pickFile', ['key']],
    ['certificate:pickFile', ['crt']],
    ['dialog:openFile', [{ filters: [{ name: 'Certificates', extensions: ['p12'] }] }]],
    ['grpc:loadProto', []],
    ['import:openFile', [{ format: 'postman' }]],
    ['save:importProject', [{ workspaceId: 'w' }]],
    ['save:selectFile', []],
    ['save:importFolder', [{ projectId: 'p' }]],
    ['save:importTestSuite', [{ projectId: 'p' }]],
  ]
  for (const [channel, args] of pickers) {
    it(`${channel} ${JSON.stringify(args)}`, async () => {
      await harness.invoke(channel, ...args)
      expect(vi.mocked(dialog.showOpenDialog)).toHaveBeenCalledTimes(1)
      expect(lastDialogOptions().properties).toContain('treatPackageAsDirectory')
      expect(lastDialogOptions().properties).toContain('openFile')
    })
  }
})

describe('a folder picked as a file gets a clear message', () => {
  it('keystore:pickFile', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [jksFolder],
    })
    const res = (await harness.invoke('keystore:pickFile')) as Res
    expect(res.success).toBe(false)
    expect(res.error).toBe(pickedFolderError(jksFolder, 'keystore file'))
    expect(res.error).toContain('"certs.jks" is a folder')
  })

  it('keystore:open with a folder path', async () => {
    const res = (await harness.invoke('keystore:open', {
      path: jksFolder,
      password: 'changeit',
    })) as Res
    expect(res.success).toBe(false)
    expect(res.error).toBe(pickedFolderError(jksFolder, 'keystore file'))
  })

  it('certificate:pickFile (pfx)', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [jksFolder],
    })
    const res = (await harness.invoke('certificate:pickFile', 'pfx')) as Res
    expect(res.success).toBe(false)
    expect(res.error).toBe(pickedFolderError(jksFolder, 'PFX/P12 file'))
  })

  it('dialog:openFile', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [jksFolder],
    })
    const res = (await harness.invoke('dialog:openFile', {})) as Res
    expect(res.success).toBe(false)
    expect(res.error).toBe(pickedFolderError(jksFolder))
  })
})
