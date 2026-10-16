import { useMemo } from 'react'
import { useTranslation } from '../../lib/i18n'
import {
  GIT_CHANGE_KIND_ORDER,
  type GitChangeItem,
  type GitChangeKind,
  type GitChangeType,
} from '../../../shared/git-changes'

const MARKER: Record<GitChangeType, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-[var(--green)]' },
  modified: { letter: 'M', className: 'text-[var(--orange)]' },
  deleted: { letter: 'D', className: 'text-[var(--red)]' },
}

/**
 * The Commit panel's change list (issue #207): rows grouped by kind
 * (Endpoints, Folders, Environment variables…), each with an A / M / D
 * marker. Read-only — the project is one file, so there is no per-row
 * staging; the whole list is what the next commit writes.
 */
export default function GitChangesList({ items }: { items: GitChangeItem[] }) {
  const { t } = useTranslation()
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
          <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--hint)]">
            {t(`gitCommit.kind.${kind}`)} · {rows.length}
          </h4>
          <ul className="flex flex-col">
            {rows.map((row) => {
              const marker = MARKER[row.change]
              return (
                <li
                  key={`${row.kind}:${row.id}`}
                  data-testid="git-change-item"
                  data-change={row.change}
                  className="flex items-center gap-2 rounded px-1 py-0.5 text-[13px] text-[var(--text)]"
                >
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
