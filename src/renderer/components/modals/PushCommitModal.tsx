import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { useBranchStore } from '../../stores/branch.store'

/** What the user chose about uncommitted changes (issue #214). */
export interface PushChoice {
  /** false = push the existing commits only; uncommitted changes stay. */
  commitPending: boolean
}

interface PushCommitModalProps {
  open: boolean
  /**
   * The project being pushed: its uncommitted changes are counted on open
   * (`git:changes`) so the dialog can say what the push would sweep in.
   */
  projectId?: string | null
  /** Prefilled, fully selected text — see `suggestedCommitMessage`. */
  defaultMessage: string
  /**
   * Receives the TRIMMED message. Never called with an empty string: a blank
   * message is rejected (confirm disabled, Enter ignored, inline hint shown)
   * instead of being silently swapped for the default, so the user always
   * sees exactly what gets committed.
   */
  onConfirm: (message: string, choice: PushChoice) => void
  onCancel: () => void
}

/**
 * "Commit & push" dialog shared by the header Push button and the branch
 * dropdown's Push (issue #136). Enter confirms, Esc cancels.
 *
 * Issue #214: with uncommitted changes the dialog says how many and lets the
 * user leave them out ("Commit the N uncommitted changes first", checked by
 * default = the #136 behaviour). Unchecked, only the existing commits are
 * pushed — after a selective commit the rest is not swept in.
 */
export default function PushCommitModal({
  open,
  projectId,
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
      <PushCommitForm
        projectId={projectId}
        defaultMessage={defaultMessage}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  )
}

function PushCommitForm({
  projectId,
  defaultMessage,
  onConfirm,
  onCancel,
}: Omit<PushCommitModalProps, 'open'>) {
  const { t } = useTranslation()
  const [message, setMessage] = useState(defaultMessage)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = useBranchStore((s) => s.changes?.items.length ?? 0)
  const fetchChanges = useBranchStore((s) => s.fetchChanges)
  const [commitPending, setCommitPending] = useState(true)
  const trimmed = message.trim()
  // Pushing commits only needs no message.
  const blank = commitPending && trimmed.length === 0

  useEffect(() => {
    if (projectId) void fetchChanges(projectId)
  }, [projectId, fetchChanges])

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
    onConfirm(trimmed, { commitPending: commitPending || pending === 0 })
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
          <h3 className="text-sm font-semibold text-[var(--text)]">{t('push.modalTitle')}</h3>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{t('push.modalDescription')}</p>
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
          disabled={!commitPending}
          data-testid="push-commit-message"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        {blank && (
          <p role="alert" className="mt-1.5 text-[12px] text-[var(--red)]">
            {t('push.messageRequired')}
          </p>
        )}
        {pending > 0 && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-[var(--text)]">
            <input
              type="checkbox"
              checked={commitPending}
              onChange={(e) => setCommitPending(e.target.checked)}
              data-testid="push-include-pending"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
            <span>
              {formatCount(pending, t('push.includePendingOne'), t('push.includePending'))}
              {!commitPending && (
                <span className="block text-[var(--hint)]">{t('push.pendingStays')}</span>
              )}
            </span>
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          data-testid="push-commit-cancel"
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-sm font-medium text-[var(--text)] transition-colors hover:opacity-80"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={blank}
          data-testid="push-commit-confirm"
          className="rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(commitPending || pending === 0 ? 'push.confirm' : 'push.confirmPushOnly')}
        </button>
      </div>
    </div>
  )
}
