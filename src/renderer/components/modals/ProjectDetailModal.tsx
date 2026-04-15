import { useState, useEffect } from 'react'
import {
  X,
  FolderOpen,
  GitBranch,
  Globe,
  Server,
  Wifi,
  Save,
  Eye,
  EyeOff,
  Info,
  ShieldCheck,
  Play,
  FlaskConical,
  Braces,
  Database,
  GitMerge,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import ProjectIcon from '../shared/ProjectIcon'
import MonacoWrapper from '../shared/MonacoWrapper'
import type { Theme, Language } from '../../types'

const COLORS = ['#2D5FA0', '#e85d4a', '#f5a623', '#1a7a4a', '#0066cc', '#7c4dff', '#e91e63', '#00897b', '#555555']
const EMOJIS = ['🚀', '⚡', '🔥', '🎯', '🌐', '🔌', '💻', '📡', '🛡️', '⚙️', '📦', '🗄️', '🔑', '💡', '🤖', '🌊']

function applyProjectColor(color: string) {
  const root = document.documentElement
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-text', color)
}

type Tab =
  | 'overview'
  | 'authorization'
  | 'preRequest'
  | 'tests'
  | 'variables'
  | 'storage'
  | 'branches'
  | 'app'

interface ProjectSettings {
  auth: {
    type: 'none' | 'inherit' | 'basic' | 'bearer' | 'api-key'
    bearerToken?: string
    basicUser?: string
    basicPass?: string
    apiKeyKey?: string
    apiKeyValue?: string
    apiKeyIn?: 'header' | 'query'
  }
  preScript: string
  testScript: string
}

const DEFAULT_SETTINGS: ProjectSettings = {
  auth: { type: 'none' },
  preScript: '// Runs before every request in this project\n// pm.environment.set("timestamp", Date.now())\n',
  testScript: '// Runs after every response in this project\n// pm.test("Status is 2xx", () => pm.response.to.be.ok)\n',
}

export default function ProjectDetailModal() {
  const show = useUIStore((s) => s.showProjectDetailModal)
  const setShow = useUIStore((s) => s.setShowProjectDetailModal)
  const setShowEnvironmentModal = useUIStore((s) => s.setShowEnvironmentModal)
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
  const [gitConfig, setGitConfig] = useState<{ repoUrl?: string; username?: string; branch?: string; token?: string } | null>(null)

  const [editIconEmoji, setEditIconEmoji] = useState('')
  const [editIconColor, setEditIconColor] = useState('#2D5FA0')
  const [editIconMode, setEditIconMode] = useState<'auto' | 'emoji'>('auto')

  // Project-level Postman-style settings (auth / pre / tests)
  const [projSettings, setProjSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS)

  // App-level
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const locale = useUIStore((s) => s.locale)
  const setLocale = useUIStore((s) => s.setLocale)
  const fontSize = useUIStore((s) => s.fontSize)
  const setFontSize = useUIStore((s) => s.setFontSize)

  // Load project data when opening
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
      const result = await window.api?.settings?.get(`git.${projectId}`) as { success: boolean; data?: { repoUrl?: string; username?: string; branch?: string; token?: string } }
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
      const result = await window.api?.settings?.get(`project.${projectId}.settings`) as {
        success: boolean
        data?: ProjectSettings
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
    const result = await window.api?.save?.selectDirectory() as { success: boolean; data?: string }
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
    applyProjectColor(editIconColor)

    if (editSaveMode === 'git' || editSaveMode === 'both') {
      if (editGitUrl) {
        try {
          await window.api?.settings?.set(`git.${activeProject.id}`, {
            repoUrl: editGitUrl,
            username: editGitUser,
            branch: editGitBranch,
            token: editGitToken || '',
          })
          setGitConfig({ repoUrl: editGitUrl, username: editGitUser, branch: editGitBranch, token: editGitToken || gitConfig?.token })
        } catch { /* non-critical */ }
      }
    }

    // Persist Postman-style project settings
    try {
      await window.api?.settings?.set(`project.${activeProject.id}.settings`, projSettings)
    } catch { /* non-critical */ }

    setSaving(false)
  }

  const typeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    http: { label: 'HTTP / REST', icon: <Globe size={12} /> },
    grpc: { label: 'gRPC', icon: <Server size={12} /> },
    websocket: { label: 'WebSocket', icon: <Wifi size={12} /> },
  }

  const modeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    local: { label: 'Local', icon: <FolderOpen size={12} /> },
    git: { label: 'Git', icon: <GitBranch size={12} /> },
    both: { label: 'Local + Git', icon: <Save size={12} /> },
  }

  const SIDEBAR_TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; group?: string }> = [
    { id: 'overview', label: 'Overview', icon: <Info size={14} /> },
    { id: 'authorization', label: 'Authorization', icon: <ShieldCheck size={14} /> },
    { id: 'preRequest', label: 'Pre-request Script', icon: <Play size={14} /> },
    { id: 'tests', label: 'Tests', icon: <FlaskConical size={14} /> },
    { id: 'variables', label: 'Variables', icon: <Braces size={14} /> },
    { id: 'storage', label: 'Storage', icon: <Database size={14} />, group: 'Apinizer' },
    { id: 'branches', label: 'Branches', icon: <GitMerge size={14} /> },
    { id: 'app', label: 'App Settings', icon: <SettingsIcon size={14} /> },
  ]

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex overflow-hidden"
        style={{
          background: 'var(--white)',
          borderRadius: 14,
          width: 960,
          maxWidth: '96%',
          height: 640,
          maxHeight: '92vh',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Sidebar */}
        <div
          className="flex w-[230px] shrink-0 flex-col"
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
            <SidebarGroup title="Project Settings">
              {SIDEBAR_TABS.filter((t) => !t.group).map((item) => (
                <SidebarItem
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  active={tab === item.id}
                  onClick={() => setTab(item.id)}
                />
              ))}
            </SidebarGroup>
            <SidebarGroup title="Apinizer">
              {SIDEBAR_TABS.filter((t) => t.group === 'Apinizer').map((item) => (
                <SidebarItem
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  active={tab === item.id}
                  onClick={() => setTab(item.id)}
                />
              ))}
              {/* Extra app-level tabs that don't belong to 'Apinizer' group but are shown at bottom */}
              <SidebarItem
                label="Branches"
                icon={<GitMerge size={14} />}
                active={tab === 'branches'}
                onClick={() => setTab('branches')}
              />
              <SidebarItem
                label="App Settings"
                icon={<SettingsIcon size={14} />}
                active={tab === 'app'}
                onClick={() => setTab('app')}
              />
            </SidebarGroup>
          </div>

          {/* Close */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <span style={{ color: 'var(--hint)', fontSize: 13 }}>
              {modeLabels[activeProject.save_mode || 'local']?.label || 'Local'}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="cursor-pointer rounded p-1"
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            >
              <X size={14} />
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
              <AuthPane
                settings={projSettings}
                onChange={(a) => setProjSettings((s) => ({ ...s, auth: { ...s.auth, ...a } }))}
              />
            )}

            {tab === 'preRequest' && (
              <ScriptPane
                title="Pre-request Script"
                description="This script runs before every request in this project. Use `pm.environment.set(...)` to stage values."
                value={projSettings.preScript}
                onChange={(v) => setProjSettings((s) => ({ ...s, preScript: v }))}
                language="javascript"
              />
            )}

            {tab === 'tests' && (
              <ScriptPane
                title="Tests"
                description="This script runs after every response. Use `pm.test(...)` and `pm.expect(...)` to assert."
                value={projSettings.testScript}
                onChange={(v) => setProjSettings((s) => ({ ...s, testScript: v }))}
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
                saveMode={editSaveMode}
                localPath={editLocalPath}
                gitUrl={editGitUrl}
                gitUser={editGitUser}
                gitBranch={editGitBranch}
                gitToken={editGitToken}
                showToken={showToken}
                gitConfig={gitConfig}
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

            {tab === 'app' && (
              <AppSettingsPane
                theme={theme}
                locale={locale}
                fontSize={fontSize}
                onThemeChange={setTheme}
                onLocaleChange={setLocale}
                onFontSizeChange={setFontSize}
              />
            )}
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
              Close
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
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Sidebar helpers
// ════════════════════════════════════════════════════════════════

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div
        className="px-4 py-1 font-semibold uppercase tracking-wide"
        style={{ color: 'var(--hint)' }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

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
      className="flex w-full cursor-pointer items-center gap-2 px-4 py-[7px] text-left text-[12.5px]"
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

// ════════════════════════════════════════════════════════════════
// Panes
// ════════════════════════════════════════════════════════════════

function PaneHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[16px] font-semibold" style={{ color: 'var(--heading)' }}>{title}</div>
      {subtitle && (
        <div className="mt-0.5" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function Label({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: 'var(--muted)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 5,
      }}
    >
      {text}
    </div>
  )
}

const BASE_INP: React.CSSProperties = {
  width: '100%',
  background: 'var(--input-bg)',
  border: '1.5px solid var(--border2)',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

function OverviewPane(props: {
  name: string
  desc: string
  iconMode: 'auto' | 'emoji'
  iconEmoji: string
  iconColor: string
  onNameChange: (v: string) => void
  onDescChange: (v: string) => void
  onIconModeChange: (v: 'auto' | 'emoji') => void
  onIconEmojiChange: (v: string) => void
  onIconColorChange: (v: string) => void
  typeLabel: string
  createdAt: number
  updatedAt: number
}) {
  return (
    <div className="p-6">
      <PaneHeader
        title="Overview"
        subtitle="Basic information about this collection."
      />

      <div className="flex flex-col gap-4">
        <div>
          <Label text="Name" />
          <input
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            style={BASE_INP}
          />
        </div>

        <div>
          <Label text="Description" />
          <textarea
            value={props.desc}
            onChange={(e) => props.onDescChange(e.target.value)}
            rows={3}
            style={{ ...BASE_INP, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label text="Icon" />
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() => { props.onIconModeChange('auto'); props.onIconEmojiChange('') }}
                className="flex-1 cursor-pointer rounded-[7px] py-1.5"
                style={{
                  border: `1.5px solid ${props.iconMode === 'auto' ? 'var(--accent)' : 'var(--border2)'}`,
                  background: props.iconMode === 'auto' ? 'var(--accent-light)' : 'var(--white)',
                  color: props.iconMode === 'auto' ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.iconMode === 'auto' ? 600 : 400,
                }}
              >
                Initials
              </button>
              <button
                type="button"
                onClick={() => props.onIconModeChange('emoji')}
                className="flex-1 cursor-pointer rounded-[7px] py-1.5"
                style={{
                  border: `1.5px solid ${props.iconMode === 'emoji' ? 'var(--accent)' : 'var(--border2)'}`,
                  background: props.iconMode === 'emoji' ? 'var(--accent-light)' : 'var(--white)',
                  color: props.iconMode === 'emoji' ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.iconMode === 'emoji' ? 600 : 400,
                }}
              >
                Emoji
              </button>
            </div>
            {props.iconMode === 'emoji' && (
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => props.onIconEmojiChange(e)}
                    className="cursor-pointer"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      border: `1.5px solid ${props.iconEmoji === e ? 'var(--accent)' : 'var(--border)'}`,
                      background: props.iconEmoji === e ? 'var(--accent-light)' : 'var(--white)',
                      fontSize: 16,
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label text="Accent Color" />
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => props.onIconColorChange(c)}
                  className="cursor-pointer"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: c,
                    border: `2.5px solid ${c === props.iconColor ? 'var(--heading)' : 'transparent'}`,
                    transform: c === props.iconColor ? 'scale(1.12)' : 'scale(1)',
                    transition: 'all 0.15s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div
          className="mt-2 grid grid-cols-3 gap-4 rounded-[8px] p-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <MetaField label="Type" value={props.typeLabel} />
          <MetaField label="Created" value={new Date(props.createdAt).toLocaleDateString()} />
          <MetaField label="Updated" value={new Date(props.updatedAt).toLocaleDateString()} />
        </div>
      </div>
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="uppercase tracking-wide" style={{ color: 'var(--hint)' }}>{label}</div>
      <div className="mt-0.5" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function AuthPane({
  settings,
  onChange,
}: {
  settings: ProjectSettings
  onChange: (updates: Partial<ProjectSettings['auth']>) => void
}) {
  const { auth } = settings
  return (
    <div className="p-6">
      <PaneHeader
        title="Authorization"
        subtitle="This authorization method will be used by every request in this collection."
      />

      <div className="flex flex-col gap-4">
        <div>
          <Label text="Type" />
          <select
            value={auth.type}
            onChange={(e) => onChange({ type: e.target.value as ProjectSettings['auth']['type'] })}
            style={{ ...BASE_INP, cursor: 'pointer' }}
          >
            <option value="none">No Auth</option>
            <option value="inherit">Inherit from parent</option>
            <option value="basic">Basic Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="api-key">API Key</option>
          </select>
        </div>

        {auth.type === 'bearer' && (
          <div>
            <Label text="Token" />
            <input
              value={auth.bearerToken || ''}
              onChange={(e) => onChange({ bearerToken: e.target.value })}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}

        {auth.type === 'basic' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label text="Username" />
              <input
                value={auth.basicUser || ''}
                onChange={(e) => onChange({ basicUser: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text="Password" />
              <input
                type="password"
                value={auth.basicPass || ''}
                onChange={(e) => onChange({ basicPass: e.target.value })}
                style={BASE_INP}
              />
            </div>
          </div>
        )}

        {auth.type === 'api-key' && (
          <div className="grid grid-cols-[1fr_1fr_120px] gap-3">
            <div>
              <Label text="Key" />
              <input
                value={auth.apiKeyKey || ''}
                onChange={(e) => onChange({ apiKeyKey: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text="Value" />
              <input
                value={auth.apiKeyValue || ''}
                onChange={(e) => onChange({ apiKeyValue: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text="Add to" />
              <select
                value={auth.apiKeyIn || 'header'}
                onChange={(e) => onChange({ apiKeyIn: e.target.value as 'header' | 'query' })}
                style={{ ...BASE_INP, cursor: 'pointer' }}
              >
                <option value="header">Header</option>
                <option value="query">Query Params</option>
              </select>
            </div>
          </div>
        )}

        {auth.type === 'none' && (
          <div
            className="rounded-[8px] p-4"
            style={{
              background: 'var(--surface)',
              border: '1px dashed var(--border2)',
              color: 'var(--muted)',
            }}
          >
            This collection uses <strong>no authorization</strong>. Individual requests can still override this.
          </div>
        )}
      </div>
    </div>
  )
}

function ScriptPane({
  title,
  description,
  value,
  onChange,
  language,
}: {
  title: string
  description: string
  value: string
  onChange: (v: string) => void
  language: string
}) {
  return (
    <div className="flex h-full flex-col p-6">
      <PaneHeader title={title} subtitle={description} />
      <div
        className="flex-1 overflow-hidden rounded-[8px]"
        style={{ border: '1px solid var(--border2)', minHeight: 320 }}
      >
        <MonacoWrapper
          value={value}
          onChange={onChange}
          language={language}
          lineNumbers="on"
          height="100%"
        />
      </div>
    </div>
  )
}

function VariablesPane({
  envCount,
  globalVarsCount,
  onOpenManager,
}: {
  envCount: number
  globalVarsCount: number
  onOpenManager: () => void
}) {
  return (
    <div className="p-6">
      <PaneHeader
        title="Variables"
        subtitle="Variables let you reuse values across requests. Globals are shared within this project."
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Environments" value={envCount} />
        <StatCard label="Global Variables" value={globalVarsCount} />
      </div>

      <button
        type="button"
        onClick={onOpenManager}
        className="mt-5 cursor-pointer rounded-[7px] px-4 py-2 font-semibold"
        style={{
          background: 'var(--accent)',
          border: 'none',
          color: '#fff',
        }}
      >
        Open Environment Manager
      </button>

      <div
        className="mt-5 rounded-[8px] p-4"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
      >
        Reference variables using <code style={{ color: 'var(--json-string)' }}>{'{{variableName}}'}</code> in URLs,
        headers, and bodies. Environment values override globals when both are set.
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="mt-1 text-[24px] font-semibold" style={{ color: 'var(--heading)' }}>{value}</div>
    </div>
  )
}

function StoragePane(props: {
  saveMode: 'local' | 'git' | 'both'
  localPath: string
  gitUrl: string
  gitUser: string
  gitBranch: string
  gitToken: string
  showToken: boolean
  gitConfig: { repoUrl?: string; username?: string; branch?: string; token?: string } | null
  modeLabels: Record<string, { label: string; icon: React.ReactNode }>
  onSaveModeChange: (v: 'local' | 'git' | 'both') => void
  onLocalPathChange: (v: string) => void
  onSelectDir: () => void
  onGitUrlChange: (v: string) => void
  onGitUserChange: (v: string) => void
  onGitBranchChange: (v: string) => void
  onGitTokenChange: (v: string) => void
  onToggleShowToken: () => void
}) {
  return (
    <div className="p-6">
      <PaneHeader
        title="Storage"
        subtitle="Where this project's collection is persisted — local filesystem, a Git repo, or both."
      />

      <div className="flex flex-col gap-4">
        <div>
          <Label text="Save Mode" />
          <div className="flex gap-2">
            {(['local', 'git', 'both'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => props.onSaveModeChange(m)}
                className="flex-1 cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  border: `2px solid ${props.saveMode === m ? 'var(--accent)' : 'var(--border)'}`,
                  background: props.saveMode === m ? 'var(--accent-light)' : 'var(--white)',
                  color: props.saveMode === m ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.saveMode === m ? 600 : 400,
                }}
              >
                {props.modeLabels[m]?.icon}
                {props.modeLabels[m]?.label}
              </button>
            ))}
          </div>
        </div>

        {(props.saveMode === 'local' || props.saveMode === 'both') && (
          <div>
            <Label text="Local Folder" />
            <div className="flex gap-2">
              <input
                value={props.localPath}
                readOnly
                placeholder="Select folder…"
                style={{ ...BASE_INP, fontFamily: 'var(--font-mono)', flex: 1 }}
              />
              <button
                type="button"
                onClick={props.onSelectDir}
                className="cursor-pointer rounded-[7px] px-3"
                style={{
                  background: 'var(--surface)',
                  border: '1.5px solid var(--border2)',
                  color: 'var(--text)',
                }}
              >
                Browse…
              </button>
            </div>
          </div>
        )}

        {(props.saveMode === 'git' || props.saveMode === 'both') && (
          <div className="flex flex-col gap-3 rounded-[8px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Git Repository
            </div>
            <div>
              <Label text="URL" />
              <input
                value={props.gitUrl}
                onChange={(e) => props.onGitUrlChange(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label text="Username" />
                <input value={props.gitUser} onChange={(e) => props.onGitUserChange(e.target.value)} style={BASE_INP} />
              </div>
              <div>
                <Label text="Branch" />
                <input
                  value={props.gitBranch}
                  onChange={(e) => props.onGitBranchChange(e.target.value)}
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
            <div>
              <Label text="Personal Access Token" />
              <div className="flex gap-2">
                <input
                  type={props.showToken ? 'text' : 'password'}
                  value={props.gitToken}
                  onChange={(e) => props.onGitTokenChange(e.target.value)}
                  placeholder="Leave empty to keep existing token"
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)', flex: 1 }}
                />
                <button
                  type="button"
                  onClick={props.onToggleShowToken}
                  className="cursor-pointer rounded-[7px] px-3"
                  style={{
                    background: 'var(--white)',
                    border: '1.5px solid var(--border2)',
                    color: 'var(--muted)',
                  }}
                >
                  {props.showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="mt-1" style={{ color: 'var(--hint)' }}>
                Token is encrypted and stored in electron-store.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BranchesPane({
  branches,
  activeBranchId,
}: {
  branches: Array<{ id: string; name: string; is_default: boolean; created_at: number }>
  activeBranchId: string | null
}) {
  return (
    <div className="p-6">
      <PaneHeader
        title="Branches"
        subtitle="Manage branches for this project. Use the header branch pill to switch quickly."
      />

      <div className="flex flex-col gap-1">
        {branches.length === 0 && (
          <div
            className="rounded-[8px] p-6 text-center"
            style={{ background: 'var(--surface)', border: '1px dashed var(--border2)', color: 'var(--hint)' }}
          >
            No branches yet.
          </div>
        )}
        {branches.map((branch) => {
          const isActive = branch.id === activeBranchId
          return (
            <div
              key={branch.id}
              className="flex items-center gap-2 rounded-[8px] px-4 py-2"
              style={{
                background: isActive ? 'var(--accent-light)' : 'var(--surface)',
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                color: isActive ? 'var(--accent-text)' : 'var(--text)',
              }}
            >
              <GitBranch size={13} />
              <span className="font-mono" style={{ fontWeight: isActive ? 600 : 400 }}>{branch.name}</span>
              {branch.is_default && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  default
                </span>
              )}
              {isActive && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{
                    background: 'var(--green-bg)',
                    color: 'var(--green)',
                    border: '1px solid var(--green-border)',
                  }}
                >
                  active
                </span>
              )}
              <span className="flex-1" />
              <span style={{ color: 'var(--hint)' }}>
                {new Date(branch.created_at).toLocaleDateString()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AppSettingsPane({
  theme,
  locale,
  fontSize,
  onThemeChange,
  onLocaleChange,
  onFontSizeChange,
}: {
  theme: Theme
  locale: Language
  fontSize: number
  onThemeChange: (v: Theme) => void
  onLocaleChange: (v: Language) => void
  onFontSizeChange: (v: number) => void
}) {
  return (
    <div className="p-6">
      <PaneHeader title="App Settings" subtitle="Preferences that apply to the entire application." />

      <div className="flex flex-col gap-5">
        <div>
          <Label text="Theme" />
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onThemeChange(t)}
                className="flex-1 cursor-pointer rounded-[8px] px-3 py-2"
                style={{
                  border: `2px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme === t ? 'var(--accent-light)' : 'var(--white)',
                  color: theme === t ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: theme === t ? 600 : 400,
                }}
              >
                {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label text="Language" />
          <select
            value={locale}
            onChange={(e) => onLocaleChange(e.target.value as Language)}
            style={{ ...BASE_INP, cursor: 'pointer' }}
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </div>

        <div>
          <Label text="Font Size" />
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={20}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span
              className="rounded-[6px] px-2 py-0.5 font-semibold"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', minWidth: 40, textAlign: 'center' }}
            >
              {fontSize}px
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
