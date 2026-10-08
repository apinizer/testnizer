import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Small uppercase pane label, optional right-aligned slot. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {children}
      </span>
      {right && <span className="ml-auto flex items-center gap-1.5">{right}</span>}
    </div>
  )
}

export function PrimaryButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none bg-[var(--accent)] px-4 font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  )
}

export function GhostButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-2.5 text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  )
}

/** Centered muted hint filling the remaining space. */
export function CenterHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-[13px] text-[var(--hint)]">
      {children}
    </div>
  )
}

/** Red inline error line. */
export function ErrorLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="text-[12px] text-[var(--red)]">
      {children}
    </div>
  )
}

export function JsonPre({ value, testId }: { value: unknown; testId?: string }) {
  let text: string
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
  } catch {
    text = String(value)
  }
  return (
    <pre
      data-testid={testId}
      className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text)]"
    >
      {text}
    </pre>
  )
}
