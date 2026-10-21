/**
 * Type switch (HTTP | MCP | SSE | AI) and preset list of the "New mock server"
 * dialog (issues #140, #221). Both are radio groups; the selected preset is
 * highlighted. The type list lives in `new-mock-server.ts`. Keyboard (issue
 * #226): one Tab stop per group, the arrow keys / Home / End move and select
 * (`radio-group-keys.ts`).
 */
import { useTranslation } from '../../lib/i18n'
import { onRadioKeyDown, radioTabIndex } from '../../lib/radio-group-keys'
import {
  MOCK_DIALOG_KINDS,
  MOCK_KIND_HINT_KEYS,
  MOCK_KIND_LABEL,
  presetOptions,
  type MockKind,
} from './new-mock-server'

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
  const presets = presetOptions(kind)
  const presetIds = presets.map((o) => o.id)
  const kindIndex = MOCK_DIALOG_KINDS.indexOf(kind)
  const presetIndex = presetIds.indexOf(presetId)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div
          role="radiogroup"
          aria-label={t('mockNew.type')}
          className="grid gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
          // One column per type; a computed `grid-cols-N` class would not be generated.
          style={{ gridTemplateColumns: `repeat(${MOCK_DIALOG_KINDS.length}, minmax(0, 1fr))` }}
        >
          {MOCK_DIALOG_KINDS.map((k, i) => {
            const active = k === kind
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={radioTabIndex(i, kindIndex)}
                data-testid={`mock-new-type-${k}`}
                onClick={() => onKind(k)}
                onKeyDown={(e) => onRadioKeyDown(e, MOCK_DIALOG_KINDS, i, onKind)}
                className={`h-7 cursor-pointer rounded-md border-none text-[12px] font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--white)] text-[var(--accent-text)] shadow-sm'
                    : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {MOCK_KIND_LABEL[k]}
              </button>
            )
          })}
        </div>
        <p data-testid="mock-new-type-hint" className="mt-1.5 text-[11px] text-[var(--muted)]">
          {t(MOCK_KIND_HINT_KEYS[kind])}
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
          {presets.map((o, i) => {
            const active = o.id === presetId
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={radioTabIndex(i, presetIndex)}
                data-testid={`mock-new-preset-${o.id}`}
                onClick={() => onPreset(o.id)}
                onKeyDown={(e) => onRadioKeyDown(e, presetIds, i, onPreset)}
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
