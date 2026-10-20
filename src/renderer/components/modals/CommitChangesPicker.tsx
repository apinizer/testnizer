import GitChangesList from '../sidebar/GitChangesList'
import { useTranslation } from '../../lib/i18n'
import {
  checkStateOf,
  toggleAllChanges,
  toggleChange,
  toggleChangeGroup,
} from '../../lib/git-change-selection'
import { gitChangeKey, type GitChangesSummary } from '../../../shared/git-changes'

interface CommitChangesPickerProps {
  changes: GitChangesSummary | null
  loading: boolean
  selected: Set<string>
  onSelect: (next: Set<string>) => void
}

/**
 * The Commit panel's "Changes" box (issues #207, #214): heading with a
 * select-all checkbox and the "n of m selected" count, the grouped list with
 * a checkbox per row, and the note on what happens to unchecked changes.
 */
export default function CommitChangesPicker({
  changes,
  loading,
  selected,
  onSelect,
}: CommitChangesPickerProps) {
  const { t } = useTranslation()
  const items = changes?.items ?? []
  const hasChanges = items.length > 0
  const state = checkStateOf(selected, items)
  const count = items.filter((i) => selected.has(gitChangeKey(i))).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-[var(--muted)]"
        data-testid="git-changes-heading"
      >
        {hasChanges && (
          <input
            type="checkbox"
            checked={state === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'some'
            }}
            onChange={() => onSelect(toggleAllChanges(selected, items))}
            aria-label={t('gitCommit.selectAll')}
            data-testid="git-changes-select-all"
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
        )}
        <span>
          {state === 'all' || !hasChanges
            ? t('gitCommit.changesHeading').replace('{count}', String(items.length))
            : t('gitCommit.changesHeadingSelected')
                .replace('{selected}', String(count))
                .replace('{count}', String(items.length))}
        </span>
      </div>
      <div className="min-h-[64px] flex-1 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
        {loading && !changes ? (
          <p className="text-[13px] text-[var(--hint)]">{t('gitCommit.loading')}</p>
        ) : !changes ? (
          <p className="text-[13px] text-[var(--red)]">{t('gitCommit.loadFailed')}</p>
        ) : hasChanges ? (
          <GitChangesList
            items={items}
            selection={{
              selected,
              onToggle: (key) => onSelect(toggleChange(selected, key, items)),
              onToggleGroup: (kind) => onSelect(toggleChangeGroup(selected, kind, items)),
            }}
          />
        ) : (
          <p data-testid="git-changes-empty" className="text-[13px] text-[var(--hint)]">
            {t('gitCommit.noChanges')}
          </p>
        )}
      </div>
      {hasChanges && (
        <p data-testid="git-changes-note" className="mt-1.5 text-[12px] text-[var(--hint)]">
          {t(state === 'all' ? 'gitCommit.selectionNote' : 'gitCommit.partialNote')}
        </p>
      )}
    </div>
  )
}
