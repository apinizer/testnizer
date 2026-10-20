/**
 * The response editor's SSE parts (issue #221, design §6.5.2 / §6.5.4):
 *
 *  - `MockSseOptions` — the "Stream" row shown while the body type is `sse`:
 *    interval, heartbeat, loop, when finished, resume. Same anatomy as the
 *    editor's "Delay (ms) / Enabled" row (label + number box, checkbox
 *    label, plain select). Every change writes the whole normalized config
 *    (a stored value may be partial or carry keys from another build — those
 *    the main process would reject); a rejected value is shown, translated,
 *    in a `role="alert"` line like the condition editor's error.
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

// Copied from the response editor's Delay row / selects (MockServerEditor.tsx) — one look.
const NUMBER_STYLE = { width: 70, background: 'var(--white)', borderColor: 'var(--border)' }
const SELECT_STYLE = { background: 'var(--white)', borderColor: 'var(--border)' }

export default function MockSseOptions({ response }: { response: MockResponse }) {
  const { t } = useTranslation()
  const updateResponse = useMockStore((s) => s.updateResponse)
  const [error, setError] = useState<string | null>(null)
  const reasonId = useId()
  const cfg = normalizeStreamConfig(response.streamConfig)

  async function write(patch: Partial<MockSseStreamConfig>): Promise<void> {
    const err = await updateResponse(response.id, { streamConfig: { ...cfg, ...patch } })
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
      <label
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {t('mockSse.stream')}
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label style={{ color: 'var(--muted)' }}>
          {t('mockSse.interval')}:
          <input
            type="number"
            data-testid="mock-stream-interval"
            {...intervalDraft.inputProps}
            className="ml-1 rounded border px-2 py-1"
            style={NUMBER_STYLE}
          />
        </label>
        <label style={{ color: 'var(--muted)' }}>
          {t('mockSse.heartbeat')}:
          <input
            type="number"
            data-testid="mock-stream-heartbeat"
            {...heartbeatDraft.inputProps}
            className="ml-1 rounded border px-2 py-1"
            style={NUMBER_STYLE}
          />
        </label>
        <label
          className="flex cursor-pointer items-center gap-1.5"
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
        <label className="flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
          {t('mockSse.onEnd')}:
          <select
            data-testid="mock-stream-on-end"
            value={cfg.onEnd}
            onChange={(e) => void write({ onEnd: e.target.value as MockSseEndBehaviour })}
            className="rounded border px-2 py-1"
            style={SELECT_STYLE}
          >
            <option value="close">{t('mockSse.onEndClose')}</option>
            <option value="keep-open">{t('mockSse.onEndKeepOpen')}</option>
          </select>
        </label>
        <label
          className={`flex items-center gap-1.5 ${resumeOff ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
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
        <div
          id={reasonId}
          data-testid="mock-sse-resume-reason"
          className="mt-1 text-[11px]"
          style={{ color: 'var(--muted)' }}
        >
          {resumeOff}
        </div>
      )}
      {error && (
        <div
          data-testid="mock-sse-error"
          role="alert"
          className="mt-1 text-xs"
          style={{ color: 'var(--red)' }}
        >
          {error}
        </div>
      )}
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
