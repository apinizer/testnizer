import { useState } from 'react'
import { Clock, GitCommit } from 'lucide-react'
import HistoryListPanel from './HistoryListPanel'
import CommitHistoryPanel from './CommitHistoryPanel'

type HistoryMode = 'requests' | 'commits'

/**
 * Combined history sidebar — toggle between request history (HistoryListPanel)
 * and git commit history (CommitHistoryPanel). v1.3.1 B8/B10 surfaced the gap:
 * endpoint Save committed to git but nothing in the UI showed those commits.
 * Sharing the existing "history" sidebar slot keeps the chrome consistent
 * with the other side panels.
 */
export default function HistorySidebar() {
  const [mode, setMode] = useState<HistoryMode>('requests')

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center gap-1 px-2"
        style={{ height: 32, borderBottom: '1px solid var(--border)' }}
      >
        <TabButton
          active={mode === 'requests'}
          onClick={() => setMode('requests')}
          icon={<Clock size={12} />}
          label="Requests"
        />
        <TabButton
          active={mode === 'commits'}
          onClick={() => setMode('commits')}
          icon={<GitCommit size={12} />}
          label="Commits"
        />
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'requests' ? <HistoryListPanel /> : <CommitHistoryPanel />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1"
      style={{
        background: active ? 'var(--accent-light)' : 'transparent',
        color: active ? 'var(--accent-text)' : 'var(--muted)',
        border: 'none',
        fontWeight: active ? 600 : 400,
        fontSize: 12,
      }}
    >
      {icon}
      {label}
    </button>
  )
}
