import type { ReactElement } from 'react'
import { AlertTriangle, Bot, Info } from 'lucide-react'
import type {
  AiAssistantTurn,
  AiNoticePart,
  AiToolResultPart,
} from '../../../../shared/ai-chat-types'
import { answerStdioTrust } from '../../../stores/ai-chat-tools'
import { useTranslation } from '../../../lib/i18n'
import MarkdownText from './AiMarkdown'
import AiChatToolCallCard from './AiChatToolCallCard'
import AiChatTrustCard from './AiChatTrustCard'
import AiChatMetricsRow from './AiChatMetricsRow'

function Notice({ part, live }: { part: AiNoticePart; live: boolean }): ReactElement {
  const { t } = useTranslation()
  if (part.kind === 'stdio-untrusted') {
    const serverId = part.serverId ?? ''
    return (
      <AiChatTrustCard
        commandLine={part.commandLine ?? ''}
        envNames={part.envNames ?? []}
        {...(part.env ? { env: part.env } : {})}
        status={live ? part.status : part.status === 'pending' ? 'skipped' : part.status}
        onTrust={() => void answerStdioTrust(serverId, 'trust')}
        onSkip={() => void answerStdioTrust(serverId, 'skip')}
      />
    )
  }
  const isCap = part.kind === 'loop-cap'
  return (
    <div
      role="note"
      data-testid={isCap ? 'ai-loop-cap-note' : 'ai-server-error'}
      className="flex items-start gap-1.5"
      style={{ fontSize: 12, color: isCap ? 'var(--orange)' : 'var(--red)' }}
    >
      {isCap ? (
        <Info size={12} className="mt-0.5" />
      ) : (
        <AlertTriangle size={12} className="mt-0.5" />
      )}
      <span>
        {isCap
          ? t('aiChat.loopCap')
          : `${part.server ? `${part.server}: ` : ''}${part.message ?? t('aiChat.serverFailed')}`}
      </span>
    </div>
  )
}

/** An assistant turn: text, tool calls (with results), notices, metrics. */
export default function AiChatAssistantTurn({
  turn,
  streaming,
}: {
  turn: AiAssistantTurn
  /** This turn is the one being streamed right now. */
  streaming: boolean
}): ReactElement {
  const { t } = useTranslation()
  const parts = turn.parts && turn.parts.length > 0 ? turn.parts : null
  const results = new Map<string, AiToolResultPart>()
  for (const p of parts ?? []) if (p.type === 'tool_result') results.set(p.callId, p)

  return (
    <div className="flex justify-start">
      <div
        className="flex max-w-[85%] items-start gap-2 rounded-lg px-3 py-2"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
        }}
      >
        <Bot
          size={14}
          className="select-none"
          style={{ color: 'var(--accent-text)', marginTop: 2 }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2" style={{ fontSize: 13 }}>
          <div data-testid="ai-bubble-text" className="flex cursor-text select-text flex-col gap-2">
            {parts ? (
              parts.map((p, i) => {
                if (p.type === 'text') return p.text ? <MarkdownText key={i} text={p.text} /> : null
                if (p.type === 'tool_call') {
                  return (
                    <AiChatToolCallCard
                      key={`c-${p.id}`}
                      call={p}
                      result={results.get(p.id)}
                      live={streaming}
                    />
                  )
                }
                if (p.type === 'notice')
                  return <Notice key={`n-${p.id}`} part={p} live={streaming} />
                return null
              })
            ) : turn.content ? (
              <MarkdownText text={turn.content} />
            ) : null}
            {streaming && (
              <span
                className="ml-0.5 inline-block animate-pulse"
                style={{ width: 8, height: 14, background: 'var(--accent)', borderRadius: 1 }}
              />
            )}
          </div>
          {turn.truncated && (
            <div
              data-testid="ai-truncated-note"
              role="note"
              className="flex items-center gap-1.5 text-[var(--orange)]"
              style={{ fontSize: 12 }}
            >
              <AlertTriangle size={12} />
              {t('aiChat.truncated')}
            </div>
          )}
          {turn.error && !streaming && (
            <div className="text-[var(--red)]" style={{ fontSize: 12 }} data-testid="ai-turn-error">
              {turn.error}
            </div>
          )}
          {!streaming && <AiChatMetricsRow metrics={turn.metrics} timestamp={turn.timestamp} />}
        </div>
      </div>
    </div>
  )
}
