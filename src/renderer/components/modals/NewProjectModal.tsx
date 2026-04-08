import { useState, useEffect } from 'react'
import { Check, Globe, Server, Wifi, FolderOpen, GitBranch, TrendingUp, Eye, EyeOff } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import ProjectIcon from '../shared/ProjectIcon'

const COLORS = ['#7c73e6', '#e85d4a', '#f5a623', '#1a7a4a', '#0066cc', '#7c4dff', '#e91e63', '#00897b', '#555555']
const EMOJIS = ['🚀', '⚡', '🔥', '🎯', '🌐', '🔌', '💻', '📡', '🛡️', '⚙️', '📦', '🗄️', '🔑', '💡', '🤖', '🌊']

type ProjectType = 'http' | 'grpc' | 'websocket'
type SaveMode = 'local' | 'git' | 'both'
type IconOption = 'auto' | 'emoji'

function StepDot({ step, current }: { step: number; current: number }) {
  const done = step < current
  const active = step === current
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: done ? '#1a7a4a' : active ? '#7c73e6' : 'var(--surface)',
        color: done || active ? 'white' : '#aaa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
        transition: 'all 0.2s',
      }}
    >
      {done ? <Check size={12} /> : step}
    </div>
  )
}

function TypeCard({
  label,
  sub,
  icon,
  active,
  onClick,
}: {
  label: string
  sub: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer"
      style={{
        flex: 1,
        padding: '10px 12px',
        border: `2px solid ${active ? '#7c73e6' : 'var(--border)'}`,
        background: active ? 'var(--accentLight)' : 'var(--white)',
        borderRadius: 9,
        transition: 'all 0.15s',
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: 3, color: active ? 'var(--accentText)' : 'var(--text)' }}
      >
        {icon}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
    </div>
  )
}

function ModeCard({
  label,
  sub,
  icon,
  active,
  onClick,
}: {
  label: string
  sub: string
  icon?: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer"
      style={{
        flex: 1,
        padding: '12px 14px',
        border: `2px solid ${active ? '#7c73e6' : 'var(--border)'}`,
        background: active ? 'var(--accentLight)' : 'var(--white)',
        borderRadius: 10,
        transition: 'all 0.15s',
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: 3, color: active ? 'var(--accentText)' : 'var(--text)' }}
      >
        {icon}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
    </div>
  )
}

function Label({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 5,
      }}
    >
      {text}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  style: extraStyle,
  autoFocus,
  type = 'text',
}: {
  value: string
  onChange: (val: string) => void
  placeholder: string
  style?: React.CSSProperties
  autoFocus?: boolean
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
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
        ...extraStyle,
      }}
    />
  )
}

export default function NewProjectModal() {
  const show = useUIStore((s) => s.showNewProjectModal)
  const setShow = useUIStore((s) => s.setShowNewProjectModal)
  const createProject = useWorkspaceStore((s) => s.createProject)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const ensureDefault = useBranchStore((s) => s.ensureDefault)
  const createBranch = useBranchStore((s) => s.createBranch)

  const [step, setStep] = useState(1)
  const [done, setDone] = useState(false)

  // Step 1
  const [projName, setProjName] = useState('')
  const [projDesc, setProjDesc] = useState('')
  const [projType, setProjType] = useState<ProjectType>('http')
  const [branchName, setBranchName] = useState('main')
  const [nameError, setNameError] = useState(false)

  // Step 2
  const [iconOpt, setIconOpt] = useState<IconOption>('auto')
  const [selectedColor, setSelectedColor] = useState('#7c73e6')
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [customEmoji, setCustomEmoji] = useState('')

  // Step 3
  const [saveMode, setSaveMode] = useState<SaveMode>('local')
  const [localFolder, setLocalFolder] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitUser, setGitUser] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitToken, setGitToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const activeEmoji = iconOpt === 'emoji' ? (selectedEmoji || customEmoji) : ''

  // Reset when modal opens
  useEffect(() => {
    if (show) {
      setStep(1)
      setDone(false)
      setProjName('')
      setProjDesc('')
      setProjType('http')
      setBranchName('main')
      setNameError(false)
      setIconOpt('auto')
      setSelectedColor('#7c73e6')
      setSelectedEmoji('')
      setCustomEmoji('')
      setSaveMode('local')
      setLocalFolder('')
      setGitUrl('')
      setGitUser('')
      setGitBranch('main')
      setGitToken('')
      setShowToken(false)
      setIsCreating(false)
    }
  }, [show])

  // Clean up token on unmount
  useEffect(() => {
    return () => {
      setGitToken('')
    }
  }, [])

  if (!show) return null

  function handleClose() {
    setGitToken('')
    setShow(false)
  }

  async function handleSelectDir() {
    const result = await window.api?.save?.selectDirectory() as { success: boolean; data?: string }
    if (result?.success && result.data) {
      setLocalFolder(result.data)
    }
  }

  async function goNext() {
    if (step === 1) {
      if (!projName.trim()) {
        setNameError(true)
        setTimeout(() => setNameError(false), 1500)
        return
      }
    }

    if (step === 3) {
      // Create
      setIsCreating(true)
      try {
        const typeMap: Record<ProjectType, 'http' | 'grpc' | 'websocket'> = {
          http: 'http',
          grpc: 'grpc',
          websocket: 'websocket',
        }
        const projectId = await createProject(projName.trim(), typeMap[projType] || 'http')
        if (projectId) {
          // Create the named branch (or ensure default)
          if (branchName.trim() && branchName.trim() !== 'main') {
            await ensureDefault(projectId)
            await createBranch(projectId, branchName.trim())
          } else {
            await ensureDefault(projectId)
          }

          // Save git credentials if git mode
          if ((saveMode === 'git' || saveMode === 'both') && gitUrl && gitToken) {
            try {
              await window.api?.settings?.set(`git.${projectId}`, {
                repoUrl: gitUrl,
                username: gitUser,
                branch: gitBranch,
              })
            } catch {
              // Non-critical
            }
          }

          setDone(true)

          // Auto-open project after short delay
          setTimeout(() => {
            setActiveProject(projectId)
            setShow(false)
          }, 1200)
        }
      } catch {
        // Error
      }
      setIsCreating(false)
      return
    }

    setStep((s) => s + 1)
  }

  const stepLabels = ['Proje Bilgileri', 'İkon & Görünüm', 'Kayıt Ayarları']

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
          width: 580,
          maxWidth: '95vw',
          boxShadow: '0 16px 48px rgba(0,0,0,0.14)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--heading)' }}>
              Yeni Proje Oluştur
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 20,
                color: 'var(--hint)',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          {/* Steps */}
          <div className="flex items-center" style={{ paddingBottom: 14 }}>
            {[1, 2, 3].map((s, i) => (
              <div key={s} className="flex items-center" style={{ flex: i < 2 ? 1 : 0 }}>
                <div className="flex items-center gap-2">
                  <StepDot step={s} current={step} />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: s === step ? 500 : 400,
                      color:
                        s < step
                          ? 'var(--green)'
                          : s === step
                            ? 'var(--accent)'
                            : 'var(--hint)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {stepLabels[i]}
                  </span>
                </div>
                {i < 2 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: 'var(--border)',
                      margin: '0 10px',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '22px 24px', minHeight: 340 }}>
          {/* ── STEP 1 ── */}
          {step === 1 && !done && (
            <div className="flex flex-col gap-4">
              <div>
                <Label text="Proje Adı *" />
                <input
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="örn: Payment Service API"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') goNext()
                  }}
                  style={{
                    width: '100%',
                    background: 'var(--white)',
                    border: `1.5px solid ${nameError ? '#cc2200' : 'var(--border2)'}`,
                    borderRadius: 7,
                    padding: '7px 10px',
                    fontSize: 13,
                    color: 'var(--text)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {nameError && (
                  <div style={{ fontSize: 11, color: '#cc2200', marginTop: 4 }}>
                    Proje adı gereklidir
                  </div>
                )}
              </div>
              <div>
                <Label text="Açıklama" />
                <textarea
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder="Proje hakkında kısa bir açıklama..."
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
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <Label text="Proje Tipi" />
                <div className="flex gap-2">
                  <TypeCard
                    label="HTTP / REST"
                    sub="REST, SOAP, GraphQL, SSE"
                    active={projType === 'http'}
                    onClick={() => setProjType('http')}
                    icon={<Globe size={14} />}
                  />
                  <TypeCard
                    label="gRPC"
                    sub="Protocol Buffers"
                    active={projType === 'grpc'}
                    onClick={() => setProjType('grpc')}
                    icon={<Server size={14} />}
                  />
                  <TypeCard
                    label="WebSocket"
                    sub="Realtime"
                    active={projType === 'websocket'}
                    onClick={() => setProjType('websocket')}
                    icon={<Wifi size={14} />}
                  />
                </div>
              </div>
              <div>
                <Label text="İlk Branch Adı" />
                <Input
                  value={branchName}
                  onChange={setBranchName}
                  placeholder="main"
                  style={{ fontFamily: 'monospace' }}
                />
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                  Sonradan yeni branch'ler ekleyebilirsiniz
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && !done && (
            <div>
              {/* Preview */}
              <div
                className="flex items-center gap-4 rounded-xl"
                style={{
                  padding: 16,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  marginBottom: 20,
                }}
              >
                <ProjectIcon
                  name={projName}
                  emoji={activeEmoji}
                  color={selectedColor}
                  size={56}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--heading)' }}>
                    {projName || 'Proje Adı'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Proje görünümü önizlemesi
                  </div>
                </div>
              </div>

              {/* Icon option */}
              <div style={{ marginBottom: 18 }}>
                <Label text="İkon Seçeneği" />
                <div className="mb-3 flex gap-2">
                  <ModeCard
                    label="Otomatik"
                    sub="İsmin baş harfleri"
                    active={iconOpt === 'auto'}
                    onClick={() => {
                      setIconOpt('auto')
                      setSelectedEmoji('')
                    }}
                  />
                  <ModeCard
                    label="Emoji"
                    sub="Bir emoji seçin"
                    active={iconOpt === 'emoji'}
                    onClick={() => setIconOpt('emoji')}
                  />
                </div>

                {iconOpt === 'emoji' && (
                  <div>
                    <Label text="Emoji Seç" />
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {EMOJIS.map((e) => (
                        <div
                          key={e}
                          onClick={() => {
                            setSelectedEmoji(e)
                            setCustomEmoji('')
                          }}
                          className="cursor-pointer"
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 20,
                            border: `2px solid ${selectedEmoji === e ? 'var(--accent)' : 'var(--border)'}`,
                            background:
                              selectedEmoji === e ? 'var(--accentLight)' : 'var(--white)',
                            transition: 'all 0.15s',
                          }}
                        >
                          {e}
                        </div>
                      ))}
                    </div>
                    <input
                      value={customEmoji}
                      onChange={(e) => {
                        setCustomEmoji(e.target.value)
                        setSelectedEmoji('')
                      }}
                      placeholder="ya da buraya yapıştır: 🚀"
                      style={{
                        width: '100%',
                        background: 'var(--white)',
                        border: '1.5px solid var(--border2)',
                        borderRadius: 7,
                        padding: '7px 10px',
                        fontSize: 18,
                        color: 'var(--text)',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Color */}
              <div>
                <Label text="Renk" />
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((col) => (
                    <div
                      key={col}
                      onClick={() => setSelectedColor(col)}
                      className="cursor-pointer"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: col,
                        border: `2px solid ${col === selectedColor ? 'var(--heading)' : 'transparent'}`,
                        transform: col === selectedColor ? 'scale(1.15)' : 'scale(1)',
                        transition: 'all 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3 ── */}
          {step === 3 && !done && (
            <div>
              <div style={{ marginBottom: 18 }}>
                <Label text="Kayıt Modu" />
                <div className="mb-3 flex gap-2">
                  <ModeCard
                    label="Local"
                    sub="Sadece bu bilgisayarda"
                    icon={<FolderOpen size={14} />}
                    active={saveMode === 'local'}
                    onClick={() => setSaveMode('local')}
                  />
                  <ModeCard
                    label="Git"
                    sub="GitHub / GitLab"
                    icon={<GitBranch size={14} />}
                    active={saveMode === 'git'}
                    onClick={() => setSaveMode('git')}
                  />
                  <ModeCard
                    label="Her İkisi"
                    sub="Local + Git yedekli"
                    icon={<TrendingUp size={14} />}
                    active={saveMode === 'both'}
                    onClick={() => setSaveMode('both')}
                  />
                </div>

                {(saveMode === 'local' || saveMode === 'both') && (
                  <div style={{ marginBottom: 12 }}>
                    <Label text="Yerel Kayıt Klasörü" />
                    <div className="flex gap-2">
                      <input
                        value={localFolder}
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
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Seç...
                      </button>
                    </div>
                  </div>
                )}

                {(saveMode === 'git' || saveMode === 'both') && (
                  <div className="flex flex-col gap-2.5">
                    <div>
                      <Label text="Repository URL" />
                      <Input
                        value={gitUrl}
                        onChange={setGitUrl}
                        placeholder="https://github.com/kullanici/repo.git"
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                      />
                    </div>
                    <div className="flex gap-2.5">
                      <div className="flex-1">
                        <Label text="Kullanıcı adı" />
                        <Input value={gitUser} onChange={setGitUser} placeholder="github-kullanici" />
                      </div>
                      <div className="flex-1">
                        <Label text="Branch" />
                        <Input
                          value={gitBranch}
                          onChange={setGitBranch}
                          placeholder="main"
                          style={{ fontFamily: 'monospace' }}
                        />
                      </div>
                    </div>
                    <div>
                      <Label text="Personal Access Token" />
                      <div className="flex gap-2">
                        <input
                          type={showToken ? 'text' : 'password'}
                          value={gitToken}
                          onChange={(e) => setGitToken(e.target.value)}
                          placeholder="ghp_xxxxxxxxxxxx"
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
                            fontSize: 12,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                        Token şifreli saklanır · Settings → Developer settings → PAT
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div
                className="rounded-xl"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  padding: 14,
                }}
              >
                <Label text="Proje Özeti" />
                <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                  <ProjectIcon
                    name={projName}
                    emoji={activeEmoji}
                    color={selectedColor}
                    size={36}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--heading)' }}>
                      {projName || 'Proje'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {projType === 'http'
                        ? 'HTTP / REST'
                        : projType === 'grpc'
                          ? 'gRPC'
                          : 'WebSocket'}{' '}
                      · {branchName} branch
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {saveMode === 'local' && `Local kayıt${localFolder ? `: ${localFolder}` : ''}`}
                  {saveMode === 'git' && `Git: ${gitUrl || 'repo belirtilmedi'}`}
                  {saveMode === 'both' && 'Local + Git yedekli kayıt'}
                </div>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {done && (
            <div className="py-5 text-center">
              <div
                className="mx-auto mb-4 flex items-center justify-center rounded-full"
                style={{
                  width: 52,
                  height: 52,
                  background: '#1a7a4a',
                }}
              >
                <Check size={24} color="white" />
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, color: 'var(--heading)' }}>
                Proje Oluşturuldu!
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                "{projName}" başarıyla oluşturuldu
              </div>
              <button
                type="button"
                onClick={() => {
                  handleClose()
                }}
                className="cursor-pointer"
                style={{
                  padding: '8px 24px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 7,
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Projeyi Aç
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div
            className="flex items-center justify-between"
            style={{ padding: '14px 24px', borderTop: '1px solid var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="cursor-pointer"
              style={{
                padding: '7px 16px',
                background: 'var(--white)',
                border: '1.5px solid var(--border2)',
                borderRadius: 7,
                color: 'var(--text)',
                fontSize: 13,
                visibility: step > 1 ? 'visible' : 'hidden',
              }}
            >
              ← Geri
            </button>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: s === step ? 'var(--accent)' : 'var(--border)',
                    transition: 'all 0.2s',
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={isCreating}
              className="cursor-pointer"
              style={{
                padding: '8px 20px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 7,
                color: 'white',
                fontWeight: 600,
                fontSize: 13,
                opacity: isCreating ? 0.7 : 1,
              }}
            >
              {isCreating ? 'Oluşturuluyor...' : step === 3 ? 'Oluştur ✓' : 'Devam →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
