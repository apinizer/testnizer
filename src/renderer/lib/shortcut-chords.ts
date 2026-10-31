import { isMac } from './platform'

/**
 * Key matchers for chords that hold Alt (issue #257). On macOS Option rewrites
 * `e.key` (Cmd+Option+C arrives as "ç", Cmd+Option+W as "∑"), so the physical
 * key (`e.code`) decides there — Cmd never types a character. Elsewhere Ctrl+Alt
 * is also AltGr: only the plain key counts, so AltGr typing of another
 * character (Polish "ć") is never swallowed. The Mod key itself is checked by
 * the caller. Shift is never part of these chords (Shift variants select).
 */
function physicalKey(e: KeyboardEvent, key: string, code: string): boolean {
  if (e.key.toLowerCase() === key) return true
  return isMac() && e.code === code
}

/** Mod+Alt+C — toggle the Console (TOGGLE_CONSOLE_SHORTCUT). */
export function isToggleConsoleChord(e: KeyboardEvent): boolean {
  return e.altKey && !e.shiftKey && physicalKey(e, 'c', 'KeyC')
}

/**
 * Mod+Alt+Right / Mod+Alt+Left — next / previous tab (NEXT_TAB_SHORTCUT /
 * PREV_TAB_SHORTCUT). 1 = next, -1 = previous, 0 = not this chord.
 */
export function adjacentTabChord(e: KeyboardEvent): 1 | -1 | 0 {
  if (!e.altKey || e.shiftKey) return 0
  if (physicalKey(e, 'arrowright', 'ArrowRight')) return 1
  if (physicalKey(e, 'arrowleft', 'ArrowLeft')) return -1
  return 0
}

/** The W of Mod+W (close tab) and Mod+Alt+W (force close). */
export function isCloseTabKey(e: KeyboardEvent): boolean {
  return physicalKey(e, 'w', 'KeyW')
}
