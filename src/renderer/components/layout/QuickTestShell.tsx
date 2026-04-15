import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import UrlBar from './UrlBar'
import RequestEditor from '../request/RequestEditor'
import ResponsePane from '../response/ResponsePane'
import { useRequestStore } from '../../stores/request.store'
import { useAuthStore } from '../../stores/auth.store'
import { LogOut } from 'lucide-react'

export default function QuickTestShell() {
  const logout = useAuthStore((s) => s.logout)

  // Initialize request store with defaults for quick test
  useEffect(() => {
    const rs = useRequestStore.getState()
    if (!rs.url) {
      rs.setMethod('GET')
      rs.setUrl('')
    }
  }, [])

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Minimal header */}
      <div
        className="drag-region flex shrink-0 items-center justify-between"
        style={{
          height: 40,
          background: 'var(--white)',
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
        }}
      >
        <div className="no-drag flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

      {/* URL Bar */}
      <UrlBar />

      {/* Split pane: Request | Response */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <RequestEditor />
        </Panel>

        <PanelResizeHandle
          className="shrink-0"
          style={{ height: 1, background: 'var(--border)', cursor: 'row-resize' }}
        />

        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <ResponsePane />
        </Panel>
      </PanelGroup>
    </div>
  )
}
