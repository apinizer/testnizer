/**
 * Smoke tests for `certificate:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) =>
    s ? s.replace(/^enc:/, '') : null,
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as {
  dialog: { showOpenDialog: ReturnType<typeof vi.fn> }
}).dialog

const { registerCertificateHandlers } = await import(
  '../../../src/main/ipc/certificate.handler'
)

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  dialogMock.showOpenDialog.mockReset()
  registerCertificateHandlers()
})

describe('certificate:list + add', () => {
  it('starts empty', async () => {
    const res = (await harness.invoke('certificate:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(res.data).toEqual([])
  })

  it('adds and lists a certificate', async () => {
    const add = (await harness.invoke('certificate:add', {
      projectId,
      kind: 'client',
      host: 'api.example.com',
      crtPath: '/path/to/cert.crt',
      keyPath: '/path/to/key.key',
      passphrase: 'secret',
    })) as { success: boolean; data?: { id: string } }
    expect(add.success).toBe(true)
    expect(typeof add.data?.id).toBe('string')

    const list = (await harness.invoke('certificate:list', projectId)) as {
      success: boolean
      data?: Array<{ host: string }>
    }
    expect(list.success).toBe(true)
    expect(list.data?.[0]?.host).toBe('api.example.com')
  })

  it('returns error envelope when projectId is missing', async () => {
    const res = (await harness.invoke('certificate:add', { kind: 'client' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})

describe('certificate:update + delete', () => {
  it('updates and deletes a certificate', async () => {
    const add = (await harness.invoke('certificate:add', {
      projectId,
      kind: 'ca',
      crtPath: '/p/ca.pem',
    })) as { data: { id: string } }

    const upd = (await harness.invoke('certificate:update', {
      id: add.data.id,
      enabled: false,
    })) as { success: boolean }
    expect(upd.success).toBe(true)

    const del = (await harness.invoke('certificate:delete', add.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })
})

describe('certificate:pickFile', () => {
  let srcDir: string
  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), 'testnizer-pick-'))
  })
  afterEach(() => {
    try {
      rmSync(srcDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  })

  it('returns success: false on cancel', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const res = (await harness.invoke('certificate:pickFile', 'crt')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })

  it('copies the picked file into app storage at pick time (Postman-style capture)', async () => {
    // The fix for the reported mTLS bug: reading the file NOW (while the picker
    // grant is live) and storing a copy — instead of storing the original path
    // and re-reading it at request time, which macOS blocks for ~/Downloads.
    const src = join(srcDir, 'cert.crt')
    writeFileSync(src, '-----BEGIN CERTIFICATE-----\nHELLO\n-----END CERTIFICATE-----')
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [src] })

    const res = (await harness.invoke('certificate:pickFile', 'crt')) as {
      success: boolean
      data?: string
    }
    expect(res.success).toBe(true)
    // Stored path lives in app userData (mock: /tmp/testnizer-test/certs), NOT
    // the original picked location, and keeps the original filename.
    expect(res.data).toContain('/certs/')
    expect(res.data).not.toBe(src)
    expect(res.data?.endsWith('cert.crt')).toBe(true)
    // The copy is byte-identical to the source.
    expect(readFileSync(res.data as string, 'utf8')).toContain('HELLO')
  })

  it('surfaces an error at pick time when the selected file cannot be read', async () => {
    // No silent success: if the picked file is unreadable, tell the user now
    // rather than letting a broken path sit in settings and fail every request.
    dialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join(srcDir, 'nope.crt')], // never written
    })
    const res = (await harness.invoke('certificate:pickFile', 'crt')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/couldn't read/i)
  })
})
