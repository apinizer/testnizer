import { useState, useEffect } from 'react'
import {
  X,
  FolderOpen,
  GitBranch,
  Globe,
  Server,
  Wifi,
  Save,
  Info,
  ShieldCheck,
  Play,
  FlaskConical,
  Braces,
  Database,
  GitMerge,
  Sliders,
  Palette,
  Keyboard,
  HardDrive,
  FileBadge,
  Network,
  RefreshCw,
  HelpCircle,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useTranslation } from '../../lib/i18n'
import ProjectIcon from '../shared/ProjectIcon'
import Modal from '../shared/Modal'
import {
  OverviewPane,
  AuthPane,
  ScriptPane,
  VariablesPane,
  StoragePane,
  BranchesPane,
  GeneralPane,
  ThemesPane,
  ShortcutsPane,
  DataPane,
  CertificatesPane,
  ProxyPane,
  UpdatePane,
  AboutPane,
} from './project-settings-panes'
import type { ProjectSettings, ProjectAuth } from './project-settings-panes'

type Tab =
  | 'overview'
  | 'authorization'
  | 'preRequest'
  | 'tests'
  | 'variables'
  | 'storage'
  | 'branches'
  | 'general'
  | 'themes'
  | 'shortcuts'
  | 'data'
  | 'certificates'
  | 'proxy'
  | 'update'
  | 'about'

const DEFAULT_SETTINGS: ProjectSettings = {
  auth: { type: 'none' },
  preScript:
    '// Runs before every request in this project\n// pm.environment.set("timestamp", Date.now())\n',
  testScript:
    '// Runs after every response in this project\n// pm.test("Status is 2xx", () => pm.response.to.be.ok)\n',
  // Postman-style general settings (apply per-project)
  requestTimeout: 30000,
  maxResponseSizeMb: 50,
  trimRequest: true,
  autoSave: true,
  alwaysOpenNewTab: true,
  askOnClose: true,
  sendNoCache: true,
  sendPostmanToken: true,
  retainHeaders: false,
  sslVerification: true,
  followRedirects: true,
  workingDirectory: '',
  // Proxy
  proxy: { mode: 'system' },
  // Update
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
}

export default function ProjectDetailModal() {
  const { t } = useTranslation()
  const show = useUIStore((s) => s.showProjectDetailModal)
  const setShow = useUIStore((s) => s.setShowProjectDetailModal)
  const setShowEnvironmentModal = useUIStore((s) => s.setShowEnvironmentModal)
  const setShowUpdateModal = useUIStore((s) => s.setShowUpdateModal)
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)

  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const renameProject = useWorkspaceStore((s) => s.renameProject)
  const branches = useBranchStore((s) => s.branches)
  const activeBranchId = useBranchStore((s) => s.activeBranchId)
  const envCount = useEnvironmentStore((s) => s.environments.length)
  const globalVarsCount = useEnvironmentStore((s) => s.globalVariables.length)

  const [tab, setTab] = useState<Tab>('overview')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editSaveMode, setEditSaveMode] = useState<'local' | 'git' | 'both'>('local')
  const [editLocalPath, setEditLocalPath] = useState('')
  const [editGitUrl, setEditGitUrl] = useState('')
  const [editGitUser, setEditGitUser] = useState('')
  const [editGitBranch, setEditGitBranch] = useState('main')
  const [editGitToken, setEditGitToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [gitConfig, setGitConfig] = useState<{
    repoUrl?: string
    username?: string
    branch?: string
    token?: string
  } | null>(null)

  const [editIconEmoji, setEditIconEmoji] = useState('')
  const [editIconColor, setEditIconColor] = useState('#2D5FA0')
  const [editIconMode, setEditIconMode] = useState<'auto' | 'emoji'>('auto')

  const [projSettings, setProjSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS)

  // App-level (shared state)
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const locale = useUIStore((s) => s.locale)
  const setLocale = useUIStore((s) => s.setLocale)
  const fontSize = useUIStore((s) => s.fontSize)
  const setFontSize = useUIStore((s) => s.setFontSize)
  const fontFamily = useUIStore((s) => s.fontFamily)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const accentColor = useUIStore((s) => s.accentColor)
  const setAccentColor = useUIStore((s) => s.setAccentColor)

  useEffect(() => {
    if (show && activeProject) {
      setTab('overview')
      setEditName(activeProject.display_name || activeProject.name)
      setEditDesc(activeProject.description || '')
      setEditSaveMode(activeProject.save_mode || 'local')
      setEditLocalPath(activeProject.local_path || '')
      setEditGitUrl('')
      setEditGitUser('')
      setEditGitBranch('main')
      setEditGitToken('')
      setShowToken(false)
      setEditIconEmoji(activeProject.icon_emoji || '')
      setEditIconColor(activeProject.icon_color || '#2D5FA0')
      setEditIconMode(activeProject.icon_emoji ? 'emoji' : 'auto')
      loadGitConfig(activeProject.id)
      loadProjectSettings(activeProject.id)
    }
  }, [show, activeProject?.id])

  async function loadGitConfig(projectId: string) {
    try {
      const result = (await window.api?.settings?.get(`git.${projectId}`)) as {
        success: boolean
        data?: { repoUrl?: string; username?: string; branch?: string; token?: string }
      }
      if (result?.success && result.data) {
        setGitConfig(result.data)
        setEditGitUrl(result.data.repoUrl || '')
        setEditGitUser(result.data.username || '')
        setEditGitBranch(result.data.branch || 'main')
        setEditGitToken(result.data.token || '')
      } else {
        setGitConfig(null)
      }
    } catch {
      setGitConfig(null)
    }
  }

  async function loadProjectSettings(projectId: string) {
    try {
      const result = (await window.api?.settings?.get(`project.${projectId}.settings`)) as {
        success: boolean
        data?: Partial<ProjectSettings>
      }
      if (result?.success && result.data) {
        setProjSettings({ ...DEFAULT_SETTINGS, ...result.data })
      } else {
        setProjSettings(DEFAULT_SETTINGS)
      }
    } catch {
      setProjSettings(DEFAULT_SETTINGS)
    }
  }

  if (!show || !activeProject) return null

  function handleClose() {
    setShow(false)
    setEditGitToken('')
  }

  async function handleSelectDir() {
    const result = (await window.api?.save?.selectDirectory()) as {
      success: boolean
      data?: string
    }
    if (result?.success && result.data) {
      setEditLocalPath(result.data)
    }
  }

  async function handleSave() {
    if (!activeProject) return
    setSaving(true)

    if (editName.trim() !== (activeProject.display_name || activeProject.name)) {
      await renameProject(activeProject.id, editName.trim())
    }

    const emojiVal = editIconMode === 'emoji' ? editIconEmoji : null
    await updateProject(activeProject.id, {
      save_mode: editSaveMode,
      local_path: editLocalPath || null,
      icon_emoji: emojiVal,
      icon_color: editIconColor,
    })

    if (editSaveMode === 'git' || editSaveMode === 'both') {
      if (editGitUrl) {
        try {
          await window.api?.settings?.set(`git.${activeProject.id}`, {
            repoUrl: editGitUrl,
            username: editGitUser,
            branch: editGitBranch,
            token: editGitToken || '',
          })
          setGitConfig({
            repoUrl: editGitUrl,
            username: editGitUser,
            branch: editGitBranch,
            token: editGitToken || gitConfig?.token,
          })
        } catch {
          /* non-critical */
        }
      }
    }

    try {
      await window.api?.settings?.set(`project.${activeProject.id}.settings`, projSettings)
    } catch {
      /* non-critical */
    }

    setSaving(false)
  }

  const typeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    http: { label: 'HTTP / REST', icon: <Globe size={12} /> },
    grpc: { label: 'gRPC', icon: <Server size={12} /> },
    websocket: { label: 'WebSocket', icon: <Wifi size={12} /> },
  }

  const modeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    local: { label: t('storage.local'), icon: <FolderOpen size={12} /> },
    git: { label: t('storage.git'), icon: <GitBranch size={12} /> },
    both: { label: t('storage.both'), icon: <Save size={12} /> },
  }

  const ALL_TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: t('tab.overview'), icon: <Info size={14} /> },
    { id: 'authorization', label: t('tab.authorization'), icon: <ShieldCheck size={14} /> },
    { id: 'preRequest', label: t('tab.preRequest'), icon: <Play size={14} /> },
    { id: 'tests', label: t('tab.tests'), icon: <FlaskConical size={14} /> },
    { id: 'variables', label: t('tab.variables'), icon: <Braces size={14} /> },
    { id: 'storage', label: t('tab.storage'), icon: <Database size={14} /> },
    { id: 'branches', label: t('tab.branches'), icon: <GitMerge size={14} /> },
    { id: 'general', label: t('tab.general'), icon: <Sliders size={14} /> },
    { id: 'themes', label: t('tab.themes'), icon: <Palette size={14} /> },
    { id: 'shortcuts', label: t('tab.shortcuts'), icon: <Keyboard size={14} /> },
    { id: 'data', label: t('tab.data'), icon: <HardDrive size={14} /> },
    { id: 'certificates', label: t('tab.certificates'), icon: <FileBadge size={14} /> },
    { id: 'proxy', label: t('tab.proxy'), icon: <Network size={14} /> },
    { id: 'update', label: t('tab.update'), icon: <RefreshCw size={14} /> },
    { id: 'about', label: t('tab.about'), icon: <HelpCircle size={14} /> },
  ]

  function updateAuth(patch: Partial<ProjectAuth>) {
    setProjSettings((s) => ({ ...s, auth: { ...s.auth, ...patch } }))
  }

  function updateProjSettings(patch: Partial<ProjectSettings>) {
    setProjSettings((s) => ({ ...s, ...patch }))
  }

  return (
    <Modal
      open={show}
      onOpenChange={(o) => !o && handleClose()}
      title={activeProject.display_name || activeProject.name}
      zIndex={1000}
    >
      <div
        className="flex overflow-hidden"
        style={{
          background: 'var(--white)',
          borderRadius: 14,
          width: 1040,
          maxWidth: '96%',
          height: 680,
          maxHeight: '94vh',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Sidebar */}
        <div
          className="flex w-[240px] shrink-0 flex-col"
          style={{
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Project header */}
          <div
            className="flex items-center gap-3 px-4 py-4"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <ProjectIcon
              name={activeProject.display_name || activeProject.name}
              emoji={activeProject.icon_emoji || undefined}
              color={activeProject.icon_color || '#2D5FA0'}
              size={34}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold" style={{ color: 'var(--heading)' }}>
                {activeProject.display_name || activeProject.name}
              </div>
              <div className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                {typeLabels[activeProject.type]?.icon}
                <span>{typeLabels[activeProject.type]?.label || 'HTTP'}</span>
              </div>
            </div>
          </div>

          {/* Nav */}
          <div className="flex-1 overflow-y-auto py-2">
            {ALL_TABS.map((item) => (
              <SidebarItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                active={tab === item.id}
                onClick={() => setTab(item.id)}
              />
            ))}
          </div>

          {/* Close */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <span style={{ color: 'var(--hint)' }}>
              {modeLabels[activeProject.save_mode || 'local']?.label || 'Local'}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={handleClose}
              className="cursor-pointer rounded p-1"
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {tab === 'overview' && (
              <OverviewPane
                name={editName}
                desc={editDesc}
                iconMode={editIconMode}
                iconEmoji={editIconEmoji}
                iconColor={editIconColor}
                onNameChange={setEditName}
                onDescChange={setEditDesc}
                onIconModeChange={setEditIconMode}
                onIconEmojiChange={setEditIconEmoji}
                onIconColorChange={setEditIconColor}
                typeLabel={typeLabels[activeProject.type]?.label || 'HTTP'}
                createdAt={activeProject.created_at}
                updatedAt={activeProject.updated_at}
              />
            )}
            {tab === 'authorization' && <AuthPane auth={projSettings.auth} onChange={updateAuth} />}
            {tab === 'preRequest' && (
              <ScriptPane
                title={t('tab.preRequest')}
                description={t('script.preRequestDesc')}
                value={projSettings.preScript}
                onChange={(v) => updateProjSettings({ preScript: v })}
                language="javascript"
              />
            )}
            {tab === 'tests' && (
              <ScriptPane
                title={t('tab.tests')}
                description={t('script.testsDesc')}
                value={projSettings.testScript}
                onChange={(v) => updateProjSettings({ testScript: v })}
                language="javascript"
              />
            )}
            {tab === 'variables' && (
              <VariablesPane
                envCount={envCount}
                globalVarsCount={globalVarsCount}
                onOpenManager={() => {
                  setShow(false)
                  setShowEnvironmentModal(true)
                }}
              />
            )}
            {tab === 'storage' && (
              <StoragePane
                projectId={activeProject.id}
                saveMode={editSaveMode}
                localPath={editLocalPath}
                gitUrl={editGitUrl}
                gitUser={editGitUser}
                gitBranch={editGitBranch}
                gitToken={editGitToken}
                showToken={showToken}
                modeLabels={modeLabels}
                onSaveModeChange={setEditSaveMode}
                onLocalPathChange={setEditLocalPath}
                onSelectDir={handleSelectDir}
                onGitUrlChange={setEditGitUrl}
                onGitUserChange={setEditGitUser}
                onGitBranchChange={setEditGitBranch}
                onGitTokenChange={setEditGitToken}
                onToggleShowToken={() => setShowToken((v) => !v)}
              />
            )}
            {tab === 'branches' && (
              <BranchesPane branches={branches} activeBranchId={activeBranchId} />
            )}

            {tab === 'general' && (
              <GeneralPane settings={projSettings} onChange={updateProjSettings} />
            )}
            {tab === 'themes' && (
              <ThemesPane
                theme={theme}
                locale={locale}
                fontSize={fontSize}
                fontFamily={fontFamily}
                accentColor={accentColor}
                onThemeChange={setTheme}
                onLocaleChange={setLocale}
                onFontSizeChange={setFontSize}
                onFontFamilyChange={setFontFamily}
                onAccentColorChange={setAccentColor}
              />
            )}
            {tab === 'shortcuts' && <ShortcutsPane />}
            {tab === 'data' && (
              <DataPane
                projectId={activeProject.id}
                onOpenImport={() => {
                  setShow(false)
                  setShowImportModal(true)
                }}
              />
            )}
            {tab === 'certificates' && (
              <CertificatesPane
                projectId={activeProject.id}
                settings={projSettings}
                onChange={updateProjSettings}
              />
            )}
            {tab === 'proxy' && <ProxyPane settings={projSettings} onChange={updateProjSettings} />}
            {tab === 'update' && (
              <UpdatePane
                settings={projSettings}
                onChange={updateProjSettings}
                onCheckNow={() => {
                  setShow(false)
                  setShowUpdateModal(true)
                }}
              />
            )}
            {tab === 'about' && <AboutPane />}
          </div>

          {/* Footer */}
          <div
            className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              type="button"
              onClick={handleClose}
              className="cursor-pointer rounded-[7px] px-4 py-[7px]"
              style={{
                background: 'var(--white)',
                border: '1.5px solid var(--border2)',
                color: 'var(--text)',
              }}
            >
              {t('modal.close')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer rounded-[7px] px-5 py-[7px] font-semibold"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: '#fff',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? t('modal.saving') : t('modal.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// Sidebar helpers
// ════════════════════════════════════════════════════════════════

function SidebarItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 px-4 py-[7px] text-left"
      style={{
        background: active ? 'var(--accent-light)' : 'transparent',
        border: 'none',
        color: active ? 'var(--accent-text)' : 'var(--text)',
        fontWeight: active ? 600 : 400,
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
