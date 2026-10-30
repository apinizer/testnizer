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
import { toast } from '../../lib/toast'
import {
  OverviewPane,
  AuthPane,
  ScriptPane,
  VariablesPane,
  StoragePane,
  BranchesPane,
  GeneralPane,
  AppearanceLinkPane,
  ShortcutsPane,
  DataPane,
  CertificatesPane,
  ProxyPane,
  UpdatePane,
  AboutPane,
} from './project-settings-panes'
import type { AppNetworkDefaults, ProjectSettings, ProjectAuth } from './project-settings-panes'
import { loadInheritedNetwork } from '../../lib/network-settings'
import { useSettingsSwitch } from './use-settings-switch'

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
  // Postman-style general settings (apply per-project). requestTimeout /
  // sslVerification / followRedirects / proxy: deliberately NOT defaulted
  // (issues #287, #254) — unset = follow the app Settings; a default here was
  // written on the first Save and made the app value dead for the project.
  maxResponseSizeMb: 50,
  trimRequest: true,
  autoSave: true,
  alwaysOpenNewTab: true,
  askOnClose: true,
  sendNoCache: true,
  sendPostmanToken: true,
  retainHeaders: false,
  workingDirectory: '',
  // Update
  autoCheckUpdates: true,
  autoDownloadUpdates: true,
}

export default function ProjectDetailModal() {
  const { t } = useTranslation()
  const show = useUIStore((s) => s.showProjectDetailModal)
  const setShow = useUIStore((s) => s.setShowProjectDetailModal)
  const setShowEnvironmentModal = useUIStore((s) => s.setShowEnvironmentModal)
  const setShowUpdateModal = useUIStore((s) => s.setShowUpdateModal)
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)
  const setShowSettingsModal = useUIStore((s) => s.setShowSettingsModal)
  const setAccentColor = useUIStore((s) => s.setAccentColor)

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
  // What the dialog loaded — the unsaved-changes guard compares against it (#254).
  const [settingsBaseline, setSettingsBaseline] = useState(JSON.stringify(DEFAULT_SETTINGS))
  // The app Settings values an unset project field shows (#287, #254).
  const [appNet, setAppNet] = useState<AppNetworkDefaults>({})

  const dirty =
    !!activeProject &&
    (JSON.stringify(projSettings) !== settingsBaseline ||
      editName !== (activeProject.display_name || activeProject.name) ||
      editDesc !== (activeProject.description || '') ||
      editSaveMode !== (activeProject.save_mode || 'local') ||
      editLocalPath !== (activeProject.local_path || '') ||
      editIconColor !== (activeProject.icon_color || '#2D5FA0') ||
      (editIconMode === 'emoji' ? editIconEmoji : '') !== (activeProject.icon_emoji || '') ||
      editGitUrl !== (gitConfig?.repoUrl || '') ||
      editGitUser !== (gitConfig?.username || '') ||
      editGitBranch !== (gitConfig?.branch || 'main') ||
      editGitToken !== (gitConfig?.token || ''))

  // Issue #254: "Open App settings" (header + Themes link) with the guard.
  const toApp = useSettingsSwitch({
    dirty,
    target: t('settingsScope.targetApp'),
    save: () => handleSave(),
    discard: () => {},
    switchTo: () => {
      handleClose()
      setShowSettingsModal(true)
    },
  })

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
      setGitConfig(null)
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
    void loadInheritedNetwork(null).then((n) =>
      setAppNet({
        sslVerification: n.appSslVerification,
        followRedirects: n.appFollowRedirects,
        timeout: n.appTimeout,
        proxy: n.appProxy,
      }),
    )
    let loaded = DEFAULT_SETTINGS
    try {
      const result = (await window.api?.settings?.get(`project.${projectId}.settings`)) as {
        success: boolean
        data?: Partial<ProjectSettings>
      }
      if (result?.success && result.data) loaded = { ...DEFAULT_SETTINGS, ...result.data }
    } catch {
      /* defaults */
    }
    setProjSettings(loaded)
    setSettingsBaseline(JSON.stringify(loaded))
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

  /** Persist everything; `true` only when every write landed (the dialog then closes). */
  async function handleSave(): Promise<boolean> {
    if (!activeProject) return false
    setSaving(true)

    try {
      // Every write below used to be swallowed as "non-critical" while the
      // success toast fired regardless — so a failed rename, git-config or
      // project-settings save was all reported as "Project settings saved".
      // They are part of what the button promises; a failure has to surface.
      const failures: string[] = []

      if (editName.trim() !== (activeProject.display_name || activeProject.name)) {
        // The store swallowed this outcome entirely: the re-fetch put the old
        // name back on screen while the toast still said "saved".
        if (!(await renameProject(activeProject.id, editName.trim()))) {
          failures.push(`${t('overview.name')}: ${t('settings.saveFailed')}`)
        }
      }

      const emojiVal = editIconMode === 'emoji' ? editIconEmoji : null
      if (
        !(await updateProject(activeProject.id, {
          // The Description box was rendered, edited and then silently dropped:
          // it never reached this payload, so "Project settings saved" was true
          // about every field except the one the user had just typed into.
          description: editDesc,
          save_mode: editSaveMode,
          local_path: editLocalPath || null,
          icon_emoji: emojiVal,
          icon_color: editIconColor,
        }))
      ) {
        failures.push(t('settings.saveFailed'))
      } else if (editIconColor !== (activeProject.icon_color || '#2D5FA0')) {
        // The project colour is the accent of the open project (issue #37);
        // the Themes pane used to apply it live — now Overview does, on Save.
        setAccentColor(editIconColor)
      }

      /**
       * `settings:set` REPORTS failure as `{success:false, error}` and never
       * rejects — so wrapping it in try/catch alone caught nothing that actually
       * happens, and the success toast fired over a write that did not land.
       * Both shapes are handled here: the envelope and a genuine throw.
       */
      const persist = async (label: string, key: string, value: unknown): Promise<boolean> => {
        try {
          const res = (await window.api?.settings?.set(key, value)) as
            | { success?: boolean; error?: string }
            | undefined
          if (res && res.success === false) throw new Error(res.error ?? 'unknown error')
          return true
        } catch (e) {
          failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
          return false
        }
      }

      if (editSaveMode === 'git' || editSaveMode === 'both') {
        if (editGitUrl) {
          const ok = await persist('Git', `git.${activeProject.id}`, {
            repoUrl: editGitUrl,
            username: editGitUser,
            branch: editGitBranch,
            // Empty field = keep the stored token (matches the placeholder
            // hint); previously this wiped it (issue #127 follow-up).
            token: editGitToken || gitConfig?.token || '',
          })
          // Only mirror into local state once the write is known to have landed.
          if (ok) {
            setGitConfig({
              repoUrl: editGitUrl,
              username: editGitUser,
              branch: editGitBranch,
              token: editGitToken || gitConfig?.token,
            })
          }
        }
      }

      await persist('Settings', `project.${activeProject.id}.settings`, projSettings)

      if (failures.length > 0) {
        // Same channel the outer catch uses, and the modal stays open.
        toast.error(`Save failed: ${failures.join(' · ')}`)
        return false
      }

      toast.success(t('modal.saved') || 'Project settings saved')
      handleClose()
      return true
    } catch (e) {
      // Surface save failures instead of silently closing the modal — without
      // this, a renameProject / updateProject reject left the user thinking
      // their change had landed (v1.4.0 review finding).
      toast.error(`Save failed: ${(e as Error).message}`)
      return false
    } finally {
      setSaving(false)
    }
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

  const dialogTitle = t('settingsScope.projectTitle').replace(
    '{name}',
    activeProject.display_name || activeProject.name,
  )

  return (
    <Modal
      open={show}
      onOpenChange={(o) => !o && handleClose()}
      title={dialogTitle}
      testId="project-detail-modal"
    >
      <div
        className="flex flex-col overflow-hidden"
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
        {/* Title bar — says the scope and links to the app-wide dialog (issue #254) */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-2.5">
          <span
            data-testid="project-settings-title"
            className="truncate font-semibold text-[var(--heading)]"
          >
            {dialogTitle}
          </span>
          <button
            type="button"
            data-testid="settings-open-app-settings"
            onClick={toApp.request}
            className="shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            {t('settingsScope.openAppSettings')}
          </button>
        </div>
        {toApp.dialog}
        <div className="flex min-h-0 flex-1 overflow-hidden">
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
                  testId={`project-detail-tab-${item.id}`}
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
                aria-label={t('common.close')}
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
              {tab === 'authorization' && (
                <AuthPane auth={projSettings.auth} onChange={updateAuth} />
              )}
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
                <GeneralPane
                  settings={projSettings}
                  onChange={updateProjSettings}
                  appDefaults={appNet}
                />
              )}
              {/* Issue #254: theme / language / font are app-wide (ui.store) —
                only a link row here. The project colour (accent, issue #37)
                stays in Overview, where it is saved as icon_color. */}
              {tab === 'themes' && <AppearanceLinkPane onOpenApp={toApp.request} />}
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
                  appDefaults={appNet}
                />
              )}
              {tab === 'proxy' && (
                <ProxyPane
                  settings={projSettings}
                  onChange={updateProjSettings}
                  appDefaults={appNet}
                />
              )}
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
                onClick={() => void handleSave()}
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
  testId,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
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
