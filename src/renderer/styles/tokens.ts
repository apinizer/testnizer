import type { CSSProperties } from 'react'

export const T = {
  // layout
  sidebarW: 83,
  panelW: 312,

  // theme-aware colors (CSS variables)
  bg: 'var(--bg)',
  white: 'var(--white)',
  border: 'var(--border)',
  border2: 'var(--border2)',
  text: 'var(--text)',
  sub: 'var(--sub, #374151)',
  muted: 'var(--muted)',
  ghost: 'var(--hint)',
  surface: 'var(--surface)',
  inputBg: 'var(--input-bg)',
  hover: 'var(--item-hover)',

  // accent colors — use CSS variable so project color applies everywhere
  accent: 'var(--accent)',
  accentHover: 'var(--accent-text)',
  accentBg: 'var(--accent-light)',
  accentText: 'var(--accent-text)',

  // method badge colors — use CSS vars so they adapt to dark mode (defined in globals.css)
  GET: { bg: 'var(--mb-get-bg)', color: 'var(--mb-get-fg)', border: 'var(--mb-get-br)' },
  POST: { bg: 'var(--mb-post-bg)', color: 'var(--mb-post-fg)', border: 'var(--mb-post-br)' },
  PUT: { bg: 'var(--mb-put-bg)', color: 'var(--mb-put-fg)', border: 'var(--mb-put-br)' },
  PATCH: { bg: 'var(--mb-patch-bg)', color: 'var(--mb-patch-fg)', border: 'var(--mb-patch-br)' },
  DELETE: {
    bg: 'var(--mb-delete-bg)',
    color: 'var(--mb-delete-fg)',
    border: 'var(--mb-delete-br)',
  },
  HEAD: { bg: 'var(--mb-head-bg)', color: 'var(--mb-head-fg)', border: 'var(--mb-head-br)' },
  OPTIONS: {
    bg: 'var(--mb-options-bg)',
    color: 'var(--mb-options-fg)',
    border: 'var(--mb-options-br)',
  },
} as const

// Standard UI font: 13px — compact desktop density.
export const BASE_INP: CSSProperties = {
  width: '100%',
  background: 'var(--input-bg)',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

export const MONO_INP: CSSProperties = {
  ...BASE_INP,
  fontFamily: 'var(--font-mono)',
}

export const BTN_P: CSSProperties = {
  padding: '4px 12px',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontWeight: 600,
  fontSize: 'var(--font-size-base)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
  height: 28,
}

export const BTN_S: CSSProperties = {
  padding: '4px 10px',
  background: 'var(--white)',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  color: 'var(--sub, #374151)',
  fontSize: 'var(--font-size-base)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
}

export const LBL_S: CSSProperties = {
  fontSize: 'var(--font-size-base)',
  color: 'var(--muted)',
  fontWeight: 500,
  marginBottom: 4,
}

export const KV_HEADER_CELL: CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--hint)',
  fontWeight: 400,
}

export type MethodColorKey = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export function getMethodColors(method: string): { bg: string; color: string; border: string } {
  return T[method as MethodColorKey] || T.GET
}
