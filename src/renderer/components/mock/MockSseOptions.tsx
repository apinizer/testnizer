/**
 * The response editor's SSE parts (issue #221, design §6.5.2 / §6.5.4):
 *
 *  - `MockSseOptions` — the "Stream" row shown while the body type is `sse`:
 *    interval, heartbeat, loop, when finished, resume, and the mid-stream
 *    error event (`MockSseErrorEvent`, issue #222). Same anatomy as the
 *    editor's "Delay (ms) / Enabled" row (label + number box, checkbox
 *    label, plain select) — the field parts are shared with the AI "LLM" row
 *    (`MockOptionFields.tsx`). Every change writes the whole normalized config
 *    (a stored value may be partial or carry keys from another build — those
 *    the main process would reject), merged over the last written one while
 *    a save is in flight (`useConfigWriter`: quick changes compose); a
 *    rejected value is shown, translated, in a `role="alert"` line like the
 *    condition editor's error.
 *  - `MockSseBodyNotes` — the hint under the body and the "no events" warning.
 */
import { useId, useState } from 'react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { useNumberDraft } from '../../lib/number-draft'
import type { MockResponse } from '../../types'
import {
  normalizeStreamConfig,
  SSE_MAX_INTERVAL_MS,
  type MockSseEndBehaviour,
  type MockSseStreamConfig,
} from '../../../shared/mock-stream'
import { splitSseBlocks } from '../../../shared/mock-sse-blocks'
import { translateStreamError } from './mock-stream-errors'
import { useConfigWriter, type ConfigPatch } from './use-config-writer'
import MockSseErrorEvent from './MockSseErrorEvent'
import {
  OptionError,
  OptionNumber,
  OptionReason,
  OptionRowTitle,
  OptionSelect,
} from './MockOptionFields'

const ON_END: readonly (readonly [MockSseEndBehaviour, string])[] = [
  ['close', 'mockSse.onEndClose'],
  ['keep-open', 'mockSse.onEndKeepOpen'],
]

export default function MockSseOptions({ response }: { response: MockResponse }) {
  const { t } = useTranslation()
  const updateResponse = useMockStore((s) => s.updateResponse)
  const [error, setError] = useState<string | null>(null)
  const reasonId = useId()
  const cfg = normalizeStreamConfig(response.streamConfig)
  const save = useConfigWriter(cfg, (streamConfig) => updateResponse(response.id, { streamConfig }))

  async function write(patch: ConfigPatch<MockSseStreamConfig>): Promise<void> {
    const err = await save(patch)
    setError(err ? translateStreamError(err) : null)
  }

  const intervalDraft = useNumberDraft({
    value: cfg.intervalMs,
    min: 0,
    max: SSE_MAX_INTERVAL_MS,
    onChange: (v) => void write({ intervalMs: v }),
  })
  const heartbeatDraft = useNumberDraft({
    value: cfg.heartbeatMs,
    min: 0,
    max: SSE_MAX_INTERVAL_MS,
    onChange: (v) => void write({ heartbeatMs: v }),
  })

  const dynamicId = splitSseBlocks(response.body).some((b) => b.dynamicId)
  const resumeOff = cfg.loop
    ? t('mockSse.resumeOffLoop')
    : dynamicId
      ? t('mockSse.resumeOffDynamicId')
      : null

  return (
    <div className="mb-2" data-testid="mock-sse-options">
      <OptionRowTitle>{t('mockSse.stream')}</OptionRowTitle>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <OptionNumber
          label={t('mockSse.interval')}
          testId="mock-stream-interval"
          draft={intervalDraft}
        />
        <OptionNumber
          label={t('mockSse.heartbeat')}
          testId="mock-stream-heartbeat"
          draft={heartbeatDraft}
        />
        <label
          className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
          style={{ color: 'var(--text)' }}
        >
          <input
            type="checkbox"
            data-testid="mock-stream-loop"
            checked={cfg.loop}
            onChange={(e) => void write({ loop: e.target.checked })}
          />
          {t('mockSse.loop')}
        </label>
        <OptionSelect
          label={t('mockSse.onEnd')}
          testId="mock-stream-on-end"
          value={cfg.onEnd}
          options={ON_END}
          onChange={(onEnd) => void write({ onEnd })}
        />
        <label
          className={`flex items-center gap-1.5 whitespace-nowrap ${resumeOff ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          style={{ color: 'var(--text)' }}
          title={resumeOff ?? undefined}
        >
          <input
            type="checkbox"
            data-testid="mock-stream-resume"
            checked={cfg.resume}
            disabled={resumeOff !== null}
            aria-describedby={resumeOff ? reasonId : undefined}
            onChange={(e) => void write({ resume: e.target.checked })}
          />
          {t('mockSse.resume')}
        </label>
      </div>
      {resumeOff && (
        <OptionReason id={reasonId} testId="mock-sse-resume-reason">
          {resumeOff}
        </OptionReason>
      )}
      <MockSseErrorEvent cfg={cfg} write={write} />
      {error && <OptionError testId="mock-sse-error">{error}</OptionError>}
    </div>
  )
}

/** Under the SSE body: the format hint, and a warning when no event would be sent. */
export function MockSseBodyNotes({ body }: { body: string }) {
  const { t } = useTranslation()
  const empty = splitSseBlocks(body).length === 0
  return (
    <>
      {empty && (
        <div
          data-testid="mock-sse-no-events"
          role="status"
          className="mt-1 text-[11px]"
          style={{ color: 'var(--orange)' }}
        >
          {t('mockSse.noEvents')}
        </div>
      )}
      <div
        data-testid="mock-sse-hint"
        className="mt-1 text-[11px]"
        style={{ color: 'var(--muted)' }}
      >
        {t('mockSse.bodyHint')}
      </div>
    </>
  )
}
