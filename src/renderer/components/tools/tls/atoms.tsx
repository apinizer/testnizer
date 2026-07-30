/**
 * TLS Inspector presentational primitives, lifted out of `TlsInspectorTool.tsx`
 * when it outgrew the ~200-line rule. Pure move — same markup, same CSS vars.
 */
/** Shared palette — the badge/meta colours the whole tool uses. */
export const GREEN = '#1a7a4a'
export const GREEN_BG = '#e8f9f1'
export const AMBER = '#b35a00'
export const AMBER_BG = '#fff4e0'
export const RED = '#cc2200'
export const RED_BG = '#fff0f0'

export function Labeled({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export function TextInput({
  id,
  value,
  placeholder,
  width,
  onChange,
}: {
  id: string
  value: string
  placeholder?: string
  width?: string
  onChange: (v: string) => void
}) {
  return (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width ?? 'w-full'} rounded border p-1.5 text-xs`}
      style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
    />
  )
}

export function SelectInput({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: Array<[string, string]>
  onChange: (v: string) => void
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border p-1.5 text-xs"
      style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

export function FileRow({
  label,
  value,
  onPick,
}: {
  label: string
  value: string
  onPick: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPick}
        className="shrink-0 rounded border px-2 py-1 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--white)',
          color: 'var(--accentText)',
        }}
      >
        {label}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

export function Badge({
  bg,
  color,
  children,
}: {
  bg: string
  color: string
  children: React.ReactNode
}) {
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  )
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Caption>{label}</Caption>
      <div className="break-all font-mono text-[11px]" style={{ color: 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </div>
  )
}

export function DialogBtn({
  onClick,
  primary,
  disabled,
  children,
}: {
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      style={
        primary
          ? { background: 'var(--accent)', color: '#fff' }
          : { border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text)' }
      }
    >
      {children}
    </button>
  )
}
