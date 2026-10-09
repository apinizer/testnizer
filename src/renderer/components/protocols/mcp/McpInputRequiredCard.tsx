import { useMemo, useState } from 'react'
import { MessageSquareMore } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { testIdSlug } from '../../../lib/mcp-store-helpers'
import {
  buildInputResponses,
  initialValues,
  parseInputRequests,
  type ContentProblemReason,
  type ElicitValues,
  type InputRequestView,
} from '../../../lib/mcp-elicitation'
import type { McpElicitAnswer, McpPendingInput } from '../../../types/mcp'
import McpElicitField from './McpElicitField'
import { ErrorLine, GhostButton, JsonPre, PrimaryButton } from './ui'

const PROBLEM_KEYS: Record<ContentProblemReason, string> = {
  required: 'mcp.input.problemRequired',
  number: 'mcp.input.problemNumber',
  integer: 'mcp.input.problemInteger',
  minimum: 'mcp.input.problemMinimum',
  maximum: 'mcp.input.problemMaximum',
  minLength: 'mcp.input.problemMinLength',
  maxLength: 'mcp.input.problemMaxLength',
}

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
 * The 2026-07-28 multi-round-trip card (issue #152): a `tools/call` answered
 * `input_required`. Each `elicitation/create` request becomes a form generated
 * from its `requestedSchema`; Submit / Decline / Cancel send the bare
 * `ElicitResult`s with the echoed `requestState` (`mcp:respondInput`). The
 * server may ask again — the next round replaces this card (new `key`).
 */
export default function McpInputRequiredCard({ pending }: { pending: McpPendingInput }) {
  const { t } = useTranslation()
  const respondInput = useMcpStore((s) => s.respondInput)
  const isInvoking = useMcpStore((s) => s.isInvoking)
  const views = useMemo(() => parseInputRequests(pending.inputRequests), [pending.inputRequests])
  const [values, setValues] = useState<Record<string, ElicitValues>>(() =>
    Object.fromEntries(views.map((v) => [v.key, v.kind === 'form' ? initialValues(v.fields) : {}])),
  )
  const [problem, setProblem] = useState<{ key: string; field: string; text: string } | null>(null)

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
    void respondInput(built.responses)
  }

  const setField = (key: string, name: string, value: string | boolean): void =>
    setValues((all) => ({ ...all, [key]: { ...all[key], [name]: value } }))

  return (
    <div
      data-testid="mcp-input-required"
      data-round={pending.round}
      className="flex flex-col gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-light)] p-3"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent-text)]">
        <MessageSquareMore size={14} />
        {t('mcp.input.title')}
        <span className="text-[11px] font-normal text-[var(--muted)]">
          {pending.toolName} · {t('mcp.input.round').replace('{n}', String(pending.round))}
        </span>
      </div>
      {views.length === 0 && (
        <span className="text-[12px] text-[var(--muted)]">{t('mcp.input.stateOnly')}</span>
      )}
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
      {problem && <ErrorLine testId="mcp-input-problem">{problem.text}</ErrorLine>}
      {/* A failed answer (issue #154): the card and the typed answers stay for a retry. */}
      {pending.error && !isInvoking && (
        <ErrorLine testId="mcp-input-error">{pending.error}</ErrorLine>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton
          onClick={() => send('accept')}
          disabled={isInvoking}
          data-testid="mcp-input-submit"
          className="text-[12px]"
        >
          {isInvoking ? t('mcp.input.sending') : t('mcp.input.submit')}
        </PrimaryButton>
        <GhostButton
          onClick={() => send('decline')}
          disabled={isInvoking}
          data-testid="mcp-input-decline"
        >
          {t('mcp.input.decline')}
        </GhostButton>
        <GhostButton
          onClick={() => send('cancel')}
          disabled={isInvoking}
          data-testid="mcp-input-cancel"
        >
          {t('mcp.input.cancel')}
        </GhostButton>
      </div>
      <details className="text-[11px]">
        <summary className="cursor-pointer text-[var(--muted)]">{t('mcp.input.raw')}</summary>
        <div className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] bg-[var(--white)] p-2">
          <JsonPre
            value={{ inputRequests: pending.inputRequests, requestState: pending.requestState }}
          />
        </div>
      </details>
    </div>
  )
}
