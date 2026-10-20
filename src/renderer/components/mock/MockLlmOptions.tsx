/**
 * The response editor's AI-reply parts (issue #221, design §6.5.2 / §6.5.4)
 * — the `llm` twin of `MockSseOptions.tsx`, with the same anatomy:
 *
 *  - `MockLlmOptions` — the "LLM" row shown while the body type is `llm`:
 *    provider, chunking, chunk interval, stop reason, usage, and the tool
 *    calls (`MockLlmToolCalls`). Built from the Stream row's field parts
 *    (`MockOptionFields.tsx`), with its disabled-with-reason pattern. Every
 *    change writes the whole config, merged over the last written one while
 *    a save is in flight (`useConfigWriter`); the stored tool-call list is
 *    kept as stored (`llmConfigForEdit` — an invalid call is shown, never
 *    dropped by an unrelated edit); a rejected value is shown, translated,
 *    in a `role="alert"` line.
 *  - `MockLlmBodyNotes` — the hint under the body (and the Anthropic key note).
 */
import { useId, useState } from 'react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { useNumberDraft } from '../../lib/number-draft'
import type { MockResponse } from '../../types'
import {
  LLM_MAX_CHUNK_INTERVAL_MS,
  LLM_MAX_USAGE_TOKENS,
  llmConfigForEdit,
  type MockLlmChunking,
  type MockLlmConfig,
  type MockLlmProvider,
  type MockLlmStopReason,
} from '../../../shared/mock-stream'
import { translateStreamError } from './mock-stream-errors'
import { useConfigWriter, type ConfigPatch } from './use-config-writer'
import MockLlmToolCalls from './MockLlmToolCalls'
import {
  OptionError,
  OptionNumber,
  OptionReason,
  OptionRowTitle,
  OptionSelect,
} from './MockOptionFields'

/** Select options: value → i18n key (literal for the key-coverage test). */
const PROVIDERS: readonly (readonly [MockLlmProvider, string])[] = [
  ['openai', 'mockLlm.providerOpenai'],
  ['anthropic', 'mockLlm.providerAnthropic'],
]
const CHUNKINGS: readonly (readonly [MockLlmChunking, string])[] = [
  ['word', 'mockLlm.chunkWord'],
  ['char', 'mockLlm.chunkChar'],
  ['sentence', 'mockLlm.chunkSentence'],
]
const STOP_REASONS: readonly (readonly [MockLlmStopReason, string])[] = [
  ['stop', 'mockLlm.stopStop'],
  ['length', 'mockLlm.stopLength'],
  ['tool_calls', 'mockLlm.stopToolCalls'],
]
const USAGE_MODES: readonly (readonly ['auto' | 'custom', string])[] = [
  ['auto', 'mockLlm.usageAuto'],
  ['custom', 'mockLlm.usageCustom'],
]

export default function MockLlmOptions({ response }: { response: MockResponse }) {
  const { t } = useTranslation()
  const updateResponse = useMockStore((s) => s.updateResponse)
  const [error, setError] = useState<string | null>(null)
  const reasonId = useId()
  const cfg = llmConfigForEdit(response.streamConfig)
  const usage = cfg.usage === 'auto' ? null : cfg.usage
  const save = useConfigWriter(cfg, (streamConfig) => updateResponse(response.id, { streamConfig }))

  async function write(patch: ConfigPatch<MockLlmConfig>): Promise<void> {
    const err = await save(patch)
    setError(err ? translateStreamError(err) : null)
  }
  const usageOf = (c: MockLlmConfig) =>
    c.usage === 'auto' ? { inputTokens: 0, outputTokens: 0 } : c.usage

  const intervalDraft = useNumberDraft({
    value: cfg.chunkIntervalMs,
    min: 0,
    max: LLM_MAX_CHUNK_INTERVAL_MS,
    onChange: (v) => void write({ chunkIntervalMs: v }),
  })
  const inDraft = useNumberDraft({
    value: usage?.inputTokens ?? 0,
    min: 0,
    max: LLM_MAX_USAGE_TOKENS,
    onChange: (v) => void write((b) => ({ usage: { ...usageOf(b), inputTokens: v } })),
  })
  const outDraft = useNumberDraft({
    value: usage?.outputTokens ?? 0,
    min: 0,
    max: LLM_MAX_USAGE_TOKENS,
    onChange: (v) => void write((b) => ({ usage: { ...usageOf(b), outputTokens: v } })),
  })

  // The engine always stops with tool_calls when there are tool calls.
  const hasCalls = cfg.toolCalls.length > 0

  return (
    <div className="mb-2" data-testid="mock-llm-options">
      <OptionRowTitle>{t('mockLlm.title')}</OptionRowTitle>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <OptionSelect
          label={t('mockLlm.provider')}
          testId="mock-llm-provider"
          value={cfg.provider}
          options={PROVIDERS}
          onChange={(provider) => void write({ provider })}
        />
        <OptionSelect
          label={t('mockLlm.chunking')}
          testId="mock-llm-chunking"
          value={cfg.chunking}
          options={CHUNKINGS}
          onChange={(chunking) => void write({ chunking })}
        />
        <OptionNumber
          label={t('mockLlm.chunkInterval')}
          testId="mock-llm-interval"
          draft={intervalDraft}
        />
        <OptionSelect
          label={t('mockLlm.stopReason')}
          testId="mock-llm-stop-reason"
          value={hasCalls ? 'tool_calls' : cfg.stopReason}
          options={STOP_REASONS}
          onChange={(stopReason) => void write({ stopReason })}
          disabled={hasCalls}
          describedBy={hasCalls ? reasonId : undefined}
        />
        <OptionSelect
          label={t('mockLlm.usage')}
          testId="mock-llm-usage"
          value={usage ? 'custom' : 'auto'}
          options={USAGE_MODES}
          onChange={(mode) =>
            void write({ usage: mode === 'auto' ? 'auto' : { inputTokens: 0, outputTokens: 0 } })
          }
        />
        {usage && (
          <OptionNumber label={t('mockLlm.usageIn')} testId="mock-llm-usage-in" draft={inDraft} />
        )}
        {usage && (
          <OptionNumber
            label={t('mockLlm.usageOut')}
            testId="mock-llm-usage-out"
            draft={outDraft}
          />
        )}
      </div>
      {hasCalls && (
        <OptionReason id={reasonId} testId="mock-llm-stop-reason-reason">
          {t('mockLlm.stopReasonToolCalls')}
        </OptionReason>
      )}
      <MockLlmToolCalls
        toolCalls={cfg.toolCalls}
        onCommit={(toolCalls) =>
          void write((b) => ({
            toolCalls,
            // Keep the stored reason honest: tool_calls exactly while there are calls.
            stopReason:
              toolCalls.length > 0
                ? 'tool_calls'
                : b.stopReason === 'tool_calls'
                  ? 'stop'
                  : b.stopReason,
          }))
        }
      />
      {error && <OptionError testId="mock-llm-error">{error}</OptionError>}
    </div>
  )
}

/** Under the AI reply body: what the body is, the template names, and the Anthropic key note. */
export function MockLlmBodyNotes({ provider }: { provider: MockLlmProvider }) {
  const { t } = useTranslation()
  return (
    <>
      {provider === 'anthropic' && (
        <div
          data-testid="mock-llm-anthropic-hint"
          role="note"
          className="mt-1 text-[11px]"
          style={{ color: 'var(--orange)' }}
        >
          {t('mock.anthropicKeyHint')}
        </div>
      )}
      <div
        data-testid="mock-llm-hint"
        className="mt-1 text-[11px]"
        style={{ color: 'var(--muted)' }}
      >
        {t('mockLlm.bodyHint')}
      </div>
    </>
  )
}
