import { useState, type ReactElement } from 'react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import { useTranslation } from '../../../lib/i18n'
import { parseMaxTokensInput, parseTemperatureInput } from '../../../lib/ai-chat-config'
import { AI_MAX_TOKENS_CAP } from '../../../../shared/ai-limits'

/**
 * Number field that commits only valid values to the store; '' = provider
 * default (null). Invalid text stays visible (red border) but is not applied.
 */
function NumberSetting({
  label,
  hint,
  value,
  parse,
  onCommit,
  step,
  min,
  max,
  testId,
}: {
  label: string
  hint: string
  value: number | null
  parse: (text: string) => number | null | undefined
  onCommit: (v: number | null) => void
  step: string
  min: number
  max?: number
  testId: string
}): ReactElement {
  const { t } = useTranslation()
  const [text, setText] = useState(value == null ? '' : String(value))
  // A store change from elsewhere (restore, tab switch) wins over the draft —
  // React's "adjust state when a prop changes" pattern, no effect needed.
  const [seenValue, setSeenValue] = useState(value)
  if (seenValue !== value) {
    setSeenValue(value)
    if (parse(text) !== value) setText(value == null ? '' : String(value))
  }
  const invalid = parse(text) === undefined

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        placeholder={t('aiChat.providerDefault')}
        data-testid={testId}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = parse(e.target.value)
          if (parsed !== undefined) onCommit(parsed)
        }}
        className={`rounded-md border bg-[var(--white)] px-2 py-1.5 font-mono text-[var(--text)] outline-none focus:border-[var(--accent)] ${
          invalid ? 'border-[var(--red)]' : 'border-[var(--border)]'
        }`}
        style={{ fontSize: 13 }}
      />
      <span
        className={invalid ? 'text-[var(--red)]' : 'text-[var(--hint)]'}
        style={{ fontSize: 11 }}
      >
        {invalid ? t('aiChat.invalidNumber') : hint}
      </span>
    </label>
  )
}

/**
 * Generation settings of the AI Chat request (issue #189): temperature and
 * max tokens, saved with the request. Empty = provider default.
 */
export default function AiChatParameters(): ReactElement {
  const { t } = useTranslation()
  const temperature = useAiChatStore((s) => s.temperature)
  const maxTokens = useAiChatStore((s) => s.maxTokens)
  const setTemperature = useAiChatStore((s) => s.setTemperature)
  const setMaxTokens = useAiChatStore((s) => s.setMaxTokens)

  return (
    <div
      className="grid gap-3"
      style={{ gridColumn: '1 / -1', gridTemplateColumns: '1fr 1fr' }}
      data-testid="ai-chat-parameters"
    >
      <NumberSetting
        label={t('aiChat.temperature')}
        hint={t('aiChat.temperatureHint')}
        value={temperature ?? null}
        parse={parseTemperatureInput}
        onCommit={setTemperature}
        step="0.1"
        min={0}
        max={2}
        testId="ai-temperature"
      />
      <NumberSetting
        label={t('aiChat.maxTokens')}
        hint={t('aiChat.maxTokensHint')}
        value={maxTokens ?? null}
        parse={parseMaxTokensInput}
        onCommit={setMaxTokens}
        step="1"
        min={1}
        max={AI_MAX_TOKENS_CAP}
        testId="ai-max-tokens"
      />
    </div>
  )
}
