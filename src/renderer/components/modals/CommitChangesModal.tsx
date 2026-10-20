import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import Modal from '../shared/Modal'
import CommitChangesPicker from './CommitChangesPicker'
import { useTranslation } from '../../lib/i18n'
import { allChangeKeys, selectionForCommit } from '../../lib/git-change-selection'
import { gitChangeKey, type GitChangesSummary } from '../../../shared/git-changes'

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
  /**
   * Receives the TRIMMED message; never blank (the buttons disable). `only`
   * = the checked change keys, undefined when every change is checked.
   */
  onCommit: (message: string, andPush: boolean, only?: string[]) => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * "Commit changes" (issue #207, Insomnia parity): a message, the pre-commit
 * summary grouped by kind, and Commit / Commit and push / Discard all
 * changes. Issue #214: every change has a checkbox (all checked by default);
 * only the checked ones are committed, the rest stay uncommitted.
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
  const items = useMemo(() => changes?.items ?? [], [changes])
  const hasChanges = items.length > 0
  // null = "everything" — follows a list that (re)loads while the panel is open.
  // Reset only when the SET of changes differs, not on every re-read.
  const [picked, setPicked] = useState<{ listKey: string; keys: Set<string> } | null>(null)
  const listKey = items.map(gitChangeKey).join('|')
  const selected = useMemo(
    () => (picked && picked.listKey === listKey ? picked.keys : allChangeKeys(items)),
    [picked, listKey, items],
  )
  const only = selectionForCommit(selected, items)
  const nothingPicked = hasChanges && only?.length === 0
  const canCommit = hasChanges && !nothingPicked && !blank && !busy
  const canCommitAndPush =
    canPush && !blank && !busy && !nothingPicked && (hasChanges || (changes?.ahead ?? 0) > 0)

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
    if (canCommit) onCommit(trimmed, false, only)
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

        <CommitChangesPicker
          changes={changes}
          loading={loading}
          selected={selected}
          onSelect={(keys) => setPicked({ listKey, keys })}
        />
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
          onClick={() => onCommit(trimmed, true, only)}
          disabled={!canCommitAndPush}
          title={canPush ? undefined : t('gitCommit.noToken')}
          data-testid="git-commit-and-push"
          className="rounded-md border border-[var(--accent)] bg-[var(--white)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent)] enabled:cursor-pointer enabled:hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('gitCommit.commitAndPush')}
        </button>
        <button
          type="button"
          onClick={() => onCommit(trimmed, false, only)}
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
