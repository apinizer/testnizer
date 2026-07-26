import type { ReactNode } from 'react'

/** Shared field primitives for the SAML tool panes (CSS-variable colours only). */

export const INPUT =
  'w-full rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]'

export const TEXTAREA =
  'w-full min-h-[64px] rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1 text-[11px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      <span style={{ color: 'var(--text)' }}>{label}</span>
    </label>
  )
}

export function Pane({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-1 gap-2 border-b px-2 py-2"
      style={{ borderColor: 'var(--border)' }}
    >
      {children}
    </div>
  )
}
