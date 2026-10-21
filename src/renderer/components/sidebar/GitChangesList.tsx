import { useMemo } from 'react'
import { useTranslation } from '../../lib/i18n'
import { checkStateOf, type CheckState } from '../../lib/git-change-selection'
import {
  GIT_CHANGE_KIND_ORDER,
  gitChangeKey,
  type GitChangeItem,
  type GitChangeKind,
  type GitChangeType,
} from '../../../shared/git-changes'

const MARKER: Record<GitChangeType, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-[var(--green)]' },
  modified: { letter: 'M', className: 'text-[var(--orange)]' },
  deleted: { letter: 'D', className: 'text-[var(--red)]' },
}

interface Selection {
  selected: Set<string>
  onToggle: (key: string) => void
  onToggleGroup: (kind: GitChangeKind) => void
}

/**
 * The Commit panel's change list (issue #207): rows grouped by kind
 * (Endpoints, Folders, Environment variables…), each with an A / M / D
 * marker. With `selection` (issue #214) every row and group gets a checkbox
 * and only the checked rows are committed; a row that needs another one
 * names it in its tooltip.
 */
export default function GitChangesList({
  items,
  selection,
}: {
  items: GitChangeItem[]
  selection?: Selection
}) {
  const { t } = useTranslation()
  const nameByKey = useMemo(() => new Map(items.map((i) => [gitChangeKey(i), i.name])), [items])
  const groups = useMemo(() => {
    const byKind = new Map<GitChangeKind, GitChangeItem[]>()
    for (const item of items) {
      const list = byKind.get(item.kind) ?? []
      list.push(item)
      byKind.set(item.kind, list)
    }
    return GIT_CHANGE_KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
      kind,
      rows: byKind.get(kind) ?? [],
    }))
  }, [items])

  return (
    <div data-testid="git-changes-list" className="flex flex-col gap-2">
      {groups.map(({ kind, rows }) => (
        <section key={kind} data-testid="git-changes-group" data-kind={kind}>
          <h4 className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--hint)]">
            {selection && (
              <CheckBox
                state={checkStateOf(selection.selected, rows)}
                onChange={() => selection.onToggleGroup(kind)}
                label={t(`gitCommit.kind.${kind}`)}
                testId="git-change-group-checkbox"
              />
            )}
            <span>
              {t(`gitCommit.kind.${kind}`)} · {rows.length}
            </span>
          </h4>
          <ul className="flex flex-col">
            {rows.map((row) => {
              const marker = MARKER[row.change]
              const key = gitChangeKey(row)
              const needs = (row.requires ?? []).map((k) => nameByKey.get(k)).filter(Boolean)
              return (
                <li
                  key={key}
                  data-testid="git-change-item"
                  data-change={row.change}
                  data-key={key}
                  title={
                    needs.length > 0
                      ? t('gitCommit.requires').replace('{names}', needs.join(', '))
                      : undefined
                  }
                  className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-[var(--text)]"
                >
                  {selection && (
                    <CheckBox
                      state={selection.selected.has(key) ? 'all' : 'none'}
                      onChange={() => selection.onToggle(key)}
                      label={row.name}
                      testId="git-change-checkbox"
                    />
                  )}
                  <span
                    title={t(`gitCommit.change.${row.change}`)}
                    aria-label={t(`gitCommit.change.${row.change}`)}
                    className={`w-3 shrink-0 text-center font-mono text-[12px] font-semibold ${marker.className}`}
                  >
                    {marker.letter}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${row.change === 'deleted' ? 'line-through opacity-70' : ''}`}
                  >
                    {row.name}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CheckBox({
  state,
  onChange,
  label,
  testId,
}: {
  state: CheckState
  onChange: () => void
  label: string
  testId: string
}) {
  return (
    <input
      type="checkbox"
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some'
      }}
      onChange={onChange}
      aria-label={label}
      data-testid={testId}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
    />
  )
}
