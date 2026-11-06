/**
 * A file the user picks for a request body is consent: a real pick outside the
 * working directory turns the project's `readFilesOutsideWorkingDirectory` on,
 * in main, in the handler that shows the dialog. Nothing else through this
 * handler can set it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  failing: false,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return storeState.values[key]
    }
    set(key: string, value: unknown): void {
      if (storeState.failing) throw new Error('disk full')
      storeState.values[key] = value
    }
  },
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as { dialog: { showOpenDialog: ReturnType<typeof vi.fn> } })
  .dialog
const { registerDialogHandlers } = await import('../../../src/main/ipc/dialog.handler')

const root = realpathSync(mkdtempSync(join(tmpdir(), 'testnizer-pick-')))
const wd = join(root, 'wd')
mkdirSync(wd)
const inside = join(wd, 'in.bin')
const outside = join(root, 'out.bin')
writeFileSync(inside, 'x')
writeFileSync(outside, 'y')

let projectId = ''
const settingsKey = (): string => `project.${projectId}.settings`
const isOn = (): boolean =>
  (storeState.values[settingsKey()] as Record<string, unknown> | undefined)
    ?.readFilesOutsideWorkingDirectory === true

const pick = (files: string[], options: Record<string, unknown>) => {
  dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: files })
  return harness.invoke('dialog:openFile', options) as Promise<{
    success: boolean
    data?: { filePath: string }
  }>
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  storeState.values = {}
  storeState.failing = false
  dialogMock.showOpenDialog.mockReset()
  registerDialogHandlers()
})

describe('dialog:openFile — request body consent', () => {
  it('a pick outside the working directory turns the setting on', async () => {
    storeState.values[settingsKey()] = { workingDirectory: wd, proxy: { mode: 'none' } }
    const res = await pick([outside], { requestBodyProjectId: projectId })
    expect(res.data?.filePath).toBe(outside)
    expect(storeState.values[settingsKey()]).toEqual({
      workingDirectory: wd,
      proxy: { mode: 'none' },
      readFilesOutsideWorkingDirectory: true,
    })
  })

  it('with no working directory set, every pick is outside', async () => {
    await pick([outside], { requestBodyProjectId: projectId })
    expect(isOn()).toBe(true)
  })

  it('a pick inside the working directory changes nothing', async () => {
    storeState.values[settingsKey()] = { workingDirectory: wd }
    await pick([inside], { requestBodyProjectId: projectId })
    expect(isOn()).toBe(false)
  })

  it('cancel changes nothing', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const res = (await harness.invoke('dialog:openFile', {
      requestBodyProjectId: projectId,
    })) as { success: boolean }
    expect(res.success).toBe(false)
    expect(isOn()).toBe(false)
  })

  it('a picker that is not choosing a request body (TLS tool) changes nothing', async () => {
    await pick([outside], {})
    expect(storeState.values).toEqual({})
  })

  it('no project (Quick Test) has nothing to set, and the pick still returns', async () => {
    const res = await pick([outside], {})
    expect(res.success).toBe(true)
    expect(storeState.values).toEqual({})
  })

  it('a store that cannot be written does not lose the pick', async () => {
    storeState.failing = true
    const res = await pick([outside], { requestBodyProjectId: projectId })
    expect(res.data?.filePath).toBe(outside)
  })
})
