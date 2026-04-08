import { useState } from 'react'
import { Plus, FolderOpen, Trash2, MoreHorizontal } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import type { Project } from '../../types'
import appIcon from '../../assets/icon.png'

export default function ProjectHome() {
  const projects = useWorkspaceStore((s) => s.projects)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const createProject = useWorkspaceStore((s) => s.createProject)
  const deleteProject = useWorkspaceStore((s) => s.deleteProject)
  const { t } = useTranslation()

  const [showCreate, setShowCreate] = useState(projects.length === 0)
  const [newName, setNewName] = useState('')
  const [projectType, setProjectType] = useState<'http' | 'grpc' | 'websocket'>('http')
  const [isCreating, setIsCreating] = useState(false)
  const [contextMenuId, setContextMenuId] = useState<string | null>(null)

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setIsCreating(true)
    const id = await createProject(name, projectType)
    setIsCreating(false)
    if (id) {
      setNewName('')
      setShowCreate(false)
      setActiveProject(id)
    }
  }

  function handleOpenProject(project: Project) {
    setActiveProject(project.id)
  }

  async function handleDeleteProject(id: string) {
    setContextMenuId(null)
    await deleteProject(id)
  }

  const typeLabels: Record<string, string> = {
    http: 'HTTP',
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
          <h2 className="text-[1rem] font-semibold" style={{ color: 'var(--heading)' }}>
            {t('home.projects')}
          </h2>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
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

        {/* Create project card */}
        {showCreate && (
          <div
            className="rounded-xl"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--accent)',
              padding: 20,
              marginBottom: 12,
            }}
          >
            <div className="text-[0.825rem] font-semibold" style={{ color: 'var(--heading)', marginBottom: 12 }}>
              {t('home.createProject')}
            </div>

            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') {
                  setShowCreate(false)
                  setNewName('')
                }
              }}
              placeholder={t('home.projectNamePlaceholder')}
              autoFocus
              className="w-full rounded-lg border text-[0.825rem] outline-none"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border2)',
                padding: '8px 12px',
                color: 'var(--text)',
                marginBottom: 12,
              }}
            />

            {/* Type selection */}
            <div className="flex gap-2" style={{ marginBottom: 16 }}>
              {(['http', 'grpc', 'websocket'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setProjectType(type)}
                  className="cursor-pointer rounded-lg text-[0.875rem]"
                  style={{
                    background: projectType === type ? 'var(--accent-light)' : 'var(--bg)',
                    border: projectType === type ? '1px solid var(--accent)' : '1px solid var(--border)',
                    color: projectType === type ? 'var(--accent-text)' : 'var(--muted)',
                    padding: '4px 12px',
                    fontWeight: projectType === type ? 500 : 400,
                  }}
                >
                  {typeLabels[type]}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || isCreating}
                className="cursor-pointer rounded-lg text-[0.875rem] font-medium text-white"
                style={{
                  background: newName.trim() ? 'var(--accent)' : 'var(--border2)',
                  border: 'none',
                  padding: '6px 20px',
                  opacity: isCreating ? 0.7 : 1,
                }}
              >
                {isCreating ? t('home.creating') : t('home.create')}
              </button>
              {projects.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false)
                    setNewName('')
                  }}
                  className="cursor-pointer rounded-lg text-[0.875rem]"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    padding: '6px 16px',
                    color: 'var(--muted)',
                  }}
                >
                  {t('home.cancel')}
                </button>
              )}
            </div>
          </div>
        )}

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
                ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(124,115,230,0.1)'
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
              }}
            >
              <div
                className="flex shrink-0 items-center justify-center rounded-lg"
                style={{ width: 40, height: 40, background: 'var(--accent-light)' }}
              >
                <FolderOpen size={20} style={{ color: 'var(--accent)' }} />
              </div>

              <div className="flex-1 overflow-hidden">
                <div className="truncate text-[0.825rem] font-medium" style={{ color: 'var(--heading)' }}>
                  {project.name}
                </div>
                <div className="text-[0.8rem]" style={{ color: 'var(--muted)' }}>
                  {typeLabels[project.type] || 'HTTP'} &middot;{' '}
                  {new Date(project.created_at).toLocaleDateString()}
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

        {/* Empty state when no projects and create form is hidden */}
        {projects.length === 0 && !showCreate && (
          <div className="flex flex-col items-center py-16" style={{ color: 'var(--muted)' }}>
            <FolderOpen size={48} style={{ marginBottom: 12, opacity: 0.4 }} />
            <p className="text-[0.825rem]">{t('home.noProjects')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
