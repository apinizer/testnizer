import { useMemo, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { testIdSlug } from '../../../lib/mcp-store-helpers'
import {
  buildInputResponses,
  initialValues,
  type ElicitValues,
  type InputRequestView,
} from '../../../lib/mcp-elicitation'
import type { McpElicitAnswer } from '../../../types/mcp'
import McpElicitField from './McpElicitField'
import { PROBLEM_KEYS } from './call-ui'
import { ErrorLine, GhostButton, JsonPre, PrimaryButton } from './ui'

function UnsupportedRequest({
  view,
}: {
  view: Extract<InputRequestView, { kind: 'unsupported' }>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <span className="font-mono text-[var(--text)]">
        {view.method}
        {view.deprecated && (
          <span className="ml-1 text-[11px] text-[var(--orange)]">{t('mcp.deprecated2026')}</span>
        )}
      </span>
      {view.message && <span className="text-[var(--text)]">{view.message}</span>}
      <span className="text-[11px] text-[var(--hint)]">{t('mcp.input.unsupportedRequest')}</span>
    </div>
  )
}

/**
 * The body shared by both input cards — the 2026-07-28 `input_required` card
 * (issue #152) and the 2025-era elicitation card (issue #168): one form per
 * request, a live "Will send" preview (review before send), and the three
 * answers the spec requires — accept / decline / cancel.
 */
export default function McpInputForm({
  views,
  busy,
  error,
  acceptLabel,
  previewOpen = false,
  onSend,
}: {
  views: InputRequestView[]
  busy: boolean
  error?: string
  acceptLabel: string
  previewOpen?: boolean
  onSend: (action: McpElicitAnswer['action'], responses: Record<string, McpElicitAnswer>) => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, ElicitValues>>(() =>
    Object.fromEntries(views.map((v) => [v.key, v.kind === 'form' ? initialValues(v.fields) : {}])),
  )
  const [problem, setProblem] = useState<{ key: string; field: string; text: string } | null>(null)
  const preview = useMemo(() => buildInputResponses(views, 'accept', values), [views, values])

  const send = (action: McpElicitAnswer['action']): void => {
    const built = buildInputResponses(views, action, values)
    if (built.problem) {
      const p = built.problem
      const text = t(PROBLEM_KEYS[p.reason])
        .replace('{field}', p.field)
        .replace('{limit}', p.limit !== undefined ? String(p.limit) : '')
      setProblem({ key: p.key, field: p.field, text })
      return
    }
    setProblem(null)
    onSend(action, built.responses)
  }

  const setField = (key: string, name: string, value: string | boolean): void =>
    setValues((all) => ({ ...all, [key]: { ...all[key], [name]: value } }))

  const hasForm = views.some((v) => v.kind === 'form' && v.fields.length > 0)

  return (
    <>
      {views.map((view) => (
        <section
          key={view.key}
          data-testid={`mcp-input-request-${testIdSlug(view.key)}`}
          className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] p-2.5"
        >
          {view.kind === 'unsupported' ? (
            <UnsupportedRequest view={view} />
          ) : (
            <>
              {view.message && <p className="m-0 text-[13px] text-[var(--text)]">{view.message}</p>}
              {view.fields.map((field) => (
                <McpElicitField
                  key={field.name}
                  requestKey={view.key}
                  field={field}
                  value={values[view.key]?.[field.name]}
                  invalid={problem?.key === view.key && problem.field === field.name}
                  onChange={(v) => setField(view.key, field.name, v)}
                />
              ))}
            </>
          )}
        </section>
      ))}
      {hasForm && (
        <details open={previewOpen} className="text-[11px]" data-testid="mcp-input-preview">
          <summary className="cursor-pointer text-[var(--muted)]">{t('mcp.input.preview')}</summary>
          <div className="mt-1 max-h-32 overflow-auto rounded border border-[var(--border)] bg-[var(--white)] p-2">
            {preview.responses ? (
              <JsonPre value={preview.responses} testId="mcp-input-preview-json" />
            ) : (
              <span className="text-[var(--hint)]">—</span>
            )}
          </div>
        </details>
      )}
      {problem && <ErrorLine testId="mcp-input-problem">{problem.text}</ErrorLine>}
      {/* A failed answer (issue #154): the card and the typed answers stay for a retry. */}
      {error && !busy && <ErrorLine testId="mcp-input-error">{error}</ErrorLine>}
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton
          onClick={() => send('accept')}
          disabled={busy}
          data-testid="mcp-input-submit"
          className="text-[12px]"
        >
          {busy ? t('mcp.input.sending') : acceptLabel}
        </PrimaryButton>
        <GhostButton
          onClick={() => send('decline')}
          disabled={busy}
          data-testid="mcp-input-decline"
        >
          {t('mcp.input.decline')}
        </GhostButton>
        <GhostButton onClick={() => send('cancel')} disabled={busy} data-testid="mcp-input-cancel">
          {t('mcp.input.cancel')}
        </GhostButton>
      </div>
    </>
  )
}
