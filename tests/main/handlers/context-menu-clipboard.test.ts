/**
 * Issue #291 — Electron 44 made `clipboard.readText()` asynchronous.
 *
 * The right-click menu (issue #113) decides whether Paste is enabled from the
 * real clipboard. On Electron 33 `clipboard.readText()` returned the string; on
 * Electron 44 it returns a Promise<string>. Reading `.length` off that Promise
 * gives `undefined`, `undefined > 0` is false, and Paste would be greyed out on
 * every right-click even with text on the clipboard. The mock below behaves
 * like Electron 44, so this test fails on the pre-upgrade handler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()

const clipboardText = { value: '' }
const popups: Array<Array<{ role?: string; enabled?: boolean }>> = []

vi.mock('electron', () => ({
  ...makeElectronMock(),
  clipboard: {
    // Electron 44 shape: asynchronous, W3C Clipboard-style.
    readText: vi.fn(async () => clipboardText.value),
  },
  Menu: {
    buildFromTemplate: (template: Array<{ role?: string; enabled?: boolean }>) => ({
      popup: () => {
        popups.push(template)
      },
    }),
  },
}))

const { registerContextMenuHandlers } = await import(
  '../../../src/main/ipc/context-menu.handler'
)

type Res = { success: boolean; data?: { shown: boolean }; error?: string }

const pasteEntry = () => popups.at(-1)?.find((e) => e.role === 'paste')

beforeEach(() => {
  harness.reset()
  popups.length = 0
  registerContextMenuHandlers()
})

describe('contextMenu:show reads the asynchronous clipboard', () => {
  it('enables Paste when the clipboard holds text', async () => {
    clipboardText.value = 'pasted value'
    const res = (await harness.invoke('contextMenu:show', {
      editable: true,
      hasSelection: false,
    })) as Res
    expect(res).toEqual({ success: true, data: { shown: true } })
    expect(pasteEntry()?.enabled).toBe(true)
  })

  it('disables Paste when the clipboard is empty', async () => {
    clipboardText.value = ''
    const res = (await harness.invoke('contextMenu:show', {
      editable: true,
      hasSelection: false,
    })) as Res
    expect(res.success).toBe(true)
    expect(pasteEntry()?.enabled).toBe(false)
  })
})
