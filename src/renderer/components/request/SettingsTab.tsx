/**
 * Postman-style per-request Settings tab.
 * Controls request-level behavior like redirects, SSL, timeouts.
 *
 * These controls are bound to the request store (issues #24-27). Before, they
 * were static `defaultValue`/`defaultChecked` inputs whose values never left
 * the component, so the engine silently used project/global defaults. Now each
 * control reads/writes the active tab's request state, which `sendRequest`
 * forwards to the HTTP engine.
 */
import { useRequestStore } from '../../stores/request.store'

export default function SettingsTab() {
  const followRedirects = useRequestStore((s) => s.followRedirects)
  const sslVerification = useRequestStore((s) => s.sslVerification)
  const requestTimeout = useRequestStore((s) => s.requestTimeout)
  const maxRedirects = useRequestStore((s) => s.maxRedirects)
  const setFollowRedirects = useRequestStore((s) => s.setFollowRedirects)
  const setSslVerification = useRequestStore((s) => s.setSslVerification)
  const setRequestTimeout = useRequestStore((s) => s.setRequestTimeout)
  const setMaxRedirects = useRequestStore((s) => s.setMaxRedirects)

  return (
    <div className="space-y-5">
      {/* Follow Redirects */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div>
          <div className="font-medium" style={{ color: 'var(--text)' }}>
            Follow redirects
          </div>
          <div style={{ color: 'var(--muted)' }}>Automatically follow HTTP 3xx redirects</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={followRedirects}
            onChange={(e) => setFollowRedirects(e.target.checked)}
            data-testid="settings-follow-redirects"
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* SSL Verification */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div>
          <div className="font-medium" style={{ color: 'var(--text)' }}>
            Enable SSL certificate verification
          </div>
          <div style={{ color: 'var(--muted)' }}>Verify SSL certificates when sending requests</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={sslVerification}
            onChange={(e) => setSslVerification(e.target.checked)}
            data-testid="settings-ssl-verify"
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Timeout */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
          Request timeout
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={requestTimeout}
            onChange={(e) => setRequestTimeout(Number(e.target.value))}
            data-testid="settings-timeout"
            className="w-24 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 outline-none"
            style={{ color: 'var(--text)' }}
            min={0}
            placeholder="0"
          />
          <span style={{ color: 'var(--muted)' }}>ms (0 = no timeout)</span>
        </div>
      </div>

      {/* Max Redirects */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
          Max redirects
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={maxRedirects}
            onChange={(e) => setMaxRedirects(Number(e.target.value))}
            data-testid="settings-max-redirects"
            className="w-24 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 outline-none"
            style={{ color: 'var(--text)' }}
            min={0}
            placeholder="10"
          />
          <span style={{ color: 'var(--muted)' }}>maximum number of redirects</span>
        </div>
      </div>
    </div>
  )
}
