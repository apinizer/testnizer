/**
 * `updater:setInstallOnQuit` — the switch behind "Install on quit" vs "Skip
 * this version". electron-updater installs a DOWNLOADED update on quit
 * whenever `autoInstallOnAppQuit` is true; without this handler a skipped
 * version still installed itself the next time the user closed the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './handlers/helpers'

const harness = setupHandlerHarness()

const fakeWindows = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}))
vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    app: { ...(base as { app: object }).app, focus: vi.fn(), dock: { bounce: vi.fn() } },
    BrowserWindow: { getAllWindows: () => fakeWindows.list },
  }
})

const fakeUpdater = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(async () => null),
      downloadUpdate: vi.fn(async () => null),
      quitAndInstall: vi.fn(),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
      },
    },
  }
})
vi.mock('electron-updater', () => ({ autoUpdater: fakeUpdater.autoUpdater }))

const { initAutoUpdater } = await import('../../src/main/updater')

beforeEach(async () => {
  harness.reset()
  fakeWindows.list = []
  fakeUpdater.autoUpdater.autoInstallOnAppQuit = false
  await initAutoUpdater()
})

describe('updater:setInstallOnQuit', () => {
  it('defaults to installing on quit once initialised; main never downloads by itself', () => {
    expect(fakeUpdater.autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(fakeUpdater.autoUpdater.autoDownload).toBe(false)
  })

  it('"Skip this version" turns install-on-quit OFF; "Install on quit" turns it back ON', async () => {
    const off = (await harness.invoke('updater:setInstallOnQuit', false)) as {
      success: boolean
      data: boolean
    }
    expect(off).toEqual({ success: true, data: false })
    expect(fakeUpdater.autoUpdater.autoInstallOnAppQuit).toBe(false)

    const on = (await harness.invoke('updater:setInstallOnQuit', true)) as {
      success: boolean
      data: boolean
    }
    expect(on).toEqual({ success: true, data: true })
    expect(fakeUpdater.autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('treats anything but literal true as OFF (no accidental install from a truthy string)', async () => {
    await harness.invoke('updater:setInstallOnQuit', 'yes')
    expect(fakeUpdater.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })
})

describe('update-downloaded brings the window forward', () => {
  it('restores a minimised window, shows and focuses it, and tells the renderer', () => {
    const sent: unknown[] = []
    const win = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: (_ch: string, data: unknown) => sent.push(data) },
    }
    fakeWindows.list = [win]
    fakeUpdater.listeners.get('update-downloaded')?.({ downloadedFile: '/tmp/x' })
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(sent).toContainEqual({ type: 'downloaded' })
  })
})
