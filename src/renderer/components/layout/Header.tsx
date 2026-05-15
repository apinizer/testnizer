import { useState } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import ProjectIcon from '../shared/ProjectIcon'
import BranchDropdown from '../sidebar/BranchDropdown'
import { T } from '../../styles/tokens'
import { isMac } from '../../lib/platform'

// SVG icons for git operations
function ArrowUpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}
function ArrowDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

type OpStatus = 'idle' | 'loading' | 'success' | 'error'

export default function Header() {
  const goHome = useWorkspaceStore((s) => s.goHome)
  const setShowSaveModal = useUIStore((s) => s.setShowSaveModal)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const setGitLoading = useUIStore((s) => s.setGitLoading)
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const { t } = useTranslation()

  const [saveStatus, setSaveStatus] = useState<OpStatus>('idle')
  const [pushStatus, setPushStatus] = useState<OpStatus>('idle')
  const [pullStatus, setPullStatus] = useState<OpStatus>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  const isGitProject =
    activeProject && (activeProject.save_mode === 'git' || activeProject.save_mode === 'both')

  // ─── Local save ──────────────────────────────────────────
  async function handleSave() {
    if (!activeProject) {
      setShowSaveModal(true)
      return
    }
    const mode = activeProject.save_mode || 'local'

    if (mode === 'local' || mode === 'both') {
      setSaveStatus('loading')
      try {
        const result = (await window.api?.save?.local({
          projectId: activeProject.id,
          directoryPath: activeProject.local_path || undefined,
        })) as { success: boolean; error?: string }
        if (result?.success) {
          setSaveStatus('success')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } else {
          setShowSaveModal(true)
          setSaveStatus('idle')
        }
      } catch {
        setShowSaveModal(true)
        setSaveStatus('idle')
      }
      return
    }
    // git-only mode: use push
    handlePush()
  }

  // ─── Git push (uses real git — pushes current branch) ────
  async function handlePush() {
    if (!activeProject) return
    setPushStatus('loading')
    setStatusMsg('')
    setGitLoading('Pushing to remote...')
    try {
      const result = await window.api.git.push(activeProject.id)

      if (result?.success) {
        setStatusMsg(`Push başarılı (${result.data?.branch || 'branch'})`)
        setPushStatus('success')
        setTimeout(() => {
          setPushStatus('idle')
          setStatusMsg('')
        }, 3000)
      } else {
        setStatusMsg(result?.error || 'Push hatası')
        setPushStatus('error')
        setTimeout(() => {
          setPushStatus('idle')
          setStatusMsg('')
        }, 5000)
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
      setPushStatus('error')
      setTimeout(() => {
        setPushStatus('idle')
        setStatusMsg('')
      }, 5000)
    }
    setGitLoading(null)
  }

  // ─── Git pull (uses real git — pulls current branch) ────
  async function handlePull() {
    if (!activeProject) return
    setPullStatus('loading')
    setStatusMsg('')
    setGitLoading('Pulling from remote...')
    try {
      const result = await window.api.git.pull(activeProject.id)

      if (result?.success) {
        setStatusMsg(`Pull başarılı (${result.data?.branch || 'branch'})`)
        setPullStatus('success')

        // Full app refresh — re-read everything from DB
        // Re-import pulled data into DB first
        try {
          await window.api.save.gitPull({ projectId: activeProject.id })
        } catch {
          /* pulled data may not need DB import if using file-based */
        }

        // Refresh tree, tabs, and all stores
        await refreshTree()
        // Force full project reload to refresh all data
        await setActiveProject(activeProject.id)

        setTimeout(() => {
          setPullStatus('idle')
          setStatusMsg('')
        }, 3000)
      } else {
        setStatusMsg(result?.error || 'Pull hatası')
        setPullStatus('error')
        setTimeout(() => {
          setPullStatus('idle')
          setStatusMsg('')
        }, 5000)
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
      setPullStatus('error')
      setTimeout(() => {
        setPullStatus('idle')
        setStatusMsg('')
      }, 5000)
    }
    setGitLoading(null)
  }

  function handleDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    window.api?.window?.toggleMaximize?.()
  }

  const anyLoading =
    saveStatus === 'loading' || pushStatus === 'loading' || pullStatus === 'loading'

  return (
    <header
      className="drag-region flex shrink-0 items-center"
      style={{
        height: 44,
        paddingLeft: 72,
        background: 'var(--header-bg)',
        borderBottom: `1px solid ${T.border}`,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Home tab */}
      <div
        className="no-drag flex items-center cursor-pointer shrink-0"
        style={{
          padding: '0 16px',
          height: '100%',
          borderRight: `1px solid ${T.border}`,
          color: T.muted,
          fontSize: 13,
        }}
        onClick={goHome}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = T.surface
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ marginRight: 6 }}
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        {t('home.tab')}
      </div>

      {/* Project tab */}
      {activeProject && (
        <div
          className="no-drag group flex items-center gap-1.5 cursor-pointer shrink-0"
          style={{
            padding: '0 16px',
            height: '100%',
            fontSize: 13,
            fontWeight: 500,
            borderBottom: `2px solid ${T.accent}`,
            color: T.text,
          }}
          onClick={() => goHome()}
          title={`${activeProject.display_name || activeProject.name} — click to switch projects (${isMac() ? '⌘' : 'Ctrl'}+P)`}
        >
          <ProjectIcon
            name={activeProject.display_name || activeProject.name}
            emoji={activeProject.icon_emoji || undefined}
            color={activeProject.icon_color || T.accent}
            size={18}
          />
          <span className="truncate" style={{ maxWidth: 160 }}>
            {activeProject.display_name || activeProject.name}
          </span>
          <span
            className="hidden cursor-pointer group-hover:inline"
            style={{ color: T.ghost, fontSize: 16, marginLeft: 4 }}
            onClick={(e) => {
              e.stopPropagation()
              goHome()
            }}
          >
            ×
          </span>
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div
          className="no-drag shrink-0"
          style={{
            fontSize: 13,
            padding: '2px 10px',
            borderRadius: 4,
            color: pushStatus === 'error' || pullStatus === 'error' ? 'var(--red)' : 'var(--green)',
            background:
              pushStatus === 'error' || pullStatus === 'error'
                ? 'rgba(239,68,68,0.1)'
                : 'var(--green-bg)',
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="no-drag flex items-center gap-1.5 shrink-0" style={{ padding: '0 14px' }}>
        {/* Branch dropdown */}
        <BranchDropdown pill />

        {/* Git Pull */}
        {isGitProject && (
          <button
            type="button"
            onClick={handlePull}
            disabled={anyLoading}
            className="flex items-center gap-1 cursor-pointer"
            title="Git Pull"
            style={{
              background: 'transparent',
              border: `1px solid ${pullStatus === 'success' ? 'var(--green)' : pullStatus === 'error' ? 'var(--red)' : T.border}`,
              borderRadius: 7,
              padding: '4px 8px',
              color:
                pullStatus === 'success'
                  ? 'var(--green)'
                  : pullStatus === 'error'
                    ? 'var(--red)'
                    : T.muted,
              fontSize: 13,
              transition: 'all 0.2s',
              opacity: anyLoading && pullStatus !== 'loading' ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (pullStatus === 'idle')
                (e.currentTarget as HTMLElement).style.borderColor = T.accent
            }}
            onMouseLeave={(e) => {
              if (pullStatus === 'idle')
                (e.currentTarget as HTMLElement).style.borderColor = T.border
            }}
          >
            {pullStatus === 'loading' ? (
              <Loader2
                size={12}
                aria-hidden="true"
                style={{ animation: 'spin 1s linear infinite' }}
              />
            ) : (
              <ArrowDownIcon />
            )}
            <span>Pull</span>
          </button>
        )}

        {/* Git Push */}
        {isGitProject && (
          <button
            type="button"
            onClick={handlePush}
            disabled={anyLoading}
            className="flex items-center gap-1 cursor-pointer"
            title="Git Push"
            style={{
              background: 'transparent',
              border: `1px solid ${pushStatus === 'success' ? 'var(--green)' : pushStatus === 'error' ? 'var(--red)' : T.border}`,
              borderRadius: 7,
              padding: '4px 8px',
              color:
                pushStatus === 'success'
                  ? 'var(--green)'
                  : pushStatus === 'error'
                    ? 'var(--red)'
                    : T.muted,
              fontSize: 13,
              transition: 'all 0.2s',
              opacity: anyLoading && pushStatus !== 'loading' ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (pushStatus === 'idle')
                (e.currentTarget as HTMLElement).style.borderColor = T.accent
            }}
            onMouseLeave={(e) => {
              if (pushStatus === 'idle')
                (e.currentTarget as HTMLElement).style.borderColor = T.border
            }}
          >
            {pushStatus === 'loading' ? (
              <Loader2
                size={12}
                aria-hidden="true"
                style={{ animation: 'spin 1s linear infinite' }}
              />
            ) : (
              <ArrowUpIcon />
            )}
            <span>Push</span>
          </button>
        )}

        {/* Local Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={anyLoading}
          className="flex items-center gap-1 cursor-pointer"
          style={{
            background: 'transparent',
            border: `1px solid ${saveStatus === 'success' ? 'var(--green)' : T.border}`,
            borderRadius: 7,
            padding: '4px 10px',
            color: saveStatus === 'success' ? 'var(--green)' : T.muted,
            fontSize: 13,
            transition: 'all 0.2s',
          }}
          title="Save Project (Cmd+S)"
          onMouseEnter={(e) => {
            if (saveStatus === 'idle') {
              ;(e.currentTarget as HTMLElement).style.color = T.accent
              ;(e.currentTarget as HTMLElement).style.borderColor = T.accent
            }
          }}
          onMouseLeave={(e) => {
            if (saveStatus === 'idle') {
              ;(e.currentTarget as HTMLElement).style.color = T.muted
              ;(e.currentTarget as HTMLElement).style.borderColor = T.border
            }
          }}
        >
          {saveStatus === 'loading' ? (
            <Loader2
              size={12}
              aria-hidden="true"
              style={{ animation: 'spin 1s linear infinite' }}
            />
          ) : (
            <Save size={12} aria-hidden="true" />
          )}
          {saveStatus === 'success' && <span style={{ fontSize: 13 }}>✓</span>}
        </button>
      </div>
    </header>
  )
}
