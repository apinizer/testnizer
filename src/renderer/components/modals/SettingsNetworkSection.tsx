import { useId } from 'react'
import { useNumberDraft } from '../../lib/number-draft'
import { useTranslation } from '../../lib/i18n'

export interface NetworkDraft {
  timeout: number
  sslVerification: boolean
  followRedirects: boolean
  proxyMode: 'system' | 'none' | 'custom'
  proxyHost: string
  proxyPort: string
  proxyUser: string
  proxyPassword: string
}

const FIELD_CLS =
  'rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none'
const LABEL_CLS = 'mb-1.5 block font-medium text-[var(--muted)]'

/** "Projects can override this in Project settings" (issue #254). */
function OverrideNote({ field }: { field: 'timeout' | 'ssl' | 'redirects' | 'proxy' }) {
  const { t } = useTranslation()
  return (
    <p data-testid={`app-setting-override-note-${field}`} className="m-0 mt-1 text-[var(--hint)]">
      {t('settingsScope.overrideNote')}
    </p>
  )
}

/**
 * App settings → request defaults: timeout, SSL verification, follow
 * redirects and proxy. Every one is the LAST link of its chain — a project
 * (Project settings) or a request may override it (`src/shared/
 * request-settings.ts`: `resolveHttpTimeout`, `resolveSslVerification`,
 * `resolveFollowRedirects`, `resolveProxy`), hence the override notes.
 */
export default function SettingsNetworkSection({
  value,
  onChange,
}: {
  value: NetworkDraft
  onChange: (patch: Partial<NetworkDraft>) => void
}) {
  const { t } = useTranslation()
  const timeoutId = useId()
  const sslId = useId()
  const redirectsId = useId()
  const proxyModeId = useId()
  const timeoutDraft = useNumberDraft({
    value: value.timeout,
    min: 1,
    max: 600_000,
    onChange: (timeout) => onChange({ timeout }),
  })

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={timeoutId} className={LABEL_CLS}>
          {t('settings.timeout')}
        </label>
        <input
          id={timeoutId}
          type="number"
          {...timeoutDraft.inputProps}
          min={1}
          className={`w-28 ${FIELD_CLS}`}
        />
        <span className="ml-2 text-[var(--muted)]">ms</span>
        <OverrideNote field="timeout" />
      </div>

      <div>
        <div className="flex items-center gap-2">
          <input
            id={sslId}
            type="checkbox"
            checked={value.sslVerification}
            onChange={(e) => onChange({ sslVerification: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <label htmlFor={sslId} className="text-[var(--text)]">
            {t('settings.sslVerification')}
          </label>
        </div>
        <OverrideNote field="ssl" />
      </div>

      <div>
        <div className="flex items-center gap-2">
          <input
            id={redirectsId}
            type="checkbox"
            data-testid="app-follow-redirects"
            checked={value.followRedirects}
            onChange={(e) => onChange({ followRedirects: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <label htmlFor={redirectsId} className="text-[var(--text)]">
            {t('general.followRedirects')}
          </label>
        </div>
        <OverrideNote field="redirects" />
      </div>

      <div>
        <label htmlFor={proxyModeId} className={LABEL_CLS}>
          {t('settings.proxy')}
        </label>
        <select
          id={proxyModeId}
          data-testid="app-proxy-mode"
          value={value.proxyMode}
          onChange={(e) => onChange({ proxyMode: e.target.value as NetworkDraft['proxyMode'] })}
          className={FIELD_CLS}
        >
          <option value="system">{t('settings.systemProxy')}</option>
          <option value="none">{t('settings.noProxy')}</option>
          <option value="custom">{t('settings.customProxy')}</option>
        </select>
        {value.proxyMode === 'custom' && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                aria-label={t('settings.host')}
                data-testid="app-proxy-host"
                value={value.proxyHost}
                onChange={(e) => onChange({ proxyHost: e.target.value })}
                placeholder={t('settings.host')}
                className={`flex-1 ${FIELD_CLS}`}
              />
              <input
                aria-label={t('settings.port')}
                data-testid="app-proxy-port"
                value={value.proxyPort}
                onChange={(e) => onChange({ proxyPort: e.target.value })}
                placeholder={t('settings.port')}
                className={`w-20 ${FIELD_CLS}`}
              />
            </div>
            <div className="flex gap-2">
              <input
                aria-label={t('proxy.username')}
                data-testid="app-proxy-username"
                value={value.proxyUser}
                onChange={(e) => onChange({ proxyUser: e.target.value })}
                placeholder={t('proxy.username')}
                autoComplete="off"
                className={`flex-1 ${FIELD_CLS}`}
              />
              <input
                aria-label={t('proxy.password')}
                data-testid="app-proxy-password"
                type="password"
                value={value.proxyPassword}
                onChange={(e) => onChange({ proxyPassword: e.target.value })}
                placeholder={t('proxy.password')}
                autoComplete="off"
                className={`flex-1 ${FIELD_CLS}`}
              />
            </div>
          </div>
        )}
        <OverrideNote field="proxy" />
      </div>
    </div>
  )
}
