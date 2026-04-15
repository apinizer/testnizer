/**
 * Postman-style per-request Settings tab.
 * Controls request-level behavior like redirects, SSL, timeouts.
 */
export default function SettingsTab() {
  return (
    <div className="space-y-5">
      {/* Follow Redirects */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div>
          <div className="font-medium" style={{ color: 'var(--text)' }}>Follow redirects</div>
          <div style={{ color: 'var(--muted)' }}>Automatically follow HTTP 3xx redirects</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" defaultChecked className="peer sr-only" />
          <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* SSL Verification */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div>
          <div className="font-medium" style={{ color: 'var(--text)' }}>Enable SSL certificate verification</div>
          <div style={{ color: 'var(--muted)' }}>Verify SSL certificates when sending requests</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" defaultChecked className="peer sr-only" />
          <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Timeout */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>Request timeout</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            defaultValue={0}
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
        <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>Max redirects</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            defaultValue={10}
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
