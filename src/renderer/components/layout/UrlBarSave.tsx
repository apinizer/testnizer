import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Save } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { Z } from '../../lib/z-index'
import { BTN_S } from '../../styles/tokens'
import type { UrlBarSaveState } from './use-url-bar-save'

/** Wide layout: the inline Save button (unchanged look and testid). */
export function UrlBarSaveButton({ state }: { state: UrlBarSaveState }) {
  const { t } = useTranslation()
  const { save, loading, ok, error } = state
  const tone = error ? 'var(--red)' : ok ? 'var(--green)' : undefined
  return (
    <button
      type="button"
      data-testid="save-btn"
      onClick={() => void save()}
      disabled={loading}
      title={error ?? undefined}
      className="shrink-0"
      style={{
        ...BTN_S,
        height: 32,
        borderRadius: 8,
        marginLeft: 6,
        borderColor: tone,
        color: tone,
      }}
    >
      <Save size={13} aria-hidden="true" />
      {error ? '✗' : ok ? '✓' : t('urlBar.save')}
    </button>
  )
}

/**
 * Compact layout (issue #251): Save moves into an overflow menu so the URL
 * field keeps its room. Closes on Escape, an outside mousedown and a pick.
 */
export function UrlBarMoreMenu({ state }: { state: UrlBarSaveState }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  /** Close and hand focus back to the trigger (WAI-ARIA menu button pattern). */
  const closeToButton = (): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    firstItemRef.current?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const tone = state.error ? 'var(--red)' : state.ok ? 'var(--green)' : undefined
  return (
    <div ref={rootRef} className="relative ml-[4px] shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid="url-more-btn"
        aria-label={t('urlBar.more')}
        title={state.error ?? t('urlBar.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={state.loading}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center rounded-lg border border-[var(--border2)] bg-[var(--white)] text-[var(--sub)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        style={tone ? { color: tone, borderColor: tone } : undefined}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="url-more-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              closeToButton()
            }
          }}
          className="absolute right-0 top-[calc(100%+4px)] min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--white)] p-1 shadow-[var(--shadow-drop)]"
          style={{ zIndex: Z.DROPDOWN }}
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            data-testid="url-more-save"
            onClick={() => {
              closeToButton()
              void state.save()
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-none bg-transparent px-2.5 py-1.5 text-left text-[var(--text)] hover:bg-[var(--surface)]"
          >
            <Save size={13} aria-hidden="true" />
            {t('urlBar.save')}
          </button>
        </div>
      )}
    </div>
  )
}
