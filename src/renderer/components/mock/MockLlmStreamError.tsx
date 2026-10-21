/**
 * The "Mid-stream error" fields of the LLM row (`MockLlmOptions.tsx`, issue
 * #222) — split out like `MockLlmToolCalls`, built from the same field parts
 * (`MockOptionFields.tsx`) and written through the row's `write` (the
 * row's `useConfigWriter`, so quick changes compose).
 *
 * Off = no `streamError` key at all (a config that never used it stays
 * byte-identical). On: after N chunks of output the provider's own error
 * event goes out and the stream closes (`src/main/mock/stream/llm.ts`
 * `encodeLlmStream`). An empty type / message means the provider's default,
 * shown as the placeholder.
 */
import { useId } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useNumberDraft } from '../../lib/number-draft'
import {
  LLM_MAX_ERROR_MESSAGE_CHARS,
  LLM_MAX_ERROR_TYPE_CHARS,
  LLM_STREAM_ERROR_DEFAULTS,
  STREAM_ERROR_MAX_AFTER,
  type MockLlmConfig,
  type MockLlmStreamError,
} from '../../../shared/mock-stream'
import type { ConfigPatch } from './use-config-writer'
import { OptionCheck, OptionNumber, OptionReason, OptionText } from './MockOptionFields'

/** What turning the error on writes: after 3 chunks, the provider's default error. */
const NEW_ERROR: MockLlmStreamError = { afterChunks: 3 }

export default function MockLlmStreamError({
  cfg,
  write,
}: {
  cfg: MockLlmConfig
  write: (patch: ConfigPatch<MockLlmConfig>) => Promise<void>
}) {
  const { t } = useTranslation()
  const hintId = useId()
  const err = cfg.streamError
  const defaults = LLM_STREAM_ERROR_DEFAULTS[cfg.provider]
  // Field edits merge over the LATEST error (the writer's base), not this render's.
  const patch = (over: Partial<MockLlmStreamError>): void =>
    void write((b) => ({ streamError: { ...(b.streamError ?? NEW_ERROR), ...over } }))

  const afterDraft = useNumberDraft({
    value: err?.afterChunks ?? NEW_ERROR.afterChunks,
    min: 0,
    max: STREAM_ERROR_MAX_AFTER,
    onChange: (v) => patch({ afterChunks: v }),
  })

  return (
    <div className="mt-2" data-testid="mock-llm-stream-error">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <OptionCheck
          label={t('mockLlm.streamError')}
          testId="mock-llm-stream-error-on"
          checked={err !== undefined}
          onChange={(on) => void write({ streamError: on ? { ...NEW_ERROR } : undefined })}
        />
        {err && (
          <>
            <OptionNumber
              label={t('mockLlm.streamErrorAfter')}
              testId="mock-llm-stream-error-after"
              draft={afterDraft}
            />
            <OptionText
              label={t('mockLlm.streamErrorType')}
              testId="mock-llm-stream-error-type"
              value={err.type ?? ''}
              placeholder={defaults.type}
              maxLength={LLM_MAX_ERROR_TYPE_CHARS}
              width="10rem"
              mono
              onCommit={(v) => patch({ type: v === '' ? undefined : v })}
            />
            <OptionText
              label={t('mockLlm.streamErrorMessage')}
              testId="mock-llm-stream-error-message"
              value={err.message ?? ''}
              placeholder={defaults.message}
              maxLength={LLM_MAX_ERROR_MESSAGE_CHARS}
              width="16rem"
              onCommit={(v) => patch({ message: v === '' ? undefined : v })}
            />
          </>
        )}
      </div>
      {err && (
        <OptionReason id={hintId} testId="mock-llm-stream-error-hint">
          {cfg.provider === 'anthropic'
            ? t('mockLlm.streamErrorHintAnthropic')
            : t('mockLlm.streamErrorHintOpenai')}
        </OptionReason>
      )}
    </div>
  )
}
