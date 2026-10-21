/**
 * The "Error event" fields of the SSE Stream row (`MockSseOptions.tsx`,
 * issue #222) — the SSE twin of `MockLlmStreamError`, built from the same
 * field parts and written through the row's `write`.
 *
 * Off = no `errorEvent` key (a config that never used it stays
 * byte-identical). On: after N events written on the connection — or when
 * the list runs out first — one `event: error` with the data (a template)
 * goes out and the stream closes (`src/main/mock/stream/sse-writer.ts`).
 */
import { useId } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useNumberDraft } from '../../lib/number-draft'
import {
  SSE_ERROR_DATA_MAX_CHARS,
  SSE_ERROR_EVENT_DEFAULT,
  STREAM_ERROR_MAX_AFTER,
  type MockSseErrorEvent as ErrorEvent,
  type MockSseStreamConfig,
} from '../../../shared/mock-stream'
import type { ConfigPatch } from './use-config-writer'
import { OptionCheck, OptionNumber, OptionReason, OptionText } from './MockOptionFields'

export default function MockSseErrorEvent({
  cfg,
  write,
}: {
  cfg: MockSseStreamConfig
  write: (patch: ConfigPatch<MockSseStreamConfig>) => Promise<void>
}) {
  const { t } = useTranslation()
  const hintId = useId()
  const ev = cfg.errorEvent
  const patch = (over: Partial<ErrorEvent>): void =>
    void write((b) => ({ errorEvent: { ...(b.errorEvent ?? SSE_ERROR_EVENT_DEFAULT), ...over } }))

  const afterDraft = useNumberDraft({
    value: ev?.afterEvents ?? SSE_ERROR_EVENT_DEFAULT.afterEvents,
    min: 0,
    max: STREAM_ERROR_MAX_AFTER,
    onChange: (v) => patch({ afterEvents: v }),
  })

  return (
    <div className="mt-2" data-testid="mock-sse-error-event">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <OptionCheck
          label={t('mockSse.errorEvent')}
          testId="mock-sse-error-event-on"
          checked={ev !== undefined}
          onChange={(on) =>
            void write({ errorEvent: on ? { ...SSE_ERROR_EVENT_DEFAULT } : undefined })
          }
        />
        {ev && (
          <>
            <OptionNumber
              label={t('mockSse.errorEventAfter')}
              testId="mock-sse-error-event-after"
              draft={afterDraft}
            />
            <OptionText
              label={t('mockSse.errorEventData')}
              testId="mock-sse-error-event-data"
              value={ev.data}
              maxLength={SSE_ERROR_DATA_MAX_CHARS}
              width="18rem"
              grow
              mono
              onCommit={(data) => patch({ data })}
            />
          </>
        )}
      </div>
      {ev && (
        <OptionReason id={hintId} testId="mock-sse-error-event-hint">
          {t('mockSse.errorEventHint')}
        </OptionReason>
      )}
    </div>
  )
}
