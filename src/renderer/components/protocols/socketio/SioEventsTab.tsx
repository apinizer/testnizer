import { Plus, Radio, Trash2 } from 'lucide-react'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import EmptyState from '../../shared/EmptyState'
import { Checkbox, INPUT_CLS } from '../../mock-mcp/ui'

/**
 * Events tab (issue #283) — Postman's listeners: name, description and a
 * Listen toggle per event; only listened events reach the timeline. "Listen
 * to all events" keeps the pre-#283 behaviour (every received event shown)
 * as an explicit choice; a request saved before this tab existed opens with
 * it on. Edits while connected apply at once.
 */
export default function SioEventsTab() {
  const { t } = useTranslation()
  const listeners = useSocketIOStore((s) => s.listeners)
  const listenAll = useSocketIOStore((s) => s.listenAll)
  const newListener = useSocketIOStore((s) => s.newListener)
  const setNewListener = useSocketIOStore((s) => s.setNewListener)
  const addListener = useSocketIOStore((s) => s.addListener)
  const updateListener = useSocketIOStore((s) => s.updateListener)
  const removeListener = useSocketIOStore((s) => s.removeListener)
  const setListenAll = useSocketIOStore((s) => s.setListenAll)

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <Checkbox
          checked={listenAll}
          onChange={setListenAll}
          label={t('socketio.listenAll')}
          testId="socketio-listen-all"
        />
        <p className="m-0 pl-6 text-[11px] text-[var(--muted)]">
          {listenAll ? t('socketio.listenAllOnHint') : t('socketio.listenAllOffHint')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newListener}
          onChange={(e) => setNewListener(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addListener()}
          placeholder={t('socketio.listenerPlaceholder')}
          aria-label={t('socketio.listenerPlaceholder')}
          data-testid="socketio-listener-input"
          className={`${INPUT_CLS} max-w-[18rem] font-mono`}
        />
        <button
          type="button"
          onClick={addListener}
          disabled={!newListener.trim()}
          data-testid="socketio-listener-add"
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-transparent px-2.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={12} aria-hidden />
          {t('socketio.addListener')}
        </button>
      </div>
      {listeners.length === 0 ? (
        <EmptyState icon={Radio} title={t('socketio.noListeners')} variant="compact" size="sm" />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {listeners.map((l) => (
            <li
              key={l.id}
              data-testid="socketio-listener"
              className="group flex items-center gap-2"
            >
              <input
                type="checkbox"
                checked={l.listen}
                onChange={(e) => updateListener(l.id, { listen: e.target.checked })}
                aria-label={t('socketio.listenToggle').replace('{name}', l.name)}
                data-testid="socketio-listener-listen"
                className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              <input
                type="text"
                value={l.name}
                onChange={(e) => updateListener(l.id, { name: e.target.value })}
                aria-label={t('socketio.listenerName')}
                data-testid="socketio-listener-name"
                className={`${INPUT_CLS} max-w-[14rem] font-mono`}
              />
              <input
                type="text"
                value={l.description}
                onChange={(e) => updateListener(l.id, { description: e.target.value })}
                placeholder={t('kv.description')}
                aria-label={t('kv.description')}
                data-testid="socketio-listener-description"
                className={`${INPUT_CLS} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => removeListener(l.id)}
                aria-label={t('socketio.removeListener').replace('{name}', l.name)}
                data-testid="socketio-listener-remove"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:text-[var(--red)]"
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
