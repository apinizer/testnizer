import { useState } from 'react'
import { Bookmark, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'

export interface SavedMessageItem {
  id: string
  name: string
  /** Second line: the event name and argument count, or the format. */
  subtitle: string
}

/**
 * "Saved messages" pane next to the composer, shared by WebSocket and
 * Socket.IO (issues #282 / #283; Postman's pane): click a message to load it
 * into the composer, double-click (or F2) its name to rename, hover to
 * delete, "Add message" for a blank one. The composer's Save button writes
 * back into the loaded one. Saved with the request (endpoint metadata).
 * Test ids `${testIdPrefix}-saved-*`.
 */
export default function SavedMessagesPane({
  items,
  activeId,
  onLoad,
  onRename,
  onDelete,
  onAdd,
  testIdPrefix,
}: {
  items: readonly SavedMessageItem[]
  activeId: string | null
  onLoad: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const id = (s: string): string => `${testIdPrefix}-saved-${s}`
  const commit = (): void => {
    if (editing && editing.name.trim()) onRename(editing.id, editing.name.trim())
    setEditing(null)
  }
  return (
    <div data-testid={id('pane')} className="flex min-h-0 flex-col">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {t('rt.saved.title')}
        </span>
        <button
          type="button"
          onClick={onAdd}
          data-testid={id('add')}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1 text-[11px] text-[var(--accent-text)] hover:underline"
        >
          <Plus size={12} aria-hidden />
          {t('rt.saved.add')}
        </button>
      </div>
      {items.length === 0 ? (
        <p data-testid={id('empty')} className="m-0 text-[11px] text-[var(--hint)]">
          {t('rt.saved.empty')}
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto p-0">
          {items.map((m) => (
            <li
              key={m.id}
              data-testid={id('item')}
              data-active={m.id === activeId || undefined}
              className={`group flex items-center gap-1.5 rounded px-1.5 py-1 ${
                m.id === activeId ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--surface)]'
              }`}
            >
              <Bookmark size={12} aria-hidden className="shrink-0 text-[var(--muted)]" />
              {editing?.id === m.id ? (
                <input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ id: m.id, name: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  aria-label={t('rt.saved.rename')}
                  data-testid={id('rename-input')}
                  className="h-6 min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--white)] px-1 text-xs text-[var(--text)] outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onLoad(m.id)}
                  onDoubleClick={() => setEditing({ id: m.id, name: m.name })}
                  onKeyDown={(e) => e.key === 'F2' && setEditing({ id: m.id, name: m.name })}
                  title={t('rt.saved.loadHint')}
                  data-testid={id('load')}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-start border-none bg-transparent p-0 text-left"
                >
                  <span className="w-full truncate text-xs text-[var(--text)]">{m.name}</span>
                  <span className="w-full truncate font-mono text-[10px] text-[var(--muted)]">
                    {m.subtitle}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(m.id)}
                aria-label={t('rt.saved.delete').replace('{name}', m.name)}
                title={t('common.delete')}
                data-testid={id('delete')}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] opacity-0 hover:text-[var(--red)] focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
