import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, MoreHorizontal, GitBranch, Pencil } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import type { Project } from '../../types'
import ProjectIcon from '../shared/ProjectIcon'
import appIcon from '../../assets/icon.png'

export default function ProjectHome() {
  const projects = useWorkspaceStore((s) => s.projects)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const deleteProject = useWorkspaceStore((s) => s.deleteProject)
  const renameProject = useWorkspaceStore((s) => s.renameProject)
  const setShowNewProjectModal = useUIStore((s) => s.setShowNewProjectModal)
  const { t } = useTranslation()

  const [contextMenuId, setContextMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    function handleClick() { setContextMenuId(null) }
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

  async function handleDeleteProject(id: string) {
    setContextMenuId(null)
    await deleteProject(id)
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

  return (
    <div
      className="flex h-full w-full flex-col items-center overflow-y-auto"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex w-full items-center justify-center" style={{ paddingTop: 60, paddingBottom: 32 }}>
        <div className="flex flex-col items-center gap-3">
          <img src={appIcon} alt="Apinizer" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <h1 className="text-[1.5rem] font-bold" style={{ color: 'var(--heading)' }}>
            Apinizer API Tester
          </h1>
          <p className="text-[0.825rem]" style={{ color: 'var(--muted)' }}>
            {t('home.subtitle')}
          </p>
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
              className="text-[0.75rem]"
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
          <button
            type="button"
            onClick={() => setShowNewProjectModal(true)}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg text-[0.875rem] font-medium"
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
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
                ;(e.currentTarget as HTMLElement).style.boxShadow =
                  '0 2px 8px rgba(124,115,230,0.1)'
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
              }}
            >
              <ProjectIcon name={project.display_name || project.name} emoji={project.icon_emoji || undefined} color={project.icon_color || '#7c73e6'} size={40} />

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
                    className="text-[0.825rem] font-medium"
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
                    className="truncate text-[0.825rem] font-medium"
                    style={{ color: 'var(--heading)' }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleStartRename(project)
                    }}
                  >
                    {project.display_name || project.name}
                  </div>
                )}
                <div className="flex items-center gap-2 text-[0.8rem]" style={{ color: 'var(--muted)' }}>
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
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md text-[0.875rem]"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '6px 8px',
                        color: 'var(--text)',
                        textAlign: 'left',
                      }}
                      onMouseOver={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      <Pencil size={14} />
                      {t('home.rename') || 'Yeniden Adlandır'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteProject(project.id)
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md text-[0.875rem]"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '6px 8px',
                        color: '#cc2200',
                        textAlign: 'left',
                      }}
                      onMouseOver={(e) => {
                        (e.currentTarget as HTMLElement).style.background = '#fff0f0'
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
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
            <p className="mb-1 text-[0.875rem] font-medium" style={{ color: 'var(--text)' }}>
              Henüz proje yok
            </p>
            <p className="mb-4 text-[0.825rem]">{t('home.noProjects')}</p>
            <button
              type="button"
              onClick={() => setShowNewProjectModal(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg text-[0.825rem] font-medium"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                padding: '6px 16px',
              }}
            >
              <Plus size={13} />
              İlk Projeyi Oluştur
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
