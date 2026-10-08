import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'

interface PushCommitModalProps {
  open: boolean
  /** Prefilled, fully selected text — see `suggestedCommitMessage`. */
  defaultMessage: string
  /**
   * Receives the TRIMMED message. Never called with an empty string: a blank
   * message is rejected (confirm disabled, Enter ignored, inline hint shown)
   * instead of being silently swapped for the default, so the user always
   * sees exactly what gets committed.
   */
  onConfirm: (message: string) => void
  onCancel: () => void
}

/**
 * "Commit & push" dialog shared by the header Push button and the branch
 * dropdown's Push (issue #136). Enter confirms, Esc cancels.
 */
export default function PushCommitModal({
  open,
  defaultMessage,
  onConfirm,
  onCancel,
}: PushCommitModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={t('push.modalTitle')}
      description={t('push.modalDescription')}
      testId="push-commit-modal"
    >
      {/* Radix unmounts the content while closed, so the form (and its
          state) starts fresh from `defaultMessage` on every open. */}
      <PushCommitForm defaultMessage={defaultMessage} onConfirm={onConfirm} onCancel={onCancel} />
    </Modal>
  )
}

function PushCommitForm({
  defaultMessage,
  onConfirm,
  onCancel,
}: Omit<PushCommitModalProps, 'open'>) {
  const { t } = useTranslation()
  const [message, setMessage] = useState(defaultMessage)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = message.trim()
  const blank = trimmed.length === 0

  // Focus + select after Radix's own mount auto-focus, so typing replaces
  // the suggestion while arrow keys keep it.
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  function submit(): void {
    if (blank) return
    onConfirm(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  return (
    <div className="w-[460px] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
          <ArrowUpCircle size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-[var(--text)]">{t('push.modalTitle')}</h3>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{t('push.modalDescription')}</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <label
          htmlFor="push-commit-message"
          className="mb-1.5 block text-[12px] font-medium text-[var(--muted)]"
        >
          {t('push.messageLabel')}
        </label>
        <input
          id="push-commit-message"
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('push.messagePlaceholder')}
          aria-invalid={blank}
          data-testid="push-commit-message"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        {blank && (
          <p role="alert" className="mt-1.5 text-[12px] text-[var(--red)]">
            {t('push.messageRequired')}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          data-testid="push-commit-cancel"
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:opacity-80"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={blank}
          data-testid="push-commit-confirm"
          className="rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('push.confirm')}
        </button>
      </div>
    </div>
  )
}
