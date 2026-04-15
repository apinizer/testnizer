import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  message: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export default function EmptyState({ icon, message, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      {icon && (
        <div className="text-[var(--hint)]">{icon}</div>
      )}
      <p className="font-medium text-[var(--muted)]">{message}</p>
      {description && (
        <p className="text-[var(--hint)]">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 cursor-pointer rounded-[7px] bg-[var(--accent)] px-4 py-1.5 font-semibold text-white transition-colors hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
