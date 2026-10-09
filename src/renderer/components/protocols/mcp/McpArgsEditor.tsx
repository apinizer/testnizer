import { useMemo, useState } from 'react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import {
  loadArgsView,
  parseArgsObject,
  planArgsForm,
  saveArgsView,
  setAtPath,
  type ArgsFormUnsupported,
  type ArgsPath,
  type ArgsProblem,
  type ArgsView,
} from '../../../lib/mcp-args-form'
import McpArgsForm from './McpArgsForm'
import { PROBLEM_KEYS } from './call-ui'
import { GhostButton, SectionLabel } from './ui'

const UNSUPPORTED_KEYS: Record<ArgsFormUnsupported, string> = {
  composition: 'mcp.args.unsupported.composition',
  ref: 'mcp.args.unsupported.ref',
  patternProperties: 'mcp.args.unsupported.patternProperties',
  arrayOfObjects: 'mcp.args.unsupported.arrayOfObjects',
  untyped: 'mcp.args.unsupported.untyped',
  notObject: 'mcp.args.unsupported.notObject',
}

const NOTE = 'm-0 text-[11px] text-[var(--muted)]'

function problemText(p: ArgsProblem, t: (key: string) => string): string {
  if (p.reason === 'type') {
    return t('mcp.args.problemType')
      .replace('{field}', p.path)
      .replace('{type}', p.expected ?? '')
  }
  if (p.reason === 'enum') {
    return t('mcp.args.problemEnum')
      .replace('{field}', p.path)
      .replace('{values}', p.expected ?? '')
  }
  return t(PROBLEM_KEYS[p.reason])
    .replace('{field}', p.path)
    .replace('{limit}', p.limit !== undefined ? String(p.limit) : '')
}

function ViewToggle({
  view,
  formDisabled,
  onChange,
}: {
  view: ArgsView
  formDisabled: boolean
  onChange: (v: ArgsView) => void
}) {
  const { t } = useTranslation()
  const btn = (v: ArgsView, label: string, disabled = false) => (
    <button
      type="button"
      data-testid={`mcp-args-view-${v}`}
      aria-pressed={view === v}
      disabled={disabled}
      onClick={() => onChange(v)}
      className={`cursor-pointer rounded border-none px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${
        view === v
          ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
          : 'bg-transparent text-[var(--muted)]'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span className="flex items-center gap-0.5 rounded border border-[var(--border)] p-0.5">
      {btn('form', t('mcp.args.form'), formDisabled)}
      {btn('json', t('mcp.args.json'))}
    </span>
  )
}

/**
 * The tool's arguments (issue #162): a Form / JSON toggle over ONE source of
 * truth, the store's `toolArgs` text. The choice is remembered per user; a
 * schema the form cannot represent forces JSON with a one-line note. The
 * pre-Invoke problems (form view) are listed here with "Invoke anyway".
 */
export default function McpArgsEditor() {
  const { t } = useTranslation()
  const toolArgs = useMcpStore((s) => s.toolArgs)
  const setToolArgs = useMcpStore((s) => s.setToolArgs)
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const tools = useMcpStore((s) => s.tools)
  const problems = useMcpStore((s) => s.argsProblems)
  const callTool = useMcpStore((s) => s.callTool)
  const [view, setView] = useState<ArgsView>(loadArgsView)

  const schema = tools.find((tool) => tool.name === selectedTool)?.inputSchema
  // Disconnected (no schema yet): nothing to build a form from — JSON.
  const plan = useMemo(() => (schema ? planArgsForm(schema) : null), [schema])
  const effective: ArgsView = plan?.ok ? view : 'json'
  const parsed = useMemo(() => parseArgsObject(toolArgs), [toolArgs])
  const invalidPaths = useMemo(() => new Set((problems ?? []).map((p) => p.path)), [problems])

  const choose = (v: ArgsView): void => {
    setView(v)
    saveArgsView(v)
  }
  const patch = (path: ArgsPath, value: unknown): void => {
    if (!parsed) return
    setToolArgs(JSON.stringify(setAtPath(parsed, path, value), null, 2))
  }

  return (
    <>
      <SectionLabel
        right={<ViewToggle view={effective} formDisabled={!plan?.ok} onChange={choose} />}
      >
        {t('mcp.args.label')}
      </SectionLabel>
      {plan && !plan.ok && (
        <p data-testid="mcp-args-unsupported" className={NOTE}>
          {t(UNSUPPORTED_KEYS[plan.reason])}
        </p>
      )}
      {effective === 'json' ? (
        <textarea
          value={toolArgs}
          onChange={(e) => setToolArgs(e.target.value)}
          rows={5}
          data-testid="mcp-tool-args"
          spellCheck={false}
          className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-2 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      ) : !parsed ? (
        <p data-testid="mcp-args-invalid-json" className="m-0 text-[12px] text-[var(--orange)]">
          {t('mcp.args.invalidJson')}
        </p>
      ) : plan?.ok && plan.fields.length === 0 ? (
        <p className={NOTE}>{t('mcp.args.noArgs')}</p>
      ) : (
        <div data-testid="mcp-args-form" className="flex flex-col gap-2">
          <McpArgsForm
            nodes={plan?.ok ? plan.fields : []}
            value={parsed}
            invalidPaths={invalidPaths}
            onPatch={patch}
          />
        </div>
      )}
      {problems && problems.length > 0 && (
        <div
          data-testid="mcp-args-problems"
          className="flex flex-col gap-1 rounded-md border border-[var(--red)] p-2 text-[12px]"
        >
          <span className="font-medium text-[var(--red)]">{t('mcp.args.problemsTitle')}</span>
          <ul className="m-0 pl-4 text-[var(--red)]">
            {problems.map((p) => (
              <li key={`${p.path}:${p.reason}`}>{problemText(p, t)}</li>
            ))}
          </ul>
          <GhostButton
            data-testid="mcp-args-invoke-anyway"
            className="self-start"
            onClick={() => void callTool({ force: true })}
          >
            {t('mcp.args.invokeAnyway')}
          </GhostButton>
        </div>
      )}
    </>
  )
}
