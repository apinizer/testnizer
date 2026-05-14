import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, MoreHorizontal, GitBranch, Pencil, Upload } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { isMac } from '../../lib/platform'
import type { Project } from '../../types'
import ProjectIcon from '../shared/ProjectIcon'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import appIcon from '../../assets/icon.png'

export default function ProjectHome() {
  const projects = useWorkspaceStore((s) => s.projects)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const fetchProjects = useWorkspaceStore((s) => s.fetchProjects)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const deleteProject = useWorkspaceStore((s) => s.deleteProject)
  const renameProject = useWorkspaceStore((s) => s.renameProject)
  const setShowNewProjectModal = useUIStore((s) => s.setShowNewProjectModal)
  const { t } = useTranslation()

  const api = () => window.api

  async function handleImportProject() {
    if (!activeWorkspaceId) return
    try {
      const result = await api().save?.importProject?.({ workspaceId: activeWorkspaceId })
      if (result?.success && result.data?.projectId) {
        await fetchProjects(activeWorkspaceId)
        setActiveProject(result.data.projectId)
        toast.success(t('toast.projectImported'))
      } else if (result?.error && result.error !== 'Cancelled') {
        // Surface the underlying reason (parse error, invalid format,
        // missing file, etc.) so the user knows why nothing happened.
        console.error('Import project failed:', result.error)
        toast.error(`${t('toast.projectImportFailed')}: ${result.error}`)
      }
    } catch (err) {
      console.error(err)
      toast.error(`${t('toast.projectImportFailed')}: ${(err as Error).message || String(err)}`)
    }
  }

  const [contextMenuId, setContextMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  // Close context menu on outside click
  useEffect(() => {
    function handleClick() {
      setContextMenuId(null)
    }
    if (contextMenuId) document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [contextMenuId])

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  function handleOpenProject(project: Project) {
    if (renamingId === project.id) return
    setActiveProject(project.id)
  }

  function handleDeleteProject(project: Project) {
    setContextMenuId(null)
    setDeleteTarget(project)
  }

  async function confirmDeleteProject() {
    if (!deleteTarget) return
    await deleteProject(deleteTarget.id)
    setDeleteTarget(null)
  }

  function handleStartRename(project: Project) {
    setContextMenuId(null)
    setRenamingId(project.id)
    setRenameValue(project.display_name || project.name)
  }

  async function handleConfirmRename(id: string) {
    if (renameValue.trim() && renameValue.trim() !== projects.find((p) => p.id === id)?.name) {
      await renameProject(id, renameValue.trim())
    }
    setRenamingId(null)
  }

  const typeLabels: Record<string, string> = {
    http: 'HTTP / REST',
    grpc: 'gRPC',
    websocket: 'WebSocket',
  }

  const authUser = useAuthStore((s) => s.user)
  const setShowProfileModal = useUIStore((s) => s.setShowProfileModal)
  const setShowAboutModal = useUIStore((s) => s.setShowAboutModal)

  return (
    <div
      className="relative flex h-full w-full flex-col items-center overflow-y-auto"
      style={{ background: 'var(--bg)' }}
    >
      {/* About button — top left.
          On macOS the renderer sits flush against the window edge under
          `titleBarStyle: hiddenInset`, and the traffic lights at x=12
          occupy roughly 12-82px. Push the button past that on mac so it
          doesn't slip under the close/min/max controls. */}
      <button
        type="button"
        onClick={() => setShowAboutModal(true)}
        className="absolute top-4 z-10 cursor-pointer rounded-md border bg-transparent px-2.5 py-1 transition-colors"
        style={{
          left: isMac() ? 92 : 20,
          borderColor: 'var(--border)',
          color: 'var(--muted)',
          fontSize: 13,
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.color = 'var(--muted)'
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        }}
      >
        {t('header.about')}
      </button>

      {/* Profile avatar — top right */}
      {authUser && (
        <div
          className="absolute right-5 top-4 z-10 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
          onClick={() => setShowProfileModal(true)}
          style={{ background: 'transparent' }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <div
            className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
            style={{
              width: 28,
              height: 28,
              background: authUser.avatarUrl ? 'transparent' : 'var(--accent)',
              fontSize: 13,
              overflow: 'hidden',
            }}
          >
            {authUser.avatarUrl ? (
              <img
                src={authUser.avatarUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              (() => {
                const name = authUser.displayName || authUser.username
                const parts = name.trim().split(/\s+/)
                return parts.length >= 2
                  ? (parts[0][0] + parts[1][0]).toUpperCase()
                  : name.substring(0, 2).toUpperCase()
              })()
            )}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
            {authUser.displayName || authUser.username}
          </span>
        </div>
      )}

      {/* Header */}
      <div
        className="flex w-full items-center justify-center"
        style={{ paddingTop: 60, paddingBottom: 32 }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: '#fff',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={appIcon}
              alt="Testnizer"
              style={{ width: 52, height: 52, borderRadius: 12 }}
            />
          </div>
          <h1 className="text-[1.5rem] font-bold" style={{ color: 'var(--heading)' }}>
            Testnizer
          </h1>
          <p style={{ color: 'var(--muted)' }}>{t('home.subtitle')}</p>
        </div>
      </div>

      {/* Content area */}
      <div style={{ width: '100%', maxWidth: 640, padding: '0 24px' }}>
        {/* Section header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-2">
            <h2 className="text-[1rem] font-semibold" style={{ color: 'var(--heading)' }}>
              {t('home.projects')}
            </h2>
            <span
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '1px 8px',
                color: 'var(--muted)',
              }}
            >
              {projects.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleImportProject}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg font-medium"
              style={{
                background: 'var(--white)',
                color: 'var(--text)',
                border: '1px solid var(--border2)',
                padding: '6px 14px',
              }}
              title={t('home.importTitle')}
            >
              <Upload size={14} />
              {t('home.import')}
            </button>
            <button
              type="button"
              onClick={() => setShowNewProjectModal(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg font-medium"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
              }}
            >
              <Plus size={14} />
              {t('home.newProject')}
            </button>
          </div>
        </div>

        {/* Project list */}
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group flex cursor-pointer items-center gap-3 rounded-xl transition-all"
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                padding: '14px 16px',
              }}
              onClick={() => handleOpenProject(project)}
              onMouseOver={(e) => {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
                ;(e.currentTarget as HTMLElement).style.boxShadow =
                  '0 2px 8px rgba(124,115,230,0.1)'
              }}
              onMouseOut={(e) => {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
              }}
            >
              <ProjectIcon
                name={project.display_name || project.name}
                emoji={project.icon_emoji || undefined}
                color={project.icon_color || '#2D5FA0'}
                size={40}
              />

              <div className="flex-1 overflow-hidden">
                {renamingId === project.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmRename(project.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => handleConfirmRename(project.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium"
                    style={{
                      color: 'var(--heading)',
                      background: 'var(--surface)',
                      border: '1.5px solid var(--accent)',
                      borderRadius: 4,
                      padding: '1px 6px',
                      outline: 'none',
                      width: '100%',
                    }}
                  />
                ) : (
                  <div
                    className="truncate font-medium"
                    style={{ color: 'var(--heading)' }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleStartRename(project)
                    }}
                  >
                    {project.display_name || project.name}
                  </div>
                )}
                <div className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                  <span>{typeLabels[project.type] || 'HTTP'}</span>
                  <span>&middot;</span>
                  <span className="flex items-center gap-1">
                    <GitBranch size={10} />
                    main
                  </span>
                  <span>&middot;</span>
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Context menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setContextMenuId(contextMenuId === project.id ? null : project.id)
                  }}
                  className="hidden cursor-pointer rounded-md group-hover:flex"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 4,
                    color: 'var(--muted)',
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>

                {contextMenuId === project.id && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      zIndex: 100,
                      background: 'var(--white)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 4,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                      minWidth: 140,
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartRename(project)
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '6px 8px',
                        color: 'var(--text)',
                        textAlign: 'left',
                      }}
                      onMouseOver={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                      }}
                      onMouseOut={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      <Pencil size={14} />
                      {t('home.rename')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteProject(project)
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '6px 8px',
                        color: '#cc2200',
                        textAlign: 'left',
                      }}
                      onMouseOver={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = '#fff0f0'
                      }}
                      onMouseOut={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      <Trash2 size={14} />
                      {t('home.delete')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {projects.length === 0 && (
          <div
            className="flex flex-col items-center rounded-xl py-16"
            style={{
              color: 'var(--muted)',
              background: 'var(--white)',
              border: '1px dashed var(--border2)',
            }}
          >
            <div
              className="mb-4 flex items-center justify-center rounded-full"
              style={{ width: 56, height: 56, background: 'var(--bg)' }}
            >
              <Plus size={24} style={{ color: 'var(--hint)' }} />
            </div>
            <p className="mb-1 font-medium" style={{ color: 'var(--text)' }}>
              {t('home.noProjectsYet')}
            </p>
            <p className="mb-4">{t('home.noProjects')}</p>
            <button
              type="button"
              onClick={() => setShowNewProjectModal(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg font-medium"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                padding: '6px 16px',
              }}
            >
              <Plus size={13} />
              {t('home.createFirstProject')}
            </button>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.display_name || deleteTarget?.name || ''}
        itemType={t('home.projectLabel')}
        requireTyping
        description={t('home.deleteProjectDesc')}
        onConfirm={confirmDeleteProject}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
