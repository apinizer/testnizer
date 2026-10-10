import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Send, Square, Trash2, Bot } from 'lucide-react'
import { useAiChatStore } from '../../stores/ai-chat.store'
import { ensureAiConversationsLoaded } from '../../stores/ai-chat-conversations'
import { useTranslation } from '../../lib/i18n'
import AiChatSettingsSection from './ai-chat/AiChatSettingsSection'
import AiChatToolsSection from './ai-chat/AiChatToolsSection'
import AiChatConversationView from './ai-chat/AiChatConversationView'
import AiChatConversationBar from './ai-chat/AiChatConversationBar'

// Kept importable from the editor (tests and older call sites).
export { isPinnedToBottom, SCROLL_PIN_THRESHOLD_PX } from '../../lib/ai-chat-view'

/**
 * AI Chat request editor: Settings, Tools (MCP servers as tools, issue #180),
 * the conversation (tool calls, approvals, per-message metrics — #198) and
 * the conversation history (#199).
 */
export default function AiChatEditor(): ReactElement {
  const { t } = useTranslation()
  const messages = useAiChatStore((s) => s.messages)
  const streaming = useAiChatStore((s) => s.streaming)
  const currentTabId = useAiChatStore((s) => s._currentTabId)
  const conversationLoaded = useAiChatStore((s) => s.conversationLoaded)
  const sendPrompt = useAiChatStore((s) => s.sendPrompt)
  const cancel = useAiChatStore((s) => s.cancel)
  const clearConversation = useAiChatStore((s) => s.clearConversation)

  const [draft, setDraft] = useState('')
  const pinnedRef = useRef(true)

  // The request's conversations come from the local database (issue #199) —
  // once per tab and session (first open / after a restart).
  useEffect(() => {
    if (!conversationLoaded) void ensureAiConversationsLoaded()
  }, [currentTabId, conversationLoaded])

  function handleSend(): void {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    // Sending is an explicit "show me what happens next" — re-pin even if the
    // user was reading scrollback.
    pinnedRef.current = true
    void sendPrompt(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <Bot size={16} style={{ color: 'var(--accent-text)' }} />
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          {t('aiChat.title')}
        </span>
        {streaming && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{ background: '#e8f9f1', color: '#1a7a4a' }}
          >
            {t('aiChat.streaming')}
          </span>
        )}
        <div className="flex-1" />
        <AiChatConversationBar />
        <button
          type="button"
          onClick={clearConversation}
          disabled={streaming || messages.length === 0}
          title={t('aiChat.clear')}
          className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={13} />
          <span style={{ fontSize: 12 }}>{t('aiChat.clear')}</span>
        </button>
      </div>

      <AiChatSettingsSection />
      <AiChatToolsSection />
      <AiChatConversationView pinnedRef={pinnedRef} />

      <div className="shrink-0 border-t border-[var(--border)] p-3.5">
        <div className="flex items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--white)] p-2 focus-within:border-[var(--accent)]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiChat.placeholder')}
            rows={2}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-[var(--text)] outline-none placeholder:text-[var(--hint)]"
            style={{ fontSize: 13 }}
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => void cancel()}
              title={t('aiChat.stop')}
              className="flex h-9 cursor-pointer items-center gap-1 rounded-md px-3 font-medium text-white transition-colors"
              style={{ background: '#cc2200', border: 'none', fontSize: 13 }}
            >
              <Square size={13} fill="currentColor" />
              {t('aiChat.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim()}
              title={t('aiChat.send')}
              className="flex h-9 cursor-pointer items-center gap-1 rounded-md px-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)', border: 'none', fontSize: 13 }}
            >
              <Send size={13} />
              {t('aiChat.send')}
            </button>
          )}
        </div>
        <div className="mt-1 text-[var(--hint)]" style={{ fontSize: 11 }}>
          {t('aiChat.inputHint')}
        </div>
      </div>
    </div>
  )
}
