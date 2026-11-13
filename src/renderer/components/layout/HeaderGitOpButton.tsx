import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export type OpStatus = 'idle' | 'loading' | 'success' | 'error'

interface HeaderGitOpButtonProps {
  kind: 'pull' | 'push'
  status: OpStatus
  /** Another header operation is running — this one is locked and dimmed. */
  anyLoading: boolean
  onClick: () => void
}

const TONE: Record<OpStatus, string> = {
  idle: 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]',
  loading: 'border-[var(--border)] text-[var(--muted)]',
  success: 'border-[var(--green)] text-[var(--green)]',
  error: 'border-[var(--red)] text-[var(--red)]',
}

/** The header's Git Pull / Git Push button (one anatomy for both). */
export default function HeaderGitOpButton({
  kind,
  status,
  anyLoading,
  onClick,
}: HeaderGitOpButtonProps) {
  const { t } = useTranslation()
  const Icon = kind === 'pull' ? ArrowDown : ArrowUp
  const dimmed = anyLoading && status !== 'loading'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={anyLoading}
      data-testid={`header-${kind}`}
      title={kind === 'pull' ? t('git.pullTitle') : t('git.pushTitle')}
      className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-[7px] border bg-transparent px-2 py-1 text-sm transition-all duration-200 ${TONE[status]} ${dimmed ? 'opacity-50' : ''}`}
    >
      {status === 'loading' ? (
        <Loader2 size={12} aria-hidden="true" className="animate-spin" />
      ) : (
        <Icon size={12} strokeWidth={2} aria-hidden="true" />
      )}
      <span>{kind === 'pull' ? t('git.pull') : t('git.push')}</span>
    </button>
  )
}
