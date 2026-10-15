import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import Modal from '../shared/Modal'
import GitChangesList from '../sidebar/GitChangesList'
import { useTranslation } from '../../lib/i18n'
import type { GitChangesSummary } from '../../../shared/git-changes'

interface CommitChangesModalProps {
  open: boolean
  /** null while loading or when the summary could not be read. */
  changes: GitChangesSummary | null
  loading: boolean
  /** Prefilled, fully selected message (see `suggestedCommitMessage`). */
  defaultMessage: string
  /** False without a Git token: Commit and push is disabled with a hint. */
  canPush: boolean
  busy: boolean
  /** Receives the TRIMMED message; never blank (the buttons disable). */
  onCommit: (message: string, andPush: boolean) => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * "Commit changes" (issue #207, Insomnia parity): a message, the pre-commit
 * summary grouped by kind, and Commit / Commit and push / Discard all
 * changes. The project is one tracked file, so there is no per-row staging —
 * the list is exactly what the commit writes.
 */
export default function CommitChangesModal(props: CommitChangesModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={props.open}
      onOpenChange={(o) => !o && props.onCancel()}
      title={t('gitCommit.title')}
      description={t('gitCommit.description')}
      testId="git-commit-modal"
    >
      <CommitForm {...props} />
    </Modal>
  )
}

function CommitForm({
  changes,
  loading,
  defaultMessage,
  canPush,
  busy,
  onCommit,
  onDiscard,
  onCancel,
}: CommitChangesModalProps) {
  const { t } = useTranslation()
  const [message, setMessage] = useState(defaultMessage)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = message.trim()
  const blank = trimmed.length === 0
  const items = changes?.items ?? []
  const hasChanges = items.length > 0
  const canCommit = hasChanges && !blank && !busy
  const canCommitAndPush = canPush && !blank && !busy && (hasChanges || (changes?.ahead ?? 0) > 0)

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // Cmd/Ctrl+Enter commits; a plain Enter is a new line of the message.
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (canCommit) onCommit(trimmed, false)
  }

  return (
    <div className="flex max-h-[80vh] w-[520px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
          <GitCommitHorizontal size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-[var(--text)]">{t('gitCommit.title')}</h3>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{t('gitCommit.description')}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
        <div>
          <label
            htmlFor="git-commit-message"
            className="mb-1.5 block text-[12px] font-medium text-[var(--muted)]"
          >
            {t('push.messageLabel')}
          </label>
          <textarea
            id="git-commit-message"
            ref={inputRef}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('push.messagePlaceholder')}
            aria-invalid={blank}
            data-testid="git-commit-message"
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          {blank && (
            <p role="alert" className="mt-1 text-[12px] text-[var(--red)]">
              {t('push.messageRequired')}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="mb-1.5 text-[12px] font-medium text-[var(--muted)]"
            data-testid="git-changes-heading"
          >
            {t('gitCommit.changesHeading').replace('{count}', String(items.length))}
          </div>
          <div className="min-h-[64px] flex-1 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
            {loading && !changes ? (
              <p className="text-[13px] text-[var(--hint)]">{t('gitCommit.loading')}</p>
            ) : !changes ? (
              <p className="text-[13px] text-[var(--red)]">{t('gitCommit.loadFailed')}</p>
            ) : hasChanges ? (
              <GitChangesList items={items} />
            ) : (
              <p data-testid="git-changes-empty" className="text-[13px] text-[var(--hint)]">
                {t('gitCommit.noChanges')}
              </p>
            )}
          </div>
          {hasChanges && (
            <p className="mt-1.5 text-[12px] text-[var(--hint)]">{t('gitCommit.singleFileNote')}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!hasChanges || busy}
          data-testid="git-commit-discard"
          className="rounded-md px-2 py-1.5 text-[13px] font-medium text-[var(--red)] enabled:cursor-pointer enabled:hover:bg-[var(--item-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('gitCommit.discardAll')}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          data-testid="git-commit-cancel"
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--text)] hover:opacity-80"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onCommit(trimmed, true)}
          disabled={!canCommitAndPush}
          title={canPush ? undefined : t('gitCommit.noToken')}
          data-testid="git-commit-and-push"
          className="rounded-md border border-[var(--accent)] bg-[var(--white)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent)] enabled:cursor-pointer enabled:hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('gitCommit.commitAndPush')}
        </button>
        <button
          type="button"
          onClick={() => onCommit(trimmed, false)}
          disabled={!canCommit}
          data-testid="git-commit-confirm"
          className="rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-medium text-white enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('gitCommit.commit')}
        </button>
      </div>
    </div>
  )
}
