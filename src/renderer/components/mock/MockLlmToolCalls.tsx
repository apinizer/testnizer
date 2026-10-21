/**
 * The "Tool calls" field of the LLM row (`MockLlmOptions.tsx`, issue #221,
 * design §6.5.4): a JSON list in a textarea, committed on blur — the
 * condition editor's pattern (`MockServerEditor.tsx` ResponseEditor): local
 * text, reset when the stored value changes (derived during render, not in
 * an effect); text that is not JSON, or
 * not a list, is shown as a red line and NOT saved. Field-level checks (a
 * name, the argument size, …) stay with the main process, whose message the
 * row shows translated.
 */
import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { MockLlmToolCall } from '../../../shared/mock-stream'

interface Draft {
  /** The stored text this draft was typed over — a new stored value resets it. */
  base: string
  text: string
  error: string | null
}

export default function MockLlmToolCalls({
  toolCalls,
  onCommit,
}: {
  toolCalls: MockLlmToolCall[]
  onCommit: (toolCalls: MockLlmToolCall[]) => void
}) {
  const { t } = useTranslation()
  const stored = toolCalls.length > 0 ? JSON.stringify(toolCalls, null, 2) : ''
  const [state, setState] = useState<Draft>({ base: stored, text: stored, error: null })
  const draft: Draft = state.base === stored ? state : { base: stored, text: stored, error: null }
  const { text, error } = draft
  const setText = (next: string): void => setState({ ...draft, text: next })
  const setError = (next: string | null): void => setState({ ...draft, error: next })

  function commit(): void {
    if (text === stored) {
      setError(null)
      return
    }
    let parsed: unknown
    try {
      parsed = text.trim() === '' ? [] : JSON.parse(text)
    } catch (e) {
      setError(`${t('mockLlm.toolCallsBadJson')}: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (!Array.isArray(parsed)) {
      setError(t('mockLlm.toolCallsNotList'))
      return
    }
    setError(null)
    onCommit(parsed as MockLlmToolCall[])
  }

  return (
    <div className="mt-2">
      <label
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {t('mockLlm.toolCalls')}
      </label>
      <textarea
        data-testid="mock-llm-tool-calls"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={4}
        placeholder='[{"name": "echo", "arguments": {"text": "hello"}}]'
        className="w-full rounded border px-2 py-1 font-mono text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      />
      {error && (
        <div
          data-testid="mock-llm-tool-calls-error"
          role="alert"
          className="mt-1 text-xs"
          style={{ color: 'var(--red)' }}
        >
          {error}
        </div>
      )}
      <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('mockLlm.toolCallsHint')}
      </div>
    </div>
  )
}
