import { useEffect } from 'react'
import Workbench from './Workbench'
import { useTabsStore } from '../../stores/tabs.store'
import { useAuthStore } from '../../stores/auth.store'
import { LogOut } from 'lucide-react'

/**
 * Guest-mode shell. Previously this rendered an HTTP-only editor with no way
 * to reach the other 8 protocols. It now reuses the main Workbench, which
 * gives quick-test users the same 9-protocol welcome screen + tabs the
 * authenticated app has — minus project/workspace concerns.
 */
export default function QuickTestShell() {
  const logout = useAuthStore((s) => s.logout)

  // Seed an empty HTTP tab so Workbench renders NewRequestWelcome (the
  // protocol picker) immediately — without this the user sees a blank pane
  // on first launch.
  useEffect(() => {
    const { tabs, openTab } = useTabsStore.getState()
    if (tabs.length === 0) {
      openTab({
        id: 'quick-test-' + Math.random().toString(36).slice(2, 10),
        name: 'New Request',
        protocol: 'http',
        method: 'GET',
        url: '',
      })
    }
  }, [])

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Minimal header — kept lightweight so the protocol picker dominates */}
      <div
        className="drag-region flex shrink-0 items-center justify-between"
        style={{
          height: 44,
          background: 'var(--white)',
          borderBottom: '1px solid var(--border)',
          paddingLeft: 80,
          paddingRight: 16,
        }}
      >
        <div className="no-drag flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Quick Test</span>
          <span style={{ fontSize: 13, color: 'var(--hint)', marginLeft: 4 }}>
            — Send requests without unlocking projects
          </span>
        </div>

        <button
          type="button"
          onClick={logout}
          className="no-drag flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1 transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--border)',
            background: 'transparent',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          <LogOut size={13} />
          Back to Login
        </button>
      </div>

      {/* Full workbench — protocol picker + per-protocol editors handled there */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Workbench />
      </div>
    </div>
  )
}
