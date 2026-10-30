/**
 * One per-request switch whose value can be INHERITED (issue #287): SSL
 * certificate verification and Follow redirects on the request Settings tab.
 *
 * The request value is tri-state (`null` = inherit the project → app chain,
 * `true`/`false` = this request's own choice). The switch always shows the
 * EFFECTIVE value — what Send and Run use — and the line under it says where
 * that value comes from. Flipping the switch makes it this request's own
 * choice; "Use inherited" goes back to `null`. The checkbox keeps its old
 * `data-testid`, so it is still a plain checkbox for tests and assistive tech.
 */
import { useTranslation } from '../../lib/i18n'

export type InheritSource = 'project' | 'app' | 'default'

interface Props {
  testId: string
  label: string
  help: string
  /** The request's own value; `null` = inherit. */
  own: boolean | null
  /** The value it inherits (`null` while it is still loading). */
  inherited: boolean | null
  source: InheritSource
  onChange: (v: boolean | null) => void
}

export default function InheritableToggleRow({
  testId,
  label,
  help,
  own,
  inherited,
  source,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const effective = own ?? inherited ?? true
  const onOff = (v: boolean): string => t(v ? 'settingsTab.valueOn' : 'settingsTab.valueOff')
  const sourceText = t(`settingsTab.inheritedFrom.${source}`)

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
      <div>
        <div className="font-medium text-[var(--text)]">{label}</div>
        <div className="text-[var(--muted)]">{help}</div>
        <div className="mt-1 flex items-center gap-2 text-[var(--muted)]">
          <span data-testid={`${testId}-source`} data-inherited={own === null ? 'true' : 'false'}>
            {own === null
              ? t('settingsTab.inheritedValue')
                  .replace('{source}', sourceText)
                  .replace('{value}', onOff(effective))
              : t('settingsTab.ownValue')}
          </span>
          {own !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              data-testid={`${testId}-inherit`}
              className="cursor-pointer border-none bg-transparent p-0 text-[var(--accent)] underline-offset-2 hover:underline"
            >
              {t('settingsTab.useInherited')
                .replace('{source}', sourceText)
                .replace('{value}', inherited === null ? '…' : onOff(inherited))}
            </button>
          )}
        </div>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={effective}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
          aria-label={label}
          className="peer sr-only"
        />
        <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
      </label>
    </div>
  )
}
