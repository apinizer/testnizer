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

  // method badge colors (fixed — readable in both themes)
  GET:     { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
  POST:    { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
  PUT:     { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  PATCH:   { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' },
  DELETE:  { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' },
  HEAD:    { bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe' },
  OPTIONS: { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
} as const

export const BASE_INP: CSSProperties = {
  width: '100%',
  background: 'var(--input-bg)',
  border: '1.5px solid var(--border2)',
  borderRadius: 8,
  padding: '8px 11px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

export const MONO_INP: CSSProperties = {
  ...BASE_INP,
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
}

export const BTN_P: CSSProperties = {
  padding: '8px 18px',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
}

export const BTN_S: CSSProperties = {
  padding: '7px 14px',
  background: 'var(--white)',
  border: '1.5px solid var(--border2)',
  borderRadius: 8,
  color: 'var(--sub, #374151)',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
}

export const LBL_S: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--muted)',
  fontWeight: 500,
  marginBottom: 5,
}

export const KV_HEADER_CELL: CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  color: 'var(--hint)',
  fontWeight: 400,
}

export type MethodColorKey = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export function getMethodColors(method: string): { bg: string; color: string; border: string } {
  return T[method as MethodColorKey] || T.GET
}
