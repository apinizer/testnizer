import { useEffect, useRef, type ReactElement, type UIEvent } from 'react'
import { Bot, User } from 'lucide-react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import { useTranslation } from '../../../lib/i18n'
import EmptyState from '../../shared/EmptyState'
import AiChatAssistantTurn from './AiChatAssistantTurn'
import { awaitingUserKey, isPinnedToBottom, scrollTopToReveal } from '../../../lib/ai-chat-view'

/** The conversation: user bubbles and assistant turns (text, tool calls, metrics). */
export default function AiChatConversationView({
  pinnedRef,
}: {
  /** Shared with the prompt box: Send re-pins the view. */
  pinnedRef: { current: boolean }
}): ReactElement {
  const { t } = useTranslation()
  const messages = useAiChatStore((s) => s.messages)
  const errorMessage = useAiChatStore((s) => s.errorMessage)
  const pendingResponseId = useAiChatStore((s) => s.pendingResponseId)
  const ref = useRef<HTMLDivElement>(null)

  // Auto-scroll follows new content only while the user is parked at the
  // bottom. Scrolling up mid-stream used to be pointless — every SSE delta
  // re-ran this effect and yanked the view back down (issue #75).
  useEffect(() => {
    const el = ref.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, pinnedRef])

  // A card that waits for the user (tool approval, stdio trust) is brought
  // into view inside the conversation, pinned or not — never by focusing it
  // and never with `scrollIntoView`, which would also scroll the overflow-hidden
  // ancestors and could push the editor header off screen (issue #228).
  const awaitKey = awaitingUserKey(messages, pendingResponseId)
  useEffect(() => {
    const el = ref.current
    if (!el || !awaitKey) return
    // Only the live turn renders markers; the first one is the part the key names.
    const card = el.querySelector<HTMLElement>('[data-awaiting-user="true"]')
    if (!card) return
    const next = scrollTopToReveal(
      el.getBoundingClientRect(),
      card.getBoundingClientRect(),
      el.scrollTop,
    )
    if (next !== el.scrollTop) el.scrollTop = next
  }, [awaitKey])

  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    pinnedRef.current = isPinnedToBottom(e.currentTarget)
  }
  const last = messages[messages.length - 1]
  // The failed turn already shows its error — no second banner for it.
  const showBanner = !!errorMessage && !(last?.role === 'assistant' && last.error === errorMessage)

  return (
    <div
      ref={ref}
      data-testid="ai-conversation"
      onScroll={onScroll}
      data-awaiting-user-key={awaitKey ?? undefined}
      className="min-h-0 flex-1 overflow-y-auto p-3.5"
    >
      {messages.length === 0 && !errorMessage ? (
        <EmptyState
          icon={Bot}
          title={t('aiChat.emptyTitle')}
          description={t('aiChat.emptyHint')}
          size="lg"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div
                  className="flex max-w-[80%] items-start gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--accent-light)',
                    border: '1px solid var(--accent)',
                    color: 'var(--text)',
                  }}
                >
                  <div
                    data-testid="ai-bubble-text"
                    className="flex-1 cursor-text select-text"
                    style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}
                  >
                    {m.content}
                  </div>
                  <User
                    size={14}
                    className="select-none"
                    style={{ color: 'var(--accent-text)', marginTop: 2 }}
                  />
                </div>
              </div>
            ) : (
              <AiChatAssistantTurn key={m.id} turn={m} streaming={pendingResponseId === m.id} />
            ),
          )}
          {showBanner && (
            <div
              className="rounded-md border px-3 py-2"
              style={{
                background: '#fff0f0',
                borderColor: '#f5b3b3',
                color: '#cc2200',
                fontSize: 12.5,
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
