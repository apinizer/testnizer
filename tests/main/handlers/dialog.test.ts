/**
 * Smoke tests for the single `dialog:openFile` IPC handler.
 *
 * We override the default electron mock's `dialog.showOpenDialog` to drive
 * cancel/success branches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, getCurrentHarness } from './helpers'

interface DialogShape {
  showOpenDialog: ReturnType<typeof vi.fn>
}

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

// Re-import the mocked electron module so we can mutate its `dialog` object
// between tests. (vi.mock factory results are cached so this returns the
// same object every test.)
const electron = await import('electron')
const dialogMock = (electron as unknown as { dialog: DialogShape }).dialog

const { registerDialogHandlers } = await import('../../../src/main/ipc/dialog.handler')

beforeEach(() => {
  harness.reset()
  registerDialogHandlers()
  dialogMock.showOpenDialog.mockReset()
  // BrowserWindow.getFocusedWindow returns null in our mock; the handler
  // forces `win!` but `showOpenDialog` doesn't actually use it in the mock
  // so this works fine.
  void getCurrentHarness // referenced to keep import.
})

describe('dialog:openFile', () => {
  it('returns success: false on user cancel', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const res = (await harness.invoke('dialog:openFile', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toBe('Cancelled')
  })

  it('returns success: false on no files', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    const res = (await harness.invoke('dialog:openFile', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })

  it('returns success: false with error message when dialog throws', async () => {
    dialogMock.showOpenDialog.mockRejectedValueOnce(new Error('boom'))
    const res = (await harness.invoke('dialog:openFile', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/boom/)
  })
})
