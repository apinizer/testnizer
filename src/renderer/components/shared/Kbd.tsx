import type { ReactNode } from 'react'

interface KbdProps {
  children: ReactNode
  className?: string
}

export default function Kbd({ children, className = '' }: KbdProps) {
  return (
    <span
      className={`rounded px-1.5 ${className}`}
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        border: '1px solid var(--border)',
        fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
      }}
    >
      {children}
    </span>
  )
}
