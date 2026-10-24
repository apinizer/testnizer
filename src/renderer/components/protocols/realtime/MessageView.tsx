import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { viewText, type MessageViewMode } from '../../../lib/realtime-format'

const TEXT_MODES: readonly MessageViewMode[] = ['text', 'json', 'xml', 'html']
const MODE_KEYS: Record<MessageViewMode, string> = {
  text: 'rt.format.text',
  json: 'rt.format.json',
  xml: 'rt.format.xml',
  html: 'rt.format.html',
  hexdump: 'rt.view.hexdump',
}

/**
 * An expanded log message (issues #282 / #283): view as Text / JSON / XML /
 * HTML, or — for a binary payload (base64 content) — Hexdump / Text, plus a
 * Wrap toggle. Postman's expanded-message controls; shared by the WebSocket
 * log and the Socket.IO timeline.
 */
export default function MessageView({
  content,
  binary,
  initialMode,
  testIdPrefix,
}: {
  content: string
  binary: boolean
  initialMode: MessageViewMode
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<MessageViewMode>(initialMode)
  const [wrap, setWrap] = useState(true)
  const modes: readonly MessageViewMode[] = binary ? ['hexdump', 'text'] : TEXT_MODES
  return (
    <div
      className="mt-1.5 rounded-lg bg-[var(--surface)] p-2"
      data-testid={`${testIdPrefix}-message-view`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1" role="group">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-testid={`${testIdPrefix}-view-${m}`}
            onClick={() => setMode(m)}
            className={`cursor-pointer rounded border px-1.5 py-0.5 text-[11px] ${
              mode === m
                ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent-text)]'
                : 'border-[var(--border)] bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t(MODE_KEYS[m])}
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
            data-testid={`${testIdPrefix}-view-wrap`}
            className="accent-[var(--accent)]"
          />
          {t('rt.view.wrap')}
        </label>
      </div>
      <pre
        data-testid={`${testIdPrefix}-view-body`}
        className={`m-0 max-h-60 overflow-auto font-mono text-[var(--text)] ${
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        }`}
      >
        {viewText(content, binary, binary && mode !== 'hexdump' ? 'text' : mode)}
      </pre>
    </div>
  )
}
