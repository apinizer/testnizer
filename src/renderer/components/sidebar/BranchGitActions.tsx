import type { ReactNode } from 'react'
import { ArrowDownCircle, ArrowUpCircle, GitCommitHorizontal, GitMerge, Undo2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { GitChangesSummary } from '../../../shared/git-changes'

interface BranchGitActionsProps {
  busy: boolean
  /** null = unknown (not loaded / failed): nothing is disabled on a guess. */
  changes: GitChangesSummary | null
  onCommit: () => void
  onDiscard: () => void
  onPull: () => void
  onPush: () => void
  onToggleMerge: () => void
}

/**
 * The branch menu's git actions (issue #207): Commit… / Discard all changes
 * / Pull (behind) / Push (ahead) / Merge, plus the "0↓ 0↑" counts. Each is
 * disabled when it cannot do anything: no changes → Commit / Discard; no
 * tracking branch on origin → Pull; tracked, nothing ahead and nothing to
 * commit → Push.
 */
export default function BranchGitActions({
  busy,
  changes,
  onCommit,
  onDiscard,
  onPull,
  onPush,
  onToggleMerge,
}: BranchGitActionsProps) {
  const { t } = useTranslation()
  const known = changes !== null
  const count = changes?.items.length ?? 0
  const ahead = changes?.ahead ?? 0
  const behind = changes?.behind ?? 0
  const noChanges = known && count === 0
  const pullOff = known && !changes.hasUpstream
  // No tracking branch on origin: Push is what publishes the branch, so it
  // stays enabled even with nothing "ahead" (a master-only remote, or a
  // branch created offline — all its commits are already on another origin/*).
  const pushOff = known && changes.hasUpstream && ahead === 0 && count === 0

  return (
    <div className="flex flex-col border-b border-[var(--border)] px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <ActionButton
          testId="branch-commit"
          icon={<GitCommitHorizontal size={13} aria-hidden="true" />}
          label={t('gitCommit.menuCommit')}
          badge={known && count > 0 ? String(count) : undefined}
          disabled={busy || noChanges}
          onClick={onCommit}
        />
        <ActionButton
          testId="branch-pull"
          icon={<ArrowDownCircle size={13} aria-hidden="true" />}
          label="Pull"
          badge={known && behind > 0 ? `${behind}↓` : undefined}
          disabled={busy || pullOff}
          title={pullOff ? t('gitCommit.noUpstream') : 'Pull'}
          onClick={onPull}
        />
        <ActionButton
          testId="branch-push"
          icon={<ArrowUpCircle size={13} aria-hidden="true" />}
          label="Push"
          badge={known && ahead > 0 ? `${ahead}↑` : undefined}
          disabled={busy || pushOff}
          onClick={onPush}
        />
        <ActionButton
          testId="branch-merge"
          icon={<GitMerge size={13} aria-hidden="true" />}
          label="Merge"
          disabled={busy}
          onClick={onToggleMerge}
        />
        {known && (
          <span
            data-testid="branch-sync-counts"
            title={
              changes.hasUpstream
                ? t('gitCommit.syncCounts')
                    .replace('{behind}', String(behind))
                    .replace('{ahead}', String(ahead))
                : t('gitCommit.noUpstream')
            }
            className="ml-auto font-mono text-[12px] text-[var(--hint)]"
          >
            {behind}↓ {ahead}↑
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="branch-discard"
        disabled={busy || noChanges}
        onClick={onDiscard}
        className="mt-0.5 flex items-center gap-1 self-start rounded px-2 py-1 text-sm text-[var(--red)] enabled:cursor-pointer enabled:hover:bg-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Undo2 size={13} aria-hidden="true" />
        <span>{t('gitCommit.menuDiscard')}</span>
      </button>
    </div>
  )
}

function ActionButton({
  testId,
  icon,
  label,
  badge,
  disabled,
  title,
  onClick,
}: {
  testId: string
  icon: ReactNode
  label: string
  badge?: string
  disabled: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      title={title ?? label}
      onClick={onClick}
      className="flex items-center gap-1 rounded px-2 py-1 text-sm text-[var(--text)] enabled:cursor-pointer enabled:hover:bg-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span className="rounded bg-[var(--accent-light)] px-1 font-mono text-[11px] text-[var(--accent-text)]">
          {badge}
        </span>
      )}
    </button>
  )
}
