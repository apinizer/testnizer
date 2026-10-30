import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/**
 * Issue #254 — what a project-dialog field really is: a project override of
 * an app Settings value. One component for timeout / SSL / redirects / proxy:
 *  - unset (`own` false): `data-scope="app"` + "follows the app Settings
 *    (<value>)" — the same sentence #287 introduced;
 *  - set: `data-scope="project"` + "Overrides the app setting." and a
 *    "Use app setting" button. The button is a draft edit (the dialog saves
 *    `<key>: null`, the delete marker main understands).
 */
export type ScopeField = 'timeout' | 'ssl' | 'redirects' | 'proxy'

export function SettingScopeNote({
  field,
  own,
  appValue,
  onReset,
}: {
  field: ScopeField
  own: boolean
  /** The app value as the user reads it ("45000 ms", "off", "proxy.example:3128"). */
  appValue: string
  onReset: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        data-testid={`project-setting-scope-${field}`}
        data-scope={own ? 'project' : 'app'}
        className={own ? 'text-[var(--accent-text)]' : 'text-[var(--hint)]'}
      >
        {own
          ? t('settingsScope.overridesApp')
          : t('general.inheritsAppValue').replace('{value}', appValue)}
      </span>
      {own && (
        <button
          type="button"
          data-testid={`project-setting-reset-${field}`}
          onClick={onReset}
          className="cursor-pointer rounded border-none bg-transparent px-0 text-[var(--accent-text)] underline underline-offset-2 hover:opacity-80"
        >
          {t('settingsScope.useAppSetting')}
        </button>
      )}
    </div>
  )
}

/**
 * Timeout box of the project General pane: empty (with the app value as its
 * placeholder) while the project follows the app; a number makes it the
 * project's own; emptying it hands it back (`null`).
 */
export function ProjectTimeoutInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null | undefined
  placeholder: string
  onChange: (v: number | null) => void
}) {
  const shown = value == null ? '' : String(value)
  // While focused the raw text is kept (a half-typed number); otherwise the
  // box mirrors the value, so a "Use app setting" reset empties it.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? shown
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        data-testid="project-timeout-input"
        value={text}
        min={0}
        max={600000}
        placeholder={placeholder}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === '') return onChange(null)
          if (!/^\d+$/.test(raw.trim())) return
          const n = Number(raw)
          if (n >= 0 && n <= 600000) onChange(n)
        }}
        className="h-[34px] w-[140px] rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--input-bg)] px-2.5 text-[var(--text)] outline-none"
      />
      <span className="text-[var(--muted)]">ms</span>
    </div>
  )
}

/** Project dialog → Themes: appearance is app-wide, so only a link row remains. */
export function AppearanceLinkPane({ onOpenApp }: { onOpenApp: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <div className="mb-5">
        <div className="text-[16px] font-semibold text-[var(--heading)]">
          {t('settingsScope.appearanceTitle')}
        </div>
        <div className="mt-0.5 text-[var(--muted)]">{t('settingsScope.appearanceSubtitle')}</div>
      </div>
      <button
        type="button"
        data-testid="project-appearance-link"
        onClick={onOpenApp}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left hover:border-[var(--accent)]"
      >
        <span className="text-[var(--text)]">{t('settingsScope.appearanceLinkText')}</span>
        <span className="flex items-center gap-1.5 font-medium text-[var(--accent-text)]">
          {t('settingsScope.openAppSettings')}
          <ExternalLink size={13} aria-hidden="true" />
        </span>
      </button>
      <div className="mt-3 text-[var(--hint)]">{t('settingsScope.accentHint')}</div>
    </div>
  )
}
