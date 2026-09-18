import { useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import {
  useSavedResponseStore,
  savedResponseOwnerForTab,
  defaultSavedResponseName,
} from '../../stores/saved-response.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'

/**
 * "Save response" (issue #125): pins the response currently shown in the
 * pane to the request the tab is backed by, under a user-chosen name. An
 * unsaved scratch tab has no row to pin to, so the button explains that
 * instead of silently doing nothing.
 */
export default function SaveResponseButton({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation()
  const response = useResponseStore((s) => s.response)
  const activeTab = useTabsStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId))
  const saveCurrent = useSavedResponseStore((s) => s.saveCurrent)
  const owner = savedResponseOwnerForTab(activeTab)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 10)
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  if (!response) return null

  function start(): void {
    if (!owner) {
      toast.info(t('response.saveResponseNeedsSavedRequest'))
      return
    }
    setName(defaultSavedResponseName(response!))
    setOpen(true)
  }

  async function confirm(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const result = await saveCurrent(trimmed)
    setBusy(false)
    if (result.ok) {
      setOpen(false)
      if (result.bodyDropped) toast.warning(t('response.savedResponseBodyDropped'))
      else toast.success(t('response.savedResponseSaved'))
      onSaved?.()
    } else {
      toast.error(
        result.error === 'unsaved-request'
          ? t('response.saveResponseNeedsSavedRequest')
          : t('toast.saveFailed'),
      )
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="response-save-btn"
        title={owner ? t('response.saveResponse') : t('response.saveResponseNeedsSavedRequest')}
        onClick={start}
        className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        style={{
          borderColor: 'var(--border)',
          background: 'transparent',
          opacity: owner ? 1 : 0.6,
        }}
      >
        <Bookmark size={11} />
        {t('response.saveResponse')}
      </button>
      {open && (
        <div
          ref={popRef}
          data-testid="response-save-popover"
          className="absolute right-0 z-50 mt-1 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] p-2 shadow-lg"
          style={{ top: '100%', minWidth: 260 }}
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm()
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder={t('response.saveResponseName')}
            className="flex-1 rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            style={{ fontSize: 12 }}
          />
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!name.trim() || busy}
            className="cursor-pointer rounded px-2 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--accent)', border: 'none', fontSize: 12 }}
          >
            {t('response.save')}
          </button>
        </div>
      )}
    </div>
  )
}
