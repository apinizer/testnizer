import { createElement, isValidElement, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type EmptyStateAction = {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

interface EmptyStateProps {
  /** Lucide icon component OR an arbitrary ReactNode (already-instantiated icon). */
  icon?: LucideIcon | ReactNode
  /** Primary message. */
  title?: string
  description?: string
  action?: EmptyStateAction
  /**
   * Layout variant.
   *  - 'centered' (default): full-area, vertically + horizontally centered
   *  - 'compact':            inline, smaller padding for inside cards/panels
   */
  variant?: 'centered' | 'compact'
  /** Visual size — controls icon + text scale. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_TOKENS = {
  sm: { iconPx: 20, titlePx: 13, descPx: 12, gap: 'gap-2', pad: 'p-4' },
  md: { iconPx: 28, titlePx: 14, descPx: 13, gap: 'gap-3', pad: 'p-6' },
  lg: { iconPx: 36, titlePx: 16, descPx: 14, gap: 'gap-3', pad: 'p-8' },
} as const

/**
 * Resolve `icon` to a renderable node. Lucide components arrive as objects
 * (forwardRef components have `$$typeof` + `render`), while plain function
 * components are `typeof === 'function'`. Either form needs `createElement`
 * so the caller gets automatic sizing + color tokens. Existing call sites
 * that pass a JSX element (e.g. <Send size={32} />) still work via the
 * isValidElement branch.
 */
function isRenderableComponent(icon: unknown): icon is LucideIcon {
  if (typeof icon === 'function') return true
  if (typeof icon === 'object' && icon !== null) {
    // forwardRef / memo components have $$typeof and a `render` (or `type`)
    // function — both are safely passable to React.createElement.
    return '$$typeof' in (icon as Record<string, unknown>)
  }
  return false
}

function renderIcon(icon: LucideIcon | ReactNode, iconPx: number): ReactNode {
  if (!icon) return null
  if (isValidElement(icon)) return icon
  if (isRenderableComponent(icon)) {
    return createElement(icon, { size: iconPx, strokeWidth: 1.5 })
  }
  return icon as ReactNode
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'centered',
  size = 'md',
  className = '',
}: EmptyStateProps): React.JSX.Element {
  const tokens = SIZE_TOKENS[size]
  const text = title ?? ''

  const containerClasses =
    variant === 'centered'
      ? `flex h-full flex-col items-center justify-center ${tokens.gap} ${tokens.pad} text-center ${className}`
      : `flex flex-col items-center ${tokens.gap} px-3 py-4 text-center ${className}`

  const iconNode = renderIcon(icon, tokens.iconPx)
  const ActionIcon = action?.icon

  return (
    <div className={containerClasses}>
      {iconNode && <div style={{ color: 'var(--hint)' }}>{iconNode}</div>}
      {text && (
        <p
          className="font-medium"
          style={{ color: 'var(--muted)', fontSize: tokens.titlePx, margin: 0 }}
        >
          {text}
        </p>
      )}
      {description && (
        <p style={{ color: 'var(--hint)', fontSize: tokens.descPx, margin: 0 }}>{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-[7px] bg-[var(--accent)] px-3.5 py-1.5 font-semibold text-white transition-colors hover:opacity-90"
          style={{ fontSize: tokens.descPx }}
        >
          {ActionIcon && <ActionIcon size={13} />}
          {action.label}
        </button>
      )}
    </div>
  )
}
