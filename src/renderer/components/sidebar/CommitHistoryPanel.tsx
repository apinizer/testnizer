import { useEffect, useState, useCallback } from 'react'
import { GitCommit, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'

interface CommitRow {
  hash: string
  shortHash: string
  message: string
  date: string
  author: string
  email: string
  refs?: string
}

/**
 * Sidebar panel that renders the git commit log for the active project's
 * current branch. v1.3.1 B8/B10: endpoint Save committed to git but there
 * was no surface for the user to see what they'd saved. This is the
 * read-only view of that history; clicking a row expands the full message.
 *
 * The data fetches lazily on mount and on the user-triggered "Refresh"
 * button — git operations are too expensive to re-run on every render.
 */
export default function CommitHistoryPanel() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const currentBranch = useBranchStore((s) => s.currentBranch)
  const [commits, setCommits] = useState<CommitRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!activeProjectId) return
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api?.git?.listCommits({
        projectId: activeProjectId,
        limit: 200,
      })) as
        | { success: boolean; error?: string; data?: { commits: CommitRow[]; total: number } }
        | undefined
      if (!result?.success) {
        setError(result?.error || 'Failed to load commit history')
        setCommits([])
      } else {
        setCommits(result.data?.commits ?? [])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  useEffect(() => {
    void refresh()
  }, [refresh, currentBranch])

  function toggle(hash: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <GitCommit size={14} style={{ color: 'var(--muted)' }} />
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Commit History</span>
        <span style={{ marginLeft: 'auto', color: 'var(--hint)', fontSize: 12 }}>
          {currentBranch || '—'}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh commit history"
          className="cursor-pointer rounded p-1 hover:bg-[var(--surface)] disabled:cursor-wait disabled:opacity-50"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!activeProjectId && (
          <div className="px-3 py-6 text-center" style={{ color: 'var(--hint)', fontSize: 13 }}>
            Open a project to view its commit history.
          </div>
        )}

        {activeProjectId && error && (
          <div
            className="m-3 rounded px-3 py-2"
            style={{ background: '#fff0f0', color: '#cc2200', border: '1px solid #f5b3b3' }}
          >
            {error}
          </div>
        )}

        {activeProjectId && !error && commits.length === 0 && !loading && (
          <div className="px-3 py-6 text-center" style={{ color: 'var(--hint)', fontSize: 13 }}>
            No commits yet. Save an endpoint to create the first commit.
          </div>
        )}

        {commits.map((c) => {
          const isOpen = expanded.has(c.hash)
          const firstLine = c.message.split('\n')[0]
          return (
            <button
              type="button"
              key={c.hash}
              onClick={() => toggle(c.hash)}
              className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface)]"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border-split)',
              }}
            >
              {isOpen ? (
                <ChevronDown
                  size={12}
                  className="mt-1 shrink-0"
                  style={{ color: 'var(--muted)' }}
                />
              ) : (
                <ChevronRight
                  size={12}
                  className="mt-1 shrink-0"
                  style={{ color: 'var(--muted)' }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className="truncate"
                  style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}
                >
                  {firstLine}
                </div>
                <div
                  className="mt-0.5 flex items-center gap-2"
                  style={{ color: 'var(--muted)', fontSize: 11 }}
                >
                  <span className="font-mono" style={{ color: 'var(--accent-text)' }}>
                    {c.shortHash}
                  </span>
                  <span>{c.author}</span>
                  <span>•</span>
                  <span>{formatDate(c.date)}</span>
                  {c.refs && c.refs.trim() && (
                    <>
                      <span>•</span>
                      <span className="truncate">{c.refs}</span>
                    </>
                  )}
                </div>
                {isOpen && c.message.includes('\n') && (
                  <pre
                    className="mt-2 whitespace-pre-wrap rounded px-2 py-1"
                    style={{
                      background: 'var(--surface)',
                      color: 'var(--muted)',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {c.message}
                  </pre>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const now = Date.now()
  const delta = (now - d.getTime()) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`
  return d.toLocaleDateString()
}
