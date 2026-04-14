import { useState, useEffect, useRef } from 'react'
import { GitBranch, GitMerge, Plus, Check, Trash2, ArrowUpCircle, ArrowDownCircle, Cloud } from 'lucide-react'
import { useBranchStore } from '../../stores/branch.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'

export default function BranchDropdown({ pill }: { pill?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [merging, setMerging] = useState(false)
  const [newName, setNewName] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const branches = useBranchStore((s) => s.branches)
  const currentBranch = useBranchStore((s) => s.currentBranch)
  const hasGit = useBranchStore((s) => s.hasGit)
  const loading = useBranchStore((s) => s.loading)
  const fetchBranches = useBranchStore((s) => s.fetchBranches)
  const ensureDefault = useBranchStore((s) => s.ensureDefault)
  const createBranch = useBranchStore((s) => s.createBranch)
  const switchBranch = useBranchStore((s) => s.switchBranch)
  const mergeBranch = useBranchStore((s) => s.mergeBranch)
  const pushBranch = useBranchStore((s) => s.pushBranch)
  const pullBranch = useBranchStore((s) => s.pullBranch)
  const deleteBranch = useBranchStore((s) => s.deleteBranch)
  const setGitLoading = useUIStore((s) => s.setGitLoading)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)

  // Load branches when project changes
  useEffect(() => {
    if (activeProjectId) {
      ensureDefault(activeProjectId)
    }
  }, [activeProjectId, ensureDefault])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setMerging(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Focus input on create mode
  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus()
    }
  }, [creating])

  // Toast auto-hide
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
  }

  async function handleCreate() {
    if (!newName.trim() || !activeProjectId) return
    setBusy(true)
    const ok = await createBranch(activeProjectId, newName.trim(), currentBranch)
    if (ok) {
      showToast('success', `Branch "${newName.trim()}" created`)
    } else {
      showToast('error', 'Branch could not be created')
    }
    setNewName('')
    setCreating(false)
    setBusy(false)
  }

  async function handleSwitch(branchName: string) {
    if (!activeProjectId || branchName === currentBranch) return
    setBusy(true)
    setGitLoading(`Switching to ${branchName}...`)
    const ok = await switchBranch(activeProjectId, branchName)
    if (ok) {
      showToast('success', `Switched to "${branchName}"`)
      // Full refresh after branch switch
      await refreshTree()
      await setActiveProject(activeProjectId)
    } else {
      showToast('error', 'Could not switch branch')
    }
    setGitLoading(null)
    setBusy(false)
    setOpen(false)
  }

  async function handleMerge(sourceBranch: string) {
    if (!activeProjectId) return
    setBusy(true)
    setGitLoading(`Merging ${sourceBranch}...`)
    const result = await mergeBranch(activeProjectId, sourceBranch)
    if (result.success) {
      showToast('success', `Merged "${sourceBranch}" into "${currentBranch}"`)
      await refreshTree()
      await setActiveProject(activeProjectId)
    } else {
      showToast('error', result.error || 'Merge failed')
    }
    setGitLoading(null)
    setMerging(false)
    setBusy(false)
  }

  async function handlePush() {
    if (!activeProjectId) return
    setBusy(true)
    setGitLoading('Pushing to remote...')
    const result = await pushBranch(activeProjectId)
    if (result.success) {
      showToast('success', 'Pushed successfully')
    } else {
      showToast('error', result.error || 'Push failed')
    }
    setGitLoading(null)
    setBusy(false)
  }

  async function handlePull() {
    if (!activeProjectId) return
    setBusy(true)
    setGitLoading('Pulling from remote...')
    const result = await pullBranch(activeProjectId)
    if (result.success) {
      showToast('success', 'Pulled successfully')
      // Full app refresh
      await refreshTree()
      await setActiveProject(activeProjectId)
    } else {
      showToast('error', result.error || 'Pull failed')
    }
    setGitLoading(null)
    setBusy(false)
  }

  async function handleDelete(branchName: string) {
    if (!activeProjectId) return
    setBusy(true)
    const result = await deleteBranch(activeProjectId, branchName)
    if (result.success) {
      showToast('success', `Branch "${branchName}" deleted`)
    } else {
      showToast('error', result.error || 'Delete failed')
    }
    setBusy(false)
  }

  const otherBranches = branches.filter((b) => b.name !== currentBranch)

  return (
    <div ref={dropdownRef} className="relative">
      {/* Pill button */}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1"
        style={pill ? {
          background: 'var(--surface)',
          border: '1.5px solid var(--border2)',
          borderRadius: 20,
          padding: '4px 10px',
          fontSize: 12,
          color: 'var(--sub, #374151)',
          fontWeight: 500,
        } : {
          background: 'var(--bg)',
          border: '1px solid var(--border2)',
          borderRadius: 12,
          padding: '2px 8px',
          fontSize: '0.75rem',
          color: 'var(--muted)',
        }}
        onClick={() => {
          setOpen(!open)
          if (!open && activeProjectId) fetchBranches(activeProjectId)
        }}
      >
        <GitBranch size={pill ? 11 : 9} />
        <span className={pill ? 'max-w-[120px] truncate' : 'max-w-[80px] truncate'}>{currentBranch || 'main'}</span>
        {pill && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {/* Toast notification */}
      {toast && (
        <div
          className="fixed right-4 top-4 z-[9999] rounded-lg px-4 py-2"
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: toast.type === 'success' ? 'var(--green-bg)' : '#fee2e2',
            color: toast.type === 'success' ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${toast.type === 'success' ? 'var(--green-border)' : '#fecaca'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 flex flex-col overflow-hidden"
          style={{
            minWidth: 260,
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {/* Git action buttons (push/pull/merge) */}
          {hasGit && (
            <div className="flex items-center gap-1 border-b px-2 py-1.5" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
                style={{ fontSize: 12, background: 'transparent', border: 'none', color: 'var(--text)' }}
                onClick={handlePush}
                disabled={busy}
                title="Push"
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <ArrowUpCircle size={13} />
                <span>Push</span>
              </button>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
                style={{ fontSize: 12, background: 'transparent', border: 'none', color: 'var(--text)' }}
                onClick={handlePull}
                disabled={busy}
                title="Pull"
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <ArrowDownCircle size={13} />
                <span>Pull</span>
              </button>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
                style={{ fontSize: 12, background: 'transparent', border: 'none', color: 'var(--text)' }}
                onClick={() => setMerging(!merging)}
                disabled={busy}
                title="Merge"
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <GitMerge size={13} />
                <span>Merge</span>
              </button>
            </div>
          )}

          {/* Merge mode — select source branch */}
          {merging && (
            <div className="border-b px-2 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div style={{ fontSize: 11, color: 'var(--hint)', marginBottom: 4 }}>
                Merge into <strong style={{ color: 'var(--text)' }}>{currentBranch}</strong> from:
              </div>
              {otherBranches.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left"
                  style={{ fontSize: 13, background: 'transparent', border: 'none', color: 'var(--text)' }}
                  onClick={() => handleMerge(b.name)}
                  disabled={busy}
                  onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <GitBranch size={12} />
                  {b.name}
                  {b.isRemote && <Cloud size={10} style={{ color: 'var(--hint)' }} />}
                </button>
              ))}
              {otherBranches.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--hint)', padding: '4px 0' }}>No other branches</div>
              )}
            </div>
          )}

          {/* Loading indicator */}
          {loading && (
            <div style={{ fontSize: 12, color: 'var(--hint)', padding: '8px 12px', textAlign: 'center' }}>
              Loading branches...
            </div>
          )}

          {/* Branch list */}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {branches.map((branch) => (
              <div
                key={branch.name}
                className="group flex cursor-pointer items-center gap-2 px-3 py-1.5"
                style={{
                  fontSize: 13,
                  background: branch.name === currentBranch ? 'var(--accent-light)' : 'transparent',
                  color: branch.name === currentBranch ? 'var(--accent-text)' : 'var(--text)',
                }}
                onClick={() => handleSwitch(branch.name)}
                onMouseOver={(e) => {
                  if (branch.name !== currentBranch) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                  }
                }}
                onMouseOut={(e) => {
                  if (branch.name !== currentBranch) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }
                }}
              >
                <GitBranch size={12} className="shrink-0" />
                <span className="flex-1 truncate">{branch.name}</span>
                {branch.isRemote && <Cloud size={10} className="shrink-0" style={{ color: 'var(--hint)' }} />}
                {branch.name === currentBranch && <Check size={12} />}
                {branch.name !== currentBranch && branch.name !== 'main' && (
                  <button
                    type="button"
                    className="hidden shrink-0 rounded p-0.5 group-hover:block"
                    style={{ color: 'var(--muted)', background: 'transparent', border: 'none' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(branch.name)
                    }}
                    onMouseOver={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--red)'
                    }}
                    onMouseOut={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--muted)'
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {branches.length === 0 && !loading && (
              <div style={{ fontSize: 12, color: 'var(--hint)', padding: '8px 12px', textAlign: 'center' }}>
                No branches
              </div>
            )}
          </div>

          {/* Separator */}
          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Create new branch */}
          {creating ? (
            <div className="flex items-center gap-1 p-2">
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') {
                    setCreating(false)
                    setNewName('')
                  }
                }}
                placeholder={`New branch from ${currentBranch}`}
                className="flex-1 border-none bg-transparent outline-none"
                style={{
                  fontSize: 13,
                  color: 'var(--text)',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              />
              <button
                type="button"
                className="cursor-pointer"
                style={{
                  fontSize: 12,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
                onClick={handleCreate}
                disabled={busy}
              >
                OK
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2"
              style={{
                fontSize: 13,
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
              }}
              onClick={() => setCreating(true)}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <Plus size={12} />
              New Branch
            </button>
          )}
        </div>
      )}
    </div>
  )
}
