/**
 * The native right-click menu (issue #113).
 *
 * The app shipped without one. Electron does not provide a default context
 * menu, so right-clicking a plain input offered nothing at all, and inside
 * Monaco the editor's OWN menu appeared — whose Paste calls
 * `document.execCommand('paste')`, which Chromium refuses in a renderer. The
 * item was there, the user clicked it, and nothing happened; Cmd/Ctrl+V worked
 * the whole time because that goes through the native path instead.
 *
 * So the menu is built here and popped from main, and its clipboard items use
 * `webContents.cut/copy/paste` — the same native path as the keyboard chords,
 * which is why they work where `execCommand` does not.
 *
 * This module is deliberately pure: it decides WHAT the menu contains, given
 * what was right-clicked. Building and popping the Electron `Menu` is the
 * caller's job, so the decision is testable without an app.
 */

export interface ContextTarget {
  /** The click landed in an input, textarea, contenteditable or a code editor. */
  editable: boolean
  /** There is a non-empty selection to cut or copy. */
  hasSelection: boolean
  /** The clipboard currently holds text. */
  canPaste: boolean
}

export type ContextMenuRole = 'cut' | 'copy' | 'paste' | 'selectAll'

export interface ContextMenuEntry {
  role?: ContextMenuRole
  type?: 'separator'
  enabled?: boolean
}

/**
 * What the menu should contain for a given target.
 *
 * An empty array means "show nothing": right-clicking dead space with no
 * selection has no action to offer, and popping an all-greyed-out menu there
 * is worse than popping none.
 *
 * Items that cannot act are disabled rather than omitted, so the menu keeps a
 * stable shape and the user can see that Paste exists but the clipboard is
 * empty — the opposite of the bug being fixed, where an item that looked
 * available silently did nothing.
 */
export function buildContextMenuTemplate(target: ContextTarget): ContextMenuEntry[] {
  if (target.editable) {
    return [
      { role: 'cut', enabled: target.hasSelection },
      { role: 'copy', enabled: target.hasSelection },
      { role: 'paste', enabled: target.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: true },
    ]
  }

  if (target.hasSelection) {
    // Read-only text: copying is the only meaningful action, and Select All
    // rides along because it is what the user reaches for next.
    return [
      { role: 'copy', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true },
    ]
  }

  return []
}
