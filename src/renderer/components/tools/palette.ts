/**
 * The Tools panel's status palette — ONE place, theme tokens only.
 *
 * The tools used to carry their own light-theme hex values (dark green, dark
 * red, dark orange, blue), and the badges built their tint by
 * appending an alpha suffix to that hex (`color + '15'`). In the dark theme
 * the dark-green / dark-red text sat on a near-black surface and was hard to
 * read (JWT Debugger review, G-03). Every tone below maps to a
 * `globals.css` variable that has a light AND a dark value, and carries its
 * own background + border so nobody has to derive a tint from a colour.
 */

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'neutral'

export interface ToneTokens {
  /** Text / icon colour. */
  fg: string
  /** Tinted background. */
  bg: string
  /** Matching 1px border. */
  border: string
}

export const TONE: Record<Tone, ToneTokens> = {
  success: { fg: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-border)' },
  danger: { fg: 'var(--mb-delete-fg)', bg: 'var(--mb-delete-bg)', border: 'var(--mb-delete-br)' },
  warning: { fg: 'var(--mb-put-fg)', bg: 'var(--mb-put-bg)', border: 'var(--mb-put-br)' },
  info: { fg: 'var(--mb-get-fg)', bg: 'var(--mb-get-bg)', border: 'var(--mb-get-br)' },
  accent: { fg: 'var(--mb-head-fg)', bg: 'var(--mb-head-bg)', border: 'var(--mb-head-br)' },
  neutral: { fg: 'var(--muted)', bg: 'var(--surface)', border: 'var(--border)' },
}

/** Plain status text colours (error lines, ok lines) — the same tokens. */
export const GREEN = TONE.success.fg
export const GREEN_BG = TONE.success.bg
export const AMBER = TONE.warning.fg
export const AMBER_BG = TONE.warning.bg
export const RED = 'var(--red)'
export const RED_BG = TONE.danger.bg
export const BLUE = TONE.info.fg
