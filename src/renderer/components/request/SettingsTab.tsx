/**
 * Postman-style per-request Settings tab.
 * Controls request-level behavior like redirects, SSL, timeouts.
 *
 * These controls are bound to the request store (issues #24-27). Before, they
 * were static `defaultValue`/`defaultChecked` inputs whose values never left
 * the component, so the engine silently used project/global defaults. Now each
 * control reads/writes the active tab's request state, which `sendRequest`
 * forwards to the HTTP engine.
 *
 * Follow redirects and SSL verification are inheritable (issue #287): an
 * untouched request follows the project → app Settings chain and the switch
 * shows the inherited value; flipping it makes it this request's own.
 */
import { useRequestStore } from '../../stores/request.store'
import { useNumberDraft } from '../../lib/number-draft'
import { useTranslation } from '../../lib/i18n'
import CriticalRequestToggle from './CriticalRequestToggle'
import InheritableToggleRow, { type InheritSource } from './InheritableToggleRow'
import { useInheritedNetwork } from '../../lib/use-inherited-network'
import { inheritedFollowRedirects, inheritedSslVerification } from '../../lib/network-settings'

/** Which tier an inherited value comes from (the resolvers' order). */
function inheritSource(project: boolean | undefined, app: boolean | undefined): InheritSource {
  if (typeof project === 'boolean') return 'project'
  if (typeof app === 'boolean') return 'app'
  return 'default'
}

export default function SettingsTab() {
  const { t } = useTranslation()
  const followRedirects = useRequestStore((s) => s.followRedirects)
  const sslVerification = useRequestStore((s) => s.sslVerification)
  const requestTimeout = useRequestStore((s) => s.requestTimeout)
  const maxRedirects = useRequestStore((s) => s.maxRedirects)
  const setFollowRedirects = useRequestStore((s) => s.setFollowRedirects)
  const setSslVerification = useRequestStore((s) => s.setSslVerification)
  const setRequestTimeout = useRequestStore((s) => s.setRequestTimeout)
  const setMaxRedirects = useRequestStore((s) => s.setMaxRedirects)
  const net = useInheritedNetwork()

  // Draft-backed so the box can be emptied and retyped. `Number('')` is 0 and
  // finite, so clearing it silently meant "do not follow any redirect".
  const redirectsDraft = useNumberDraft({
    value: maxRedirects,
    min: 0,
    max: 100,
    onChange: setMaxRedirects,
  })

  return (
    <div className="space-y-5">
      {/* Follow Redirects / SSL Verification — inheritable (issue #287) */}
      <InheritableToggleRow
        testId="settings-follow-redirects"
        label={t('settingsTab.followRedirects')}
        help={t('settingsTab.followRedirectsHelp')}
        own={followRedirects}
        inherited={net ? inheritedFollowRedirects(net) : null}
        source={inheritSource(net?.project.followRedirects, net?.appFollowRedirects)}
        onChange={setFollowRedirects}
      />
      <InheritableToggleRow
        testId="settings-ssl-verify"
        label={t('settingsTab.sslVerify')}
        help={t('settingsTab.sslVerifyHelp')}
        own={sslVerification}
        inherited={net ? inheritedSslVerification(net) : null}
        source={inheritSource(net?.project.sslVerification, net?.appSslVerification)}
        onChange={setSslVerification}
      />

      {/* Timeout */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
          {t('settingsTab.timeout')}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={requestTimeout ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim()
              // Empty → inherit the general (project/app) timeout. A typed
              // value (incl. 0 = no timeout) is an explicit per-request override.
              setRequestTimeout(raw === '' ? null : Number(raw))
            }}
            data-testid="settings-timeout"
            className="w-24 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 outline-none"
            style={{ color: 'var(--text)' }}
            min={0}
            placeholder={t('settingsTab.timeoutPlaceholder')}
          />
          <span style={{ color: 'var(--muted)' }}>{t('settingsTab.timeoutHelp')}</span>
        </div>
      </div>

      {/* Max Redirects */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
          {t('settingsTab.maxRedirects')}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            {...redirectsDraft.inputProps}
            data-testid="settings-max-redirects"
            className="w-24 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 outline-none"
            style={{ color: 'var(--text)' }}
            min={0}
            placeholder="10"
          />
          <span style={{ color: 'var(--muted)' }}>{t('settingsTab.maxRedirectsHelp')}</span>
        </div>
      </div>
      {/* Critical request — stops a Run when it fails (issue #304) */}
      <CriticalRequestToggle />
    </div>
  )
}
