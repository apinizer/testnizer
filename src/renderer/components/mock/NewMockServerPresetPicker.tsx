/**
 * Type switch (HTTP | MCP) and preset list of the "New mock server" dialog
 * (issue #140). Both are radio groups; the selected preset is highlighted.
 */
import { useTranslation } from '../../lib/i18n'
import { presetOptions, type MockKind } from './new-mock-server'

const KINDS: readonly MockKind[] = ['http', 'mcp']
const KIND_LABEL: Record<MockKind, string> = { http: 'HTTP', mcp: 'MCP' }

export default function NewMockServerPresetPicker({
  kind,
  presetId,
  onKind,
  onPreset,
}: {
  kind: MockKind
  presetId: string
  onKind: (kind: MockKind) => void
  onPreset: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div
          role="radiogroup"
          aria-label={t('mockNew.type')}
          className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
        >
          {KINDS.map((k) => {
            const active = k === kind
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`mock-new-type-${k}`}
                onClick={() => onKind(k)}
                className={`h-7 cursor-pointer rounded-md border-none text-[12px] font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--white)] text-[var(--accent-text)] shadow-sm'
                    : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">
          {kind === 'http' ? t('mockNew.typeHttpHint') : t('mockNew.typeMcpHint')}
        </p>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {t('mockNew.template')}
        </div>
        <div
          role="radiogroup"
          aria-label={t('mockNew.template')}
          data-testid="mock-new-presets"
          className="flex flex-col gap-1.5"
        >
          {presetOptions(kind).map((o) => {
            const active = o.id === presetId
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`mock-new-preset-${o.id}`}
                onClick={() => onPreset(o.id)}
                className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                    : 'border-[var(--border)] bg-transparent hover:bg-[var(--surface)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-[var(--accent)]' : 'border-[var(--border2)]'
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={`text-[12.5px] font-semibold ${
                      active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'
                    }`}
                  >
                    {t(o.labelKey)}
                  </span>
                  <span className="text-[11px] leading-snug text-[var(--muted)]">
                    {t(o.hintKey)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
