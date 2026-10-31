import { isMac } from './platform'

/**
 * The ONE keyboard-shortcut formatter (issue #257). The command palette, the
 * cheatsheet, Settings → Shortcuts and every tooltip render chords through it,
 * so they can never disagree again ("Cmd+T" vs "⌘ + T").
 *
 * 'Mod' = Cmd on macOS, Ctrl elsewhere; 'Ctrl' is the real Control key.
 * macOS: Apple's symbols in Apple's order (⌃ ⌥ ⇧ ⌘), no separators — "⇧⌘S".
 * Windows / Linux: words joined by "+" in the order Ctrl, Alt, Shift — "Ctrl+Shift+S".
 *
 * Imports only `isMac` (tests mock `./platform` with that alone).
 */
export type ShortcutToken = 'Mod' | 'Ctrl' | 'Alt' | 'Shift' | string

/**
 * Toggle the Console panel. Bound in `keyboard-shortcuts.ts`; the footer
 * tooltip, the palette, the cheatsheet and Settings -> Shortcuts render it.
 */
export const TOGGLE_CONSOLE_SHORTCUT: readonly ShortcutToken[] = ['Mod', 'Alt', 'C']
/** Next / previous tab — bound in `keyboard-shortcuts.ts` like the Console chord. */
export const NEXT_TAB_SHORTCUT: readonly ShortcutToken[] = ['Mod', 'Alt', 'Right']
export const PREV_TAB_SHORTCUT: readonly ShortcutToken[] = ['Mod', 'Alt', 'Left']

const ARROWS: Record<string, string> = { Right: '→', Left: '←', Up: '↑', Down: '↓' }

function keyLabel(key: string): string {
  if (ARROWS[key]) return ARROWS[key]
  return key.length === 1 ? key.toUpperCase() : key
}

export function formatShortcut(tokens: readonly ShortcutToken[], opts?: { mac?: boolean }): string {
  const mac = opts?.mac ?? isMac()
  const has = (t: string): boolean => tokens.includes(t)
  const mod = has('Mod')
  const ctrl = has('Ctrl')
  const alt = has('Alt')
  const shift = has('Shift')
  const keys = tokens.filter((t) => !['Mod', 'Ctrl', 'Alt', 'Shift'].includes(t)).map(keyLabel)

  if (mac) {
    const mods = `${ctrl ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${mod ? '⌘' : ''}`
    return `${mods}${keys.join('')}`
  }
  const parts: string[] = []
  if (mod || ctrl) parts.push('Ctrl')
  if (alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(...keys)
  return parts.join('+')
}
