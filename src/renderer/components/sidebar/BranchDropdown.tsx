import { useState, useEffect, useRef } from 'react'
import { GitBranch, Plus, Check, Trash2 } from 'lucide-react'
import { useBranchStore } from '../../stores/branch.store'
import { useWorkspaceStore } from '../../stores/workspace.store'

export default function BranchDropdown({ pill }: { pill?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const branches = useBranchStore((s) => s.branches)
  const activeBranchId = useBranchStore((s) => s.activeBranchId)
  const setActiveBranch = useBranchStore((s) => s.setActiveBranch)
  const fetchBranches = useBranchStore((s) => s.fetchBranches)
  const ensureDefault = useBranchStore((s) => s.ensureDefault)
  const createBranch = useBranchStore((s) => s.createBranch)
  const deleteBranch = useBranchStore((s) => s.deleteBranch)

  const activeBranch = branches.find((b) => b.id === activeBranchId)

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

  async function handleCreate() {
    if (!newName.trim() || !activeProjectId) return
    const branch = await createBranch(activeProjectId, newName.trim())
    if (branch) {
      setActiveBranch(branch.id)
    }
    setNewName('')
    setCreating(false)
  }

  async function handleDelete(id: string) {
    if (!activeProjectId) return
    await deleteBranch(id, activeProjectId)
  }

  function handleSwitch(id: string) {
    setActiveBranch(id)
    setOpen(false)
  }

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
        onClick={() => setOpen(!open)}
      >
        <GitBranch size={pill ? 11 : 9} />
        <span className={pill ? 'max-w-[120px] truncate' : 'max-w-[80px] truncate'}>{activeBranch?.name || 'main'}</span>
        {pill && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 flex flex-col overflow-hidden"
          style={{
            minWidth: 200,
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {/* Branch list */}
          <div className="max-h-[200px] overflow-y-auto py-1">
            {branches.map((branch) => (
              <div
                key={branch.id}
                className="group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[0.825rem]"
                style={{
                  background: branch.id === activeBranchId ? 'var(--accentLight)' : 'transparent',
                  color: branch.id === activeBranchId ? 'var(--accentText)' : 'var(--text)',
                }}
                onClick={() => handleSwitch(branch.id)}
                onMouseOver={(e) => {
                  if (branch.id !== activeBranchId) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--fill-3)'
                  }
                }}
                onMouseOut={(e) => {
                  if (branch.id !== activeBranchId) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }
                }}
              >
                <GitBranch size={12} className="shrink-0" />
                <span className="flex-1 truncate">{branch.name}</span>
                {branch.id === activeBranchId && <Check size={12} />}
                {!branch.is_default && (
                  <button
                    type="button"
                    className="hidden shrink-0 rounded p-0.5 group-hover:block"
                    style={{ color: 'var(--muted)', background: 'transparent', border: 'none' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(branch.id)
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
                placeholder="Branch name"
                className="flex-1 border-none bg-transparent text-[0.825rem] outline-none"
                style={{
                  color: 'var(--text)',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              />
              <button
                type="button"
                className="cursor-pointer text-[0.75rem]"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
                onClick={handleCreate}
              >
                OK
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-[0.825rem]"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
              }}
              onClick={() => setCreating(true)}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--fill-3)'
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
