import { useState, type ReactElement } from 'react'
import { Check, ChevronDown, History, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import {
  deleteAiConversation,
  newAiConversation,
  renameAiConversation,
  switchAiConversation,
} from '../../../stores/ai-chat-conversations'
import { useTranslation } from '../../../lib/i18n'
import type { AiConversationSummary } from '../../../../shared/ai-chat-types'

const NO_CONVERSATIONS: AiConversationSummary[] = []

const BTN =
  'flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Conversation name + history (issue #199, Postman parity): switch, new,
 * rename, delete. Conversations are stored locally — never in the project
 * file or git.
 */
export default function AiChatConversationBar(): ReactElement {
  const { t } = useTranslation()
  const name = useAiChatStore((s) => s.conversationName)
  const currentId = useAiChatStore((s) => s.conversationId)
  const list = useAiChatStore((s) => s.conversations) ?? NO_CONVERSATIONS
  const streaming = useAiChatStore((s) => s.streaming)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (id: string): void => {
    if (draft.trim()) void renameAiConversation(id, draft)
    setEditing(null)
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={streaming}
        className={BTN}
        aria-expanded={open}
        data-testid="ai-conversations-toggle"
        title={t('aiChat.conversations.title')}
      >
        <History size={13} />
        <span
          className="max-w-[220px] truncate"
          style={{ fontSize: 12 }}
          data-testid="ai-conversation-name"
        >
          {name ?? t('aiChat.conversations.new')}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 z-50 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--white)] p-1"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
          data-testid="ai-conversation-list"
        >
          <button
            type="button"
            onClick={() => {
              newAiConversation()
              setOpen(false)
            }}
            className="flex w-full cursor-pointer items-center gap-1 rounded border-none bg-transparent px-2 py-1 text-left text-[var(--accent-text)]"
            style={{ fontSize: 12 }}
            data-testid="ai-conversation-new"
          >
            <Plus size={12} />
            {t('aiChat.conversations.newTitle')}
          </button>
          {list.length === 0 && (
            <p className="px-2 py-1.5 text-[var(--muted)]" style={{ fontSize: 12 }}>
              {t('aiChat.conversations.empty')}
            </p>
          )}
          {list.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-1 rounded px-2 py-1"
              style={{ background: c.id === currentId ? 'var(--accent-light)' : 'transparent' }}
            >
              {editing === c.id ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(c.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    className="flex-1 rounded border border-[var(--border)] px-1 text-[var(--text)]"
                    style={{ fontSize: 12 }}
                    aria-label={t('aiChat.conversations.rename')}
                  />
                  <button
                    type="button"
                    onClick={() => commit(c.id)}
                    className="border-none bg-transparent p-0.5"
                    aria-label={t('aiChat.conversations.rename')}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="border-none bg-transparent p-0.5"
                    aria-label={t('common.cancel')}
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void switchAiConversation(c.id)
                      setOpen(false)
                    }}
                    className="flex-1 cursor-pointer truncate border-none bg-transparent text-left text-[var(--text)]"
                    style={{ fontSize: 12 }}
                  >
                    {c.name}
                    <span className="ml-1 text-[var(--hint)]">
                      · {new Date(c.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(c.id)
                      setDraft(c.name)
                    }}
                    className="cursor-pointer border-none bg-transparent p-0.5 text-[var(--muted)]"
                    title={t('aiChat.conversations.rename')}
                    aria-label={t('aiChat.conversations.rename')}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteAiConversation(c.id)}
                    className="cursor-pointer border-none bg-transparent p-0.5 text-[var(--muted)] hover:text-[var(--red)]"
                    title={t('aiChat.conversations.delete')}
                    aria-label={t('aiChat.conversations.delete')}
                    data-testid="ai-conversation-delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
