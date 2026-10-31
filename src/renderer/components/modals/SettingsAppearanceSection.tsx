import { useId } from 'react'
import { useNumberDraft } from '../../lib/number-draft'
import { useTranslation } from '../../lib/i18n'
import { FONT_PRESETS } from '../../stores/ui.store'
import type { Theme, Language } from '../../types'

export interface AppearanceDraft {
  theme: Theme
  language: Language
  fontSize: number
  fontFamily: string
}

const FIELD_CLS =
  'rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none'
const LABEL_CLS = 'mb-1.5 block font-medium text-[var(--muted)]'

/**
 * App settings → appearance (issue #254: the only place theme / language /
 * font size / font family are set — they are app-wide `ui.store` values).
 * Draft only; the dialog's Save applies them.
 */
export default function SettingsAppearanceSection({
  value,
  onChange,
}: {
  value: AppearanceDraft
  onChange: (patch: Partial<AppearanceDraft>) => void
}) {
  const { t } = useTranslation()
  const langId = useId()
  const fontId = useId()
  const familyId = useId()
  // Draft-backed: `Number('')` is 0 — clearing the box wrote 0 px app-wide.
  const fontDraft = useNumberDraft({
    value: value.fontSize,
    min: 10,
    max: 20,
    onChange: (fontSize) => onChange({ fontSize }),
  })
  const themeLabels: Record<Theme, string> = {
    light: t('settings.light'),
    dark: t('settings.dark'),
    system: t('settings.system'),
  }

  return (
    <div className="space-y-5">
      <p data-testid="app-setting-scope-appearance" className="m-0 text-[var(--hint)]">
        {t('settingsScope.appearanceScope')}
      </p>
      <div>
        <span className={LABEL_CLS}>{t('settings.theme')}</span>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as Theme[]).map((thm) => {
            const on = value.theme === thm
            return (
              <button
                key={thm}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ theme: thm })}
                className={`cursor-pointer rounded-[7px] border px-3 py-1.5 transition-colors ${
                  on
                    ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent-text)]'
                    : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)]'
                }`}
              >
                {themeLabels[thm]}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label htmlFor={langId} className={LABEL_CLS}>
          {t('settings.language')}
        </label>
        <select
          id={langId}
          value={value.language}
          onChange={(e) => onChange({ language: e.target.value as Language })}
          className={FIELD_CLS}
        >
          <option value="en">{t('settings.english')}</option>
          <option value="tr">{t('settings.turkish')}</option>
        </select>
      </div>

      <div>
        <label htmlFor={fontId} className={LABEL_CLS}>
          {t('settings.fontSize')}
        </label>
        <input
          id={fontId}
          type="number"
          {...fontDraft.inputProps}
          min={10}
          max={20}
          className={`w-20 ${FIELD_CLS}`}
        />
        <span className="ml-2 text-[var(--muted)]">px</span>
      </div>

      <div>
        <label htmlFor={familyId} className={LABEL_CLS}>
          {t('settings.fontFamily')}
        </label>
        <input
          id={familyId}
          type="text"
          data-testid="app-font-family"
          value={value.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          placeholder={t('themes.fontFamilyPlaceholder')}
          spellCheck={false}
          className={`w-full ${FIELD_CLS}`}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FONT_PRESETS.map((p) => {
            const on = p.stack === value.fontFamily
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                data-testid={`app-font-preset-${p.id}`}
                onClick={() => onChange({ fontFamily: p.stack })}
                className={`cursor-pointer rounded-md border px-2 py-0.5 ${
                  on
                    ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent-text)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
