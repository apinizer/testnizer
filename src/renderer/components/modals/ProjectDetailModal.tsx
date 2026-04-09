import { useState, useEffect } from 'react'
import { X, FolderOpen, GitBranch, Globe, Server, Wifi, Save, Eye, EyeOff } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import ProjectIcon from '../shared/ProjectIcon'
import type { Theme, Language } from '../../types'

const COLORS = ['#7c73e6', '#e85d4a', '#f5a623', '#1a7a4a', '#0066cc', '#7c4dff', '#e91e63', '#00897b', '#555555']
const EMOJIS = ['🚀', '⚡', '🔥', '🎯', '🌐', '🔌', '💻', '📡', '🛡️', '⚙️', '📦', '🗄️', '🔑', '💡', '🤖', '🌊']

function applyProjectColor(color: string) {
  const root = document.documentElement
  root.style.setProperty('--accent', color)
  // Generate lighter variant for backgrounds
  root.style.setProperty('--accent-text', color)
}

type Tab = 'general' | 'save' | 'branches' | 'app'

function Label({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
      {text}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Label text={label} />
      <div style={{
        padding: '7px 10px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 7,
        fontSize: 13,
        color: 'var(--text)',
        fontFamily: mono ? "'SF Mono','Cascadia Code','Fira Code',monospace" : 'inherit',
        wordBreak: 'break-all',
      }}>
        {value || <span style={{ color: 'var(--hint)' }}>—</span>}
      </div>
    </div>
  )
}

export default function ProjectDetailModal() {
  const show = useUIStore((s) => s.showProjectDetailModal)
  const setShow = useUIStore((s) => s.setShowProjectDetailModal)
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const renameProject = useWorkspaceStore((s) => s.renameProject)
  const branches = useBranchStore((s) => s.branches)
  const activeBranchId = useBranchStore((s) => s.activeBranchId)

  const [tab, setTab] = useState<Tab>('general')
  const [editing, setEditing] = useState(false)
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

  // Icon/color editing
  const [editIconEmoji, setEditIconEmoji] = useState('')
  const [editIconColor, setEditIconColor] = useState('#7c73e6')
  const [editIconMode, setEditIconMode] = useState<'auto' | 'emoji'>('auto')

  // App settings
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const locale = useUIStore((s) => s.locale)
  const setLocale = useUIStore((s) => s.setLocale)
  const fontSize = useUIStore((s) => s.fontSize)
  const setFontSize = useUIStore((s) => s.setFontSize)

  useEffect(() => {
    if (show && activeProject) {
      setTab('general')
      setEditing(false)
      setEditName(activeProject.name)
      setEditDesc(activeProject.description || '')
      setEditSaveMode(activeProject.save_mode || 'local')
      setEditLocalPath(activeProject.local_path || '')
      setEditGitUrl('')
      setEditGitUser('')
      setEditGitBranch('main')
      setEditGitToken('')
      setShowToken(false)
      setEditIconEmoji(activeProject.icon_emoji || '')
      setEditIconColor(activeProject.icon_color || '#7c73e6')
      setEditIconMode(activeProject.icon_emoji ? 'emoji' : 'auto')

      // Load git config from settings
      loadGitConfig(activeProject.id)
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

  if (!show || !activeProject) return null

  function handleClose() {
    setShow(false)
    setEditing(false)
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

    // Update project name/save settings
    if (editName.trim() !== activeProject.name) {
      await renameProject(activeProject.id, editName.trim())
    }

    const emojiVal = editIconMode === 'emoji' ? editIconEmoji : null
    await updateProject(activeProject.id, {
      save_mode: editSaveMode,
      local_path: editLocalPath || null,
      icon_emoji: emojiVal,
      icon_color: editIconColor,
    })
    // Apply as app accent
    applyProjectColor(editIconColor)

    // Update git config in settings (including token)
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
        } catch {
          // Non-critical
        }
      }
    }

    setSaving(false)
    setEditing(false)
  }

  const typeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    http: { label: 'HTTP / REST', icon: <Globe size={14} /> },
    grpc: { label: 'gRPC', icon: <Server size={14} /> },
    websocket: { label: 'WebSocket', icon: <Wifi size={14} /> },
  }

  const modeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    local: { label: 'Local', icon: <FolderOpen size={14} /> },
    git: { label: 'Git', icon: <GitBranch size={14} /> },
    both: { label: 'Local + Git', icon: <Save size={14} /> },
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'Genel' },
    { id: 'save', label: 'Kayıt Ayarları' },
    { id: 'branches', label: 'Branch\'ler' },
    { id: 'app', label: 'Uygulama' },
  ]

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.28)' }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          borderRadius: 14,
          width: 560,
          maxWidth: '95vw',
          maxHeight: '85vh',
          boxShadow: '0 16px 48px rgba(0,0,0,0.14)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div className="flex items-center gap-3">
              <ProjectIcon name={activeProject.name} color="#5b6af0" size={32} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>
                  {activeProject.name}
                </div>
                <div className="flex items-center gap-2" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {typeLabels[activeProject.type]?.icon}
                  <span>{typeLabels[activeProject.type]?.label || 'HTTP'}</span>
                  <span>·</span>
                  {modeLabels[activeProject.save_mode || 'local']?.icon}
                  <span>{modeLabels[activeProject.save_mode || 'local']?.label}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--hint)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '8px 16px',
                  fontSize: 12.5,
                  fontWeight: tab === t.id ? 600 : 400,
                  color: tab === t.id ? 'var(--accent)' : 'var(--muted)',
                  borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>

          {/* ── General Tab ── */}
          {tab === 'general' && (
            <div>
              {editing ? (
                <div className="flex flex-col gap-3">
                  {/* Preview */}
                  <div className="flex items-center gap-3" style={{ padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <ProjectIcon
                      name={editName}
                      emoji={editIconMode === 'emoji' ? editIconEmoji : undefined}
                      color={editIconColor}
                      size={48}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--heading)' }}>{editName || 'Proje'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Önizleme</div>
                    </div>
                  </div>

                  <div>
                    <Label text="Proje Adı" />
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      style={{
                        width: '100%',
                        background: 'var(--white)',
                        border: '1.5px solid var(--border2)',
                        borderRadius: 7,
                        padding: '7px 10px',
                        fontSize: 13,
                        color: 'var(--text)',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <Label text="Açıklama" />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={2}
                      style={{
                        width: '100%',
                        background: 'var(--white)',
                        border: '1.5px solid var(--border2)',
                        borderRadius: 7,
                        padding: '7px 10px',
                        fontSize: 13,
                        color: 'var(--text)',
                        outline: 'none',
                        resize: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Icon mode */}
                  <div>
                    <Label text="İkon" />
                    <div className="flex gap-2 mb-2">
                      <button type="button" onClick={() => { setEditIconMode('auto'); setEditIconEmoji('') }}
                        style={{ flex: 1, padding: '6px', border: `2px solid ${editIconMode === 'auto' ? editIconColor : 'var(--border)'}`, background: editIconMode === 'auto' ? 'var(--accent-light)' : 'var(--white)', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: editIconMode === 'auto' ? 600 : 400, color: editIconMode === 'auto' ? editIconColor : 'var(--text)' }}>
                        Otomatik
                      </button>
                      <button type="button" onClick={() => setEditIconMode('emoji')}
                        style={{ flex: 1, padding: '6px', border: `2px solid ${editIconMode === 'emoji' ? editIconColor : 'var(--border)'}`, background: editIconMode === 'emoji' ? 'var(--accent-light)' : 'var(--white)', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: editIconMode === 'emoji' ? 600 : 400, color: editIconMode === 'emoji' ? editIconColor : 'var(--text)' }}>
                        Emoji
                      </button>
                    </div>
                    {editIconMode === 'emoji' && (
                      <div className="flex flex-wrap gap-1">
                        {EMOJIS.map((e) => (
                          <div key={e} onClick={() => setEditIconEmoji(e)} className="cursor-pointer"
                            style={{ width: 32, height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, border: `2px solid ${editIconEmoji === e ? editIconColor : 'var(--border)'}`, background: editIconEmoji === e ? 'var(--accent-light)' : 'var(--white)' }}>
                            {e}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Color */}
                  <div>
                    <Label text="Proje Rengi" />
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <div key={c} onClick={() => setEditIconColor(c)} className="cursor-pointer"
                          style={{ width: 28, height: 28, borderRadius: 7, background: c, border: `2.5px solid ${c === editIconColor ? 'var(--heading)' : 'transparent'}`, transform: c === editIconColor ? 'scale(1.15)' : 'scale(1)', transition: 'all 0.15s' }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--hint)', marginTop: 6 }}>
                      Seçilen renk butonlar ve vurgular için uygulanır
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <InfoRow label="Proje Adı" value={activeProject.name} />
                  <InfoRow label="Açıklama" value={activeProject.description || ''} />
                  <InfoRow label="Proje Tipi" value={typeLabels[activeProject.type]?.label || 'HTTP'} />
                  <InfoRow label="Oluşturulma" value={new Date(activeProject.created_at).toLocaleString()} />
                  <InfoRow label="Güncellenme" value={new Date(activeProject.updated_at).toLocaleString()} />
                </div>
              )}
            </div>
          )}

          {/* ── Save Settings Tab ── */}
          {tab === 'save' && (
            <div>
              {editing ? (
                <div className="flex flex-col gap-3">
                  {/* Save mode */}
                  <div>
                    <Label text="Kayıt Modu" />
                    <div className="flex gap-2">
                      {(['local', 'git', 'both'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setEditSaveMode(m)}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            border: `2px solid ${editSaveMode === m ? 'var(--accent)' : 'var(--border)'}`,
                            background: editSaveMode === m ? 'var(--accent-light)' : 'var(--white)',
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: editSaveMode === m ? 600 : 400,
                            color: editSaveMode === m ? 'var(--accent-text)' : 'var(--text)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          {modeLabels[m]?.icon}
                          {modeLabels[m]?.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Local path */}
                  {(editSaveMode === 'local' || editSaveMode === 'both') && (
                    <div>
                      <Label text="Yerel Kayıt Klasörü" />
                      <div className="flex gap-2">
                        <input
                          value={editLocalPath}
                          readOnly
                          placeholder="Klasör seçin..."
                          style={{
                            flex: 1,
                            background: 'var(--white)',
                            border: '1.5px solid var(--border2)',
                            borderRadius: 7,
                            padding: '7px 10px',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: 'var(--text)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleSelectDir}
                          style={{
                            padding: '7px 12px',
                            background: 'var(--bg)',
                            border: '1.5px solid var(--border2)',
                            borderRadius: 7,
                            color: 'var(--muted)',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Seç...
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Git settings */}
                  {(editSaveMode === 'git' || editSaveMode === 'both') && (
                    <div className="flex flex-col gap-2.5">
                      <div>
                        <Label text="Repository URL" />
                        <input
                          value={editGitUrl}
                          onChange={(e) => setEditGitUrl(e.target.value)}
                          placeholder="https://github.com/user/repo.git"
                          style={{
                            width: '100%',
                            background: 'var(--white)',
                            border: '1.5px solid var(--border2)',
                            borderRadius: 7,
                            padding: '7px 10px',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: 'var(--text)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div className="flex gap-2.5">
                        <div className="flex-1">
                          <Label text="Kullanıcı Adı" />
                          <input
                            value={editGitUser}
                            onChange={(e) => setEditGitUser(e.target.value)}
                            placeholder="username"
                            style={{
                              width: '100%',
                              background: 'var(--white)',
                              border: '1.5px solid var(--border2)',
                              borderRadius: 7,
                              padding: '7px 10px',
                              fontSize: 13,
                              color: 'var(--text)',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <Label text="Branch" />
                          <input
                            value={editGitBranch}
                            onChange={(e) => setEditGitBranch(e.target.value)}
                            placeholder="main"
                            style={{
                              width: '100%',
                              background: 'var(--white)',
                              border: '1.5px solid var(--border2)',
                              borderRadius: 7,
                              padding: '7px 10px',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              color: 'var(--text)',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <Label text="Personal Access Token" />
                        <div className="flex gap-2">
                          <input
                            type={showToken ? 'text' : 'password'}
                            value={editGitToken}
                            onChange={(e) => setEditGitToken(e.target.value)}
                            placeholder="Yeni token girin (mevcut korunur)"
                            style={{
                              flex: 1,
                              background: 'var(--white)',
                              border: '1.5px solid var(--border2)',
                              borderRadius: 7,
                              padding: '7px 10px',
                              fontSize: 13,
                              fontFamily: 'monospace',
                              color: 'var(--text)',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowToken((v) => !v)}
                            style={{
                              padding: '7px 10px',
                              background: 'var(--bg)',
                              border: '1.5px solid var(--border2)',
                              borderRadius: 7,
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--hint)', marginTop: 3 }}>
                          Boş bırakırsanız mevcut token korunur
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <InfoRow label="Kayıt Modu" value={modeLabels[activeProject.save_mode || 'local']?.label || 'Local'} />

                  {(activeProject.save_mode === 'local' || activeProject.save_mode === 'both' || !activeProject.save_mode) && (
                    <InfoRow label="Yerel Klasör" value={activeProject.local_path || 'Belirtilmedi'} mono />
                  )}

                  {(activeProject.save_mode === 'git' || activeProject.save_mode === 'both') && (
                    <>
                      <InfoRow label="Git Repository" value={gitConfig?.repoUrl || 'Belirtilmedi'} mono />
                      <InfoRow label="Git Kullanıcı" value={gitConfig?.username || 'Belirtilmedi'} />
                      <InfoRow label="Git Branch" value={gitConfig?.branch || 'main'} mono />
                      <div style={{ marginBottom: 12 }}>
                        <Label text="Personal Access Token" />
                        <div style={{
                          padding: '7px 10px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 7,
                          fontSize: 13,
                          color: 'var(--hint)',
                        }}>
                          {(gitConfig as { token?: string } | null)?.token ? '••••••••••••' : <span style={{ color: 'var(--red)' }}>Token girilmemiş — Düzenle'ye tıklayın</span>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Branches Tab ── */}
          {tab === 'branches' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Branch yönetimi için sağ üstteki branch pill'ini kullanın.
              </div>
              <div className="flex flex-col gap-1">
                {branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="flex items-center gap-2"
                    style={{
                      padding: '8px 12px',
                      background: branch.id === activeBranchId ? 'var(--accent-light)' : 'var(--surface)',
                      border: `1px solid ${branch.id === activeBranchId ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 8,
                      fontSize: 13,
                      color: branch.id === activeBranchId ? 'var(--accent-text)' : 'var(--text)',
                    }}
                  >
                    <GitBranch size={13} />
                    <span style={{ fontWeight: branch.id === activeBranchId ? 600 : 400, fontFamily: 'monospace' }}>
                      {branch.name}
                    </span>
                    {branch.is_default && (
                      <span style={{
                        fontSize: 10,
                        background: 'var(--accent)',
                        color: '#fff',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                      }}>
                        default
                      </span>
                    )}
                    {branch.id === activeBranchId && (
                      <span style={{
                        fontSize: 10,
                        background: 'var(--green-bg)',
                        color: 'var(--green)',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                        border: '1px solid var(--green-border)',
                      }}>
                        aktif
                      </span>
                    )}
                    <span className="flex-1" />
                    <span style={{ fontSize: 10, color: 'var(--hint)' }}>
                      {new Date(branch.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
                {branches.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--hint)', textAlign: 'center', padding: 20 }}>
                    Henüz branch yok
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── App Settings Tab ── */}
          {tab === 'app' && (
            <div className="flex flex-col gap-4">
              {/* Theme */}
              <div>
                <Label text="Tema" />
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTheme(t)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: `2px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`,
                        background: theme === t ? 'var(--accent-light)' : 'var(--white)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: theme === t ? 600 : 400,
                        color: theme === t ? 'var(--accent-text)' : 'var(--text)',
                      }}
                    >
                      {t === 'light' ? 'Açık' : t === 'dark' ? 'Koyu' : 'Sistem'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <Label text="Dil" />
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Language)}
                  style={{
                    width: '100%',
                    background: 'var(--white)',
                    border: '1.5px solid var(--border2)',
                    borderRadius: 7,
                    padding: '7px 10px',
                    fontSize: 13,
                    color: 'var(--text)',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="en">English</option>
                  <option value="tr">Türkçe</option>
                </select>
              </div>

              {/* Font Size */}
              <div>
                <Label text="Yazı Boyutu" />
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={20}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }}
                  />
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    minWidth: 36,
                    textAlign: 'center',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '2px 8px',
                  }}>
                    {fontSize}px
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}
        >
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  padding: '7px 16px',
                  background: 'var(--white)',
                  border: '1.5px solid var(--border2)',
                  borderRadius: 7,
                  color: 'var(--text)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '7px 20px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 7,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: '7px 16px',
                  background: 'var(--white)',
                  border: '1.5px solid var(--border2)',
                  borderRadius: 7,
                  color: 'var(--text)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Kapat
              </button>
              {(tab === 'general' || tab === 'save') && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  style={{
                    padding: '7px 20px',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 7,
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Düzenle
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
