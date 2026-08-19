/**
 * Issue #113 — right-click Paste did nothing while Ctrl/Cmd+V worked.
 *
 * The app had no context menu of its own. Electron provides no default one, so
 * a plain input offered nothing at all; inside Monaco the editor's built-in
 * menu appeared, and its Paste calls `document.execCommand('paste')`, which
 * Chromium refuses in a renderer. The item was visible, clicking it did
 * nothing, and the keyboard chord worked the whole time because that goes
 * through the native path.
 *
 * The menu is now built here and popped from main with clipboard ROLES, which
 * take that same native path. These tests pin what the menu contains; popping
 * it is UI and is verified in the running app.
 */
import { describe, it, expect } from 'vitest'
import { buildContextMenuTemplate } from '../../../src/main/lib/context-menu'

const roles = (t: ReturnType<typeof buildContextMenuTemplate>) =>
  t.filter((e) => e.role).map((e) => e.role)

const entry = (t: ReturnType<typeof buildContextMenuTemplate>, role: string) =>
  t.find((e) => e.role === role)

describe('an editable field', () => {
  const full = { editable: true, hasSelection: true, canPaste: true }

  it('offers the full clipboard set', () => {
    expect(roles(buildContextMenuTemplate(full))).toEqual(['cut', 'copy', 'paste', 'selectAll'])
  })

  it('offers Paste — the item the whole issue is about', () => {
    // Paste has to be present even with nothing selected: that is the exact
    // case the reporter hit (copy elsewhere, right-click an empty field).
    const t = buildContextMenuTemplate({ editable: true, hasSelection: false, canPaste: true })
    expect(entry(t, 'paste')?.enabled).toBe(true)
  })

  it('greys out Cut and Copy when nothing is selected', () => {
    const t = buildContextMenuTemplate({ editable: true, hasSelection: false, canPaste: true })
    expect(entry(t, 'cut')?.enabled).toBe(false)
    expect(entry(t, 'copy')?.enabled).toBe(false)
  })

  it('greys out Paste when the clipboard is empty, rather than hiding it', () => {
    // Disabled-and-visible is the opposite of the bug: an item that looks
    // available must act, and one that cannot act must look unavailable.
    const t = buildContextMenuTemplate({ editable: true, hasSelection: true, canPaste: false })
    expect(entry(t, 'paste')).toBeDefined()
    expect(entry(t, 'paste')?.enabled).toBe(false)
  })

  it('always offers Select All', () => {
    const t = buildContextMenuTemplate({ editable: true, hasSelection: false, canPaste: false })
    expect(entry(t, 'selectAll')?.enabled).toBe(true)
  })
})

describe('read-only text', () => {
  it('offers Copy but never Paste or Cut', () => {
    const t = buildContextMenuTemplate({ editable: false, hasSelection: true, canPaste: true })
    expect(roles(t)).toEqual(['copy', 'selectAll'])
  })
})

describe('dead space', () => {
  it('shows no menu at all rather than an all-greyed-out one', () => {
    expect(
      buildContextMenuTemplate({ editable: false, hasSelection: false, canPaste: true }),
    ).toEqual([])
  })
})
