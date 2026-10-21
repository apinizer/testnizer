/**
 * The response editor's AI-reply parts (issue #221, design §6.5.2 / §6.5.4)
 * — the `llm` twin of `MockSseOptions.tsx`, with the same anatomy:
 *
 *  - `MockLlmOptions` — the "LLM" row shown while the body type is `llm`:
 *    provider, chunking (+ chunk size for `fixed`), chunk interval, stop
 *    reason (each provider's own values, issue #222; + the stop sequence
 *    for Anthropic `stop_sequence`), usage, the tool calls
 *    (`MockLlmToolCalls`) and the mid-stream error (`MockLlmStreamError`). Built from the Stream row's field parts
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
  LLM_DEFAULT_CHUNK_SIZE,
  LLM_DEFAULT_STOP_SEQUENCE,
  LLM_MAX_CHUNK_CHARS,
  LLM_MAX_CHUNK_INTERVAL_MS,
  LLM_MAX_STOP_SEQUENCE_CHARS,
  LLM_MAX_USAGE_TOKENS,
  llmConfigForEdit,
  stopReasonFor,
  type MockLlmChunking,
  type MockLlmConfig,
  type MockLlmProvider,
  type MockLlmStopReason,
} from '../../../shared/mock-stream'
import { translateStreamError } from './mock-stream-errors'
import { useConfigWriter, type ConfigPatch } from './use-config-writer'
import MockLlmToolCalls from './MockLlmToolCalls'
import MockLlmStreamError from './MockLlmStreamError'
import {
  OptionError,
  OptionNumber,
  OptionReason,
  OptionRowTitle,
  OptionSelect,
  OptionText,
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
  ['fixed', 'mockLlm.chunkFixed'],
  ['whole', 'mockLlm.chunkWhole'],
]
/** Each provider's stop reasons, labelled with its own wire value (`LLM_PROVIDER_STOP_REASONS`). */
const STOP_REASONS: Record<MockLlmProvider, readonly (readonly [MockLlmStopReason, string])[]> = {
  openai: [
    ['stop', 'mockLlm.stopOpenai.stop'],
    ['length', 'mockLlm.stopOpenai.length'],
    ['content_filter', 'mockLlm.stopOpenai.contentFilter'],
    ['tool_calls', 'mockLlm.stopOpenai.toolCalls'],
  ],
  anthropic: [
    ['stop', 'mockLlm.stopAnthropic.endTurn'],
    ['length', 'mockLlm.stopAnthropic.maxTokens'],
    ['stop_sequence', 'mockLlm.stopAnthropic.stopSequence'],
    ['content_filter', 'mockLlm.stopAnthropic.refusal'],
    ['tool_calls', 'mockLlm.stopAnthropic.toolUse'],
  ],
}
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

  const sizeDraft = useNumberDraft({
    value: cfg.chunkSize ?? LLM_DEFAULT_CHUNK_SIZE,
    min: 1,
    max: LLM_MAX_CHUNK_CHARS,
    onChange: (v) => void write({ chunkSize: v }),
  })
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
  const stopReason = hasCalls ? 'tool_calls' : stopReasonFor(cfg.provider, cfg.stopReason)

  return (
    <div className="mb-2" data-testid="mock-llm-options">
      <OptionRowTitle>{t('mockLlm.title')}</OptionRowTitle>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <OptionSelect
          label={t('mockLlm.provider')}
          testId="mock-llm-provider"
          value={cfg.provider}
          options={PROVIDERS}
          // The stop reason follows: a value the new provider cannot say is
          // rewritten to the one it is sent as (stop_sequence → stop on OpenAI).
          onChange={(provider) =>
            void write((b) => ({ provider, stopReason: stopReasonFor(provider, b.stopReason) }))
          }
        />
        <OptionSelect
          label={t('mockLlm.chunking')}
          testId="mock-llm-chunking"
          value={cfg.chunking}
          options={CHUNKINGS}
          onChange={(chunking) => void write({ chunking })}
        />
        {cfg.chunking === 'fixed' && (
          <OptionNumber
            label={t('mockLlm.chunkSize')}
            testId="mock-llm-chunk-size"
            draft={sizeDraft}
          />
        )}
        <OptionNumber
          label={t('mockLlm.chunkInterval')}
          testId="mock-llm-interval"
          draft={intervalDraft}
        />
        <OptionSelect
          label={t('mockLlm.stopReason')}
          testId="mock-llm-stop-reason"
          value={stopReason}
          options={STOP_REASONS[cfg.provider]}
          onChange={(next) => void write({ stopReason: next })}
          disabled={hasCalls}
          describedBy={hasCalls ? reasonId : undefined}
        />
        {cfg.provider === 'anthropic' && stopReason === 'stop_sequence' && (
          <OptionText
            label={t('mockLlm.stopSequence')}
            testId="mock-llm-stop-sequence"
            value={cfg.stopSequence ?? ''}
            placeholder={LLM_DEFAULT_STOP_SEQUENCE}
            maxLength={LLM_MAX_STOP_SEQUENCE_CHARS}
            width="8rem"
            mono
            // Empty = the default sequence (the key is then left out).
            onCommit={(v) => void write({ stopSequence: v === '' ? undefined : v })}
          />
        )}
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
          <OptionNumber
            label={t('mockLlm.usageIn')}
            testId="mock-llm-usage-in"
            draft={inDraft}
            wide
          />
        )}
        {usage && (
          <OptionNumber
            label={t('mockLlm.usageOut')}
            testId="mock-llm-usage-out"
            draft={outDraft}
            wide
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
      <MockLlmStreamError cfg={cfg} write={write} />
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
