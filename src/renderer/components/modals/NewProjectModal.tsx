import { useState, useEffect } from 'react'
import {
  Check,
  Globe,
  Server,
  Wifi,
  FolderOpen,
  GitBranch,
  TrendingUp,
  Eye,
  EyeOff,
  Plus,
  Download,
  Folder,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import { useTranslation } from '../../lib/i18n'
import ProjectIcon from '../shared/ProjectIcon'
import Modal from '../shared/Modal'

const COLORS = [
  '#2D5FA0',
  '#e85d4a',
  '#f5a623',
  '#1a7a4a',
  '#0066cc',
  '#7c4dff',
  '#e91e63',
  '#00897b',
  '#555555',
]
const EMOJIS = [
  '🚀',
  '⚡',
  '🔥',
  '🎯',
  '🌐',
  '🔌',
  '💻',
  '📡',
  '🛡️',
  '⚙️',
  '📦',
  '🗄️',
  '🔑',
  '💡',
  '🤖',
  '🌊',
]

type ProjectType = 'http' | 'grpc' | 'websocket'
type SaveMode = 'local' | 'git' | 'both'
type IconOption = 'auto' | 'emoji'
type ProjectSource = 'new' | 'git' | 'local'

/* ── Shared small components ── */

function StepDot({ step, current }: { step: number; current: number }) {
  const done = step < current
  const active = step === current
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--surface)',
        color: done || active ? 'white' : 'var(--hint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 600,
        flexShrink: 0,
        transition: 'all 0.2s',
        border: !done && !active ? '1px solid var(--border)' : 'none',
      }}
    >
      {done ? <Check size={11} /> : step}
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
        letterSpacing: '0.05em',
        marginBottom: 5,
      }}
    >
      {text}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

function OptionCard({
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
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent-light)' : 'var(--white)',
        borderRadius: 8,
        transition: 'all 0.15s',
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{
          marginBottom: 2,
          color: active ? 'var(--accent-text)' : 'var(--text)',
        }}
      >
        {icon}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{sub}</div>
    </div>
  )
}

/* ── Main component ── */

export default function NewProjectModal() {
  const show = useUIStore((s) => s.showNewProjectModal)
  const setShow = useUIStore((s) => s.setShowNewProjectModal)
  const createProject = useWorkspaceStore((s) => s.createProject)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const ensureDefault = useBranchStore((s) => s.ensureDefault)
  const createBranch = useBranchStore((s) => s.createBranch)
  const { t } = useTranslation()

  const [step, setStep] = useState(1)
  const [done, setDone] = useState(false)

  // Step 1 — source
  const [source, setSource] = useState<ProjectSource>('new')
  const [gitCloneUrl, setGitCloneUrl] = useState('')
  const [gitCloneUser, setGitCloneUser] = useState('')
  const [gitCloneBranch, setGitCloneBranch] = useState('main')
  const [gitCloneToken, setGitCloneToken] = useState('')
  const [gitCloneDir, setGitCloneDir] = useState('')
  const [showCloneToken, setShowCloneToken] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const [localFilePath, setLocalFilePath] = useState('')
  const [localFileData, setLocalFileData] = useState<{
    project?: { name?: string; description?: string }
  } | null>(null)

  // Step 2 — details
  const [projName, setProjName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [projDesc, setProjDesc] = useState('')
  const [projType, setProjType] = useState<ProjectType>('http')
  const [branchName, setBranchName] = useState('main')
  const [nameError, setNameError] = useState(false)
  const [iconOpt, setIconOpt] = useState<IconOption>('auto')
  const [selectedColor, setSelectedColor] = useState('#2D5FA0')
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [customEmoji, setCustomEmoji] = useState('')

  // Step 3 — storage
  const [saveMode, setSaveMode] = useState<SaveMode>('local')
  const [localFolder, setLocalFolder] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitUser, setGitUser] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitToken, setGitToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const activeEmoji = iconOpt === 'emoji' ? selectedEmoji || customEmoji : ''

  useEffect(() => {
    if (show) {
      setStep(1)
      setDone(false)
      setSource('new')
      setGitCloneUrl('')
      setGitCloneUser('')
      setGitCloneBranch('main')
      setGitCloneToken('')
      setGitCloneDir('')
      setShowCloneToken(false)
      setCloning(false)
      setCloneError('')
      setLocalFilePath('')
      setLocalFileData(null)
      setProjName('')
      setDisplayName('')
      setSlugManuallyEdited(false)
      setProjDesc('')
      setProjType('http')
      setBranchName('main')
      setNameError(false)
      setIconOpt('auto')
      setSelectedColor('#2D5FA0')
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

  useEffect(() => {
    return () => {
      setGitToken('')
      setGitCloneToken('')
    }
  }, [])

  if (!show) return null

  function handleClose() {
    setGitToken('')
    setGitCloneToken('')
    setShow(false)
  }

  async function handleSelectDir(setter: (v: string) => void) {
    const result = (await window.api?.save?.selectDirectory()) as {
      success: boolean
      data?: string
    }
    if (result?.success && result.data) setter(result.data)
  }

  async function handleCloneAndImport() {
    if (!gitCloneUrl || !gitCloneDir) return
    setCloning(true)
    setCloneError('')
    try {
      // Clone and list files
      const listResult = (await window.api?.save?.gitListFiles({
        repoUrl: gitCloneUrl,
        branch: gitCloneBranch,
        username: gitCloneUser,
        token: gitCloneToken,
      })) as {
        success: boolean
        data?: { tmpDir: string; files: { name: string; path: string }[]; isEmpty?: boolean }
        error?: string
      }

      if (!listResult?.success) {
        setCloneError(listResult?.error || 'Git bağlantısı başarısız.')
        setCloning(false)
        return
      }

      // Empty repo — no files yet, that's OK — create new project and push later
      if (listResult.data?.isEmpty || !listResult.data?.files?.length) {
        if (listResult.data?.tmpDir) {
          await window.api?.save?.gitCleanup(listResult.data.tmpDir)
        }
      } else {
        // Read first project file
        const fileResult = (await window.api?.save?.gitReadFile(listResult.data.files[0].path)) as {
          success: boolean
          data?: { project?: { name?: string }; version?: string }
        }

        if (fileResult?.success && fileResult.data?.project?.name) {
          const importedName = fileResult.data.project.name
          setDisplayName(importedName)
          setProjName(
            importedName
              .toLowerCase()
              .replace(/[^a-zA-Z0-9\s\-_]/g, '')
              .replace(/\s+/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, ''),
          )
        }

        // Cleanup tmp
        await window.api?.save?.gitCleanup(listResult.data.tmpDir)
      }

      // Pre-fill git settings for step 3
      setGitUrl(gitCloneUrl)
      setGitUser(gitCloneUser)
      setGitBranch(gitCloneBranch)
      setGitToken(gitCloneToken)
      setSaveMode('both')
      setLocalFolder(gitCloneDir)

      setStep(2)
    } catch (e) {
      setCloneError((e as Error).message)
    }
    setCloning(false)
  }

  async function handleSelectLocalFile() {
    const result = (await window.api?.save?.selectFile()) as {
      success: boolean
      data?: { filePath: string; project: { project?: { name?: string; description?: string } } }
      error?: string
    }
    if (result?.success && result.data) {
      setLocalFilePath(result.data.filePath)
      setLocalFileData(result.data.project as { project?: { name?: string; description?: string } })
      // Pre-fill project name from imported file
      const importedName = (result.data.project as { project?: { name?: string } })?.project?.name
      if (importedName) {
        setDisplayName(importedName)
        setProjName(
          importedName
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s\-_]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, ''),
        )
      }
      const dir = result.data.filePath.substring(0, result.data.filePath.lastIndexOf('/'))
      setLocalFolder(dir)
      setSaveMode('local')
    }
  }

  async function handleOpenLocal() {
    await handleSelectLocalFile()
    if (localFilePath) {
      setStep(2)
    }
  }

  async function goNext() {
    if (step === 1) {
      if (source === 'git') {
        await handleCloneAndImport()
        return
      }
      if (source === 'local') {
        if (localFilePath) {
          // File already selected via Browse button
          setSaveMode('local')
          setStep(2)
        } else {
          // Open file picker, then move to step 2
          const result = (await window.api?.save?.selectFile()) as {
            success: boolean
            data?: { filePath: string; project: { project?: { name?: string } } }
          }
          if (result?.success && result.data) {
            setLocalFilePath(result.data.filePath)
            setLocalFileData(result.data.project as { project?: { name?: string } })
            const importedName = (result.data.project as { project?: { name?: string } })?.project
              ?.name
            if (importedName) {
              setDisplayName(importedName)
              setProjName(
                importedName
                  .toLowerCase()
                  .replace(/[^a-zA-Z0-9\s\-_]/g, '')
                  .replace(/\s+/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, ''),
              )
            }
            const dir = result.data.filePath.substring(0, result.data.filePath.lastIndexOf('/'))
            setLocalFolder(dir)
            setSaveMode('local')
            setStep(2)
          }
        }
        return
      }
      // source === 'new'
      setStep(2)
      return
    }

    if (step === 2) {
      if (!projName.trim() || !displayName.trim()) {
        setNameError(true)
        setTimeout(() => setNameError(false), 1500)
        return
      }
      setStep(3)
      return
    }

    if (step === 3) {
      setIsCreating(true)
      try {
        const projectId = await createProject(
          projName.trim(),
          projType,
          saveMode,
          saveMode === 'local' || saveMode === 'both' ? localFolder : undefined,
          activeEmoji || undefined,
          selectedColor,
          displayName.trim(),
        )
        if (projectId) {
          if (branchName.trim() && branchName.trim() !== 'main') {
            await ensureDefault(projectId)
            await createBranch(projectId, branchName.trim())
          } else {
            await ensureDefault(projectId)
          }

          // Import data from local file if source was 'local'
          if (source === 'local' && localFilePath) {
            try {
              await window.api?.save?.importLocal({ filePath: localFilePath, projectId })
            } catch {
              /* non-critical */
            }
          }

          if ((saveMode === 'git' || saveMode === 'both') && gitUrl) {
            try {
              await window.api?.settings?.set(`git.${projectId}`, {
                repoUrl: gitUrl,
                username: gitUser,
                branch: gitBranch,
                token: gitToken || '',
              })

              if (source === 'git') {
                // Clone-from-git: the earlier step only inspected a throwaway
                // temp clone, so the chosen local dir was still empty and the
                // first Pull failed (issue #36). Pull now — git:pull's
                // ensureGitRepo clones the remote into the local dir and
                // re-imports the project, so the repo actually lands on disk.
                // (A push here would instead upload the freshly-created empty
                // project and risk clobbering the remote.)
                await window.api.git.pull(projectId)
              } else {
                // New project with a git remote — seed the remote with the
                // project data.
                await window.api.git.push(projectId)
              }
            } catch {
              /* non-critical — user can pull/push later */
            }
          }

          setDone(true)
          setTimeout(() => {
            setActiveProject(projectId)
            setShow(false)
          }, 1200)
        }
      } catch {
        /* error */
      }
      setIsCreating(false)
    }
  }

  const stepLabels = [
    t('newProject.step.source'),
    t('newProject.step.details'),
    t('newProject.step.storage'),
  ]

  return (
    <Modal open={show} onOpenChange={(o) => !o && handleClose()} title={t('newProject.title')}>
      <div
        style={{
          background: 'var(--white)',
          borderRadius: 14,
          width: 600,
          maxWidth: '95vw',
          boxShadow: '0 16px 48px rgba(0,0,0,0.14)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {t('newProject.title')}
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
          <div className="flex items-center" style={{ paddingBottom: 12 }}>
            {[1, 2, 3].map((s, i) => (
              <div key={s} className="flex items-center" style={{ flex: i < 2 ? 1 : 0 }}>
                <div className="flex items-center gap-1.5">
                  <StepDot step={s} current={step} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: s === step ? 600 : 400,
                      color:
                        s < step ? 'var(--green)' : s === step ? 'var(--accent)' : 'var(--hint)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {stepLabels[i]}
                  </span>
                </div>
                {i < 2 && (
                  <div
                    style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 8px' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', minHeight: 320, maxHeight: '65vh', overflowY: 'auto' }}>
          {/* ── STEP 1: Source ── */}
          {step === 1 && !done && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <OptionCard
                  label={t('newProject.source.new')}
                  sub={t('newProject.source.newSub')}
                  icon={<Plus size={14} />}
                  active={source === 'new'}
                  onClick={() => setSource('new')}
                />
                <OptionCard
                  label={t('newProject.source.git')}
                  sub={t('newProject.source.gitSub')}
                  icon={<Download size={14} />}
                  active={source === 'git'}
                  onClick={() => setSource('git')}
                />
                <OptionCard
                  label={t('newProject.source.local')}
                  sub={t('newProject.source.localSub')}
                  icon={<Folder size={14} />}
                  active={source === 'local'}
                  onClick={() => setSource('local')}
                />
              </div>

              {/* Git clone fields */}
              {source === 'git' && (
                <div
                  className="flex flex-col gap-3 rounded-lg"
                  style={{
                    padding: 14,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <Label text={t('newProject.git.repoUrl')} />
                    <input
                      value={gitCloneUrl}
                      onChange={(e) => setGitCloneUrl(e.target.value)}
                      placeholder={t('newProject.git.repoUrlPlaceholder')}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                    />
                  </div>
                  <div className="flex gap-2.5">
                    <div className="flex-1">
                      <Label text={t('newProject.git.username')} />
                      <input
                        value={gitCloneUser}
                        onChange={(e) => setGitCloneUser(e.target.value)}
                        placeholder="github-user"
                        style={inputStyle}
                      />
                    </div>
                    <div className="flex-1">
                      <Label text={t('newProject.git.branch')} />
                      <input
                        value={gitCloneBranch}
                        onChange={(e) => setGitCloneBranch(e.target.value)}
                        placeholder="main"
                        style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  </div>
                  <div>
                    <Label text={t('newProject.git.token')} />
                    <div className="flex gap-2">
                      <input
                        type={showCloneToken ? 'text' : 'password'}
                        value={gitCloneToken}
                        onChange={(e) => setGitCloneToken(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxx"
                        style={{ ...inputStyle, flex: 1, fontFamily: 'var(--font-mono)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCloneToken((v) => !v)}
                        style={{
                          padding: '7px 10px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {showCloneToken ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 3 }}>
                      {t('newProject.git.tokenHint')}
                    </div>
                  </div>
                  <div>
                    <Label text={t('newProject.git.localDir')} />
                    <div className="flex gap-2">
                      <input
                        value={gitCloneDir}
                        readOnly
                        placeholder={t('newProject.git.localDirPlaceholder')}
                        style={{
                          ...inputStyle,
                          flex: 1,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 13,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSelectDir(setGitCloneDir)}
                        style={{
                          padding: '7px 12px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--muted)',
                          fontSize: 13,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('newProject.selectFolder')}
                      </button>
                    </div>
                  </div>
                  {cloneError && (
                    <div style={{ fontSize: 13, color: '#cc2200', padding: '4px 0' }}>
                      {cloneError}
                    </div>
                  )}
                </div>
              )}

              {source === 'local' && (
                <div
                  className="flex flex-col items-center gap-3 rounded-lg"
                  style={{
                    padding: 20,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {!localFilePath ? (
                    <>
                      <FolderOpen size={28} style={{ color: 'var(--muted)' }} />
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {t('newProject.git.selectProject')}
                      </div>
                      <button
                        type="button"
                        onClick={handleSelectLocalFile}
                        className="cursor-pointer"
                        style={{
                          padding: '7px 20px',
                          background: 'var(--accent)',
                          border: 'none',
                          borderRadius: 6,
                          color: 'white',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        Select .json File
                      </button>
                    </>
                  ) : (
                    <>
                      <Check size={22} style={{ color: 'var(--green)' }} />
                      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
                        {localFileData?.project?.name || 'Project file selected'}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--muted)',
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--white)',
                          border: '1px solid var(--border)',
                          borderRadius: 5,
                          padding: '5px 10px',
                          width: '100%',
                          textAlign: 'center',
                          wordBreak: 'break-all',
                        }}
                      >
                        {localFilePath}
                      </div>
                      <button
                        type="button"
                        onClick={handleSelectLocalFile}
                        className="cursor-pointer"
                        style={{
                          padding: '5px 14px',
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--muted)',
                          fontSize: 13,
                        }}
                      >
                        Change file
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Details + Appearance ── */}
          {step === 2 && !done && (
            <div className="flex flex-col gap-4">
              {/* Preview */}
              <div
                className="flex items-center gap-3 rounded-lg"
                style={{
                  padding: 12,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <ProjectIcon
                  name={displayName || projName}
                  emoji={activeEmoji}
                  color={selectedColor}
                  size={44}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                    {displayName || projName || t('newProject.name').replace(' *', '')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 1 }}>
                    {projName ? projName : t('newProject.preview')}
                  </div>
                </div>
              </div>

              {/* Display Name */}
              <div>
                <Label text="DISPLAY NAME *" />
                <input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value)
                    // Auto-generate slug from display name if user hasn't manually edited it
                    const slug = e.target.value
                      .toLowerCase()
                      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
                      .replace(/\s+/g, '-')
                      .replace(/-+/g, '-')
                      .replace(/^-|-$/g, '')
                    if (!slugManuallyEdited) setProjName(slug)
                  }}
                  placeholder="My Awesome Project"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') goNext()
                  }}
                  style={inputStyle}
                />
                <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 3 }}>
                  Shown in the UI. Can contain spaces, Turkish characters, etc.
                </div>
              </div>

              {/* Name (slug) */}
              <div>
                <Label text="PROJECT NAME (SLUG) *" />
                <input
                  value={projName}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^a-zA-Z0-9\-_]/g, '')
                    setProjName(val)
                    setSlugManuallyEdited(true)
                  }}
                  placeholder="my-awesome-project"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') goNext()
                  }}
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--font-mono)',
                    border: `1px solid ${nameError ? '#cc2200' : 'var(--border)'}`,
                  }}
                />
                <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 3 }}>
                  Used for file names and Git. Only a-z, 0-9, dash (-) and underscore (_).
                </div>
                {nameError && (
                  <div style={{ fontSize: 13, color: '#cc2200', marginTop: 3 }}>
                    {t('newProject.nameRequired')}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <Label text={t('newProject.description')} />
                <textarea
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder={t('newProject.descPlaceholder')}
                  rows={2}
                  style={{
                    ...inputStyle,
                    resize: 'none',
                    lineHeight: 1.5,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Type */}
              <div>
                <Label text={t('newProject.type')} />
                <div className="flex gap-2">
                  <OptionCard
                    label="HTTP / REST"
                    sub="REST, SOAP, GraphQL, SSE"
                    active={projType === 'http'}
                    onClick={() => setProjType('http')}
                    icon={<Globe size={13} />}
                  />
                  <OptionCard
                    label="gRPC"
                    sub="Protocol Buffers"
                    active={projType === 'grpc'}
                    onClick={() => setProjType('grpc')}
                    icon={<Server size={13} />}
                  />
                  <OptionCard
                    label="WebSocket"
                    sub="Realtime"
                    active={projType === 'websocket'}
                    onClick={() => setProjType('websocket')}
                    icon={<Wifi size={13} />}
                  />
                </div>
              </div>

              {/* Branch */}
              <div>
                <Label text={t('newProject.branchName')} />
                <input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="main"
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                />
                <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 3 }}>
                  {t('newProject.branchHint')}
                </div>
              </div>

              {/* Icon + Color stacked */}
              <div className="flex gap-4">
                {/* Icon section */}
                <div className="flex-1">
                  <Label text={t('newProject.icon')} />
                  <div className="mb-2 flex gap-2">
                    <div
                      onClick={() => {
                        setIconOpt('auto')
                        setSelectedEmoji('')
                      }}
                      className="cursor-pointer flex-1 rounded-md px-3 py-1.5 text-center font-medium"
                      style={{
                        border: `1.5px solid ${iconOpt === 'auto' ? 'var(--accent)' : 'var(--border)'}`,
                        background: iconOpt === 'auto' ? 'var(--accent-light)' : 'var(--white)',
                        color: iconOpt === 'auto' ? 'var(--accent-text)' : 'var(--muted)',
                      }}
                    >
                      {t('newProject.iconAuto')}
                    </div>
                    <div
                      onClick={() => setIconOpt('emoji')}
                      className="cursor-pointer flex-1 rounded-md px-3 py-1.5 text-center font-medium"
                      style={{
                        border: `1.5px solid ${iconOpt === 'emoji' ? 'var(--accent)' : 'var(--border)'}`,
                        background: iconOpt === 'emoji' ? 'var(--accent-light)' : 'var(--white)',
                        color: iconOpt === 'emoji' ? 'var(--accent-text)' : 'var(--muted)',
                      }}
                    >
                      {t('newProject.iconEmoji')}
                    </div>
                  </div>
                  {iconOpt === 'emoji' && (
                    <>
                      <div
                        role="radiogroup"
                        aria-label="Project emoji"
                        className="mb-1.5 flex flex-wrap gap-1"
                      >
                        {EMOJIS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            role="radio"
                            aria-checked={selectedEmoji === e}
                            aria-label={`Emoji ${e}`}
                            onClick={() => {
                              setSelectedEmoji(e)
                              setCustomEmoji('')
                            }}
                            className="cursor-pointer"
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 7,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 17,
                              border: `1.5px solid ${selectedEmoji === e ? 'var(--accent)' : 'var(--border)'}`,
                              background:
                                selectedEmoji === e ? 'var(--accent-light)' : 'var(--white)',
                              transition: 'all 0.12s',
                              padding: 0,
                            }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <input
                        value={customEmoji}
                        onChange={(e) => {
                          setCustomEmoji(e.target.value)
                          setSelectedEmoji('')
                        }}
                        placeholder={`${t('newProject.emojiPaste')} 🚀`}
                        style={{ ...inputStyle, fontSize: 15 }}
                      />
                    </>
                  )}
                </div>

                {/* Color section */}
                <div style={{ width: 120 }}>
                  <Label text={t('newProject.color')} />
                  <div
                    role="radiogroup"
                    aria-label="Project color"
                    className="flex flex-wrap gap-1.5"
                  >
                    {COLORS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        role="radio"
                        aria-checked={col === selectedColor}
                        aria-label={`Color ${col}`}
                        onClick={() => setSelectedColor(col)}
                        className="cursor-pointer"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: col,
                          border: `2px solid ${col === selectedColor ? 'var(--text)' : 'transparent'}`,
                          transform: col === selectedColor ? 'scale(1.12)' : 'scale(1)',
                          transition: 'all 0.12s',
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Storage ── */}
          {step === 3 && !done && (
            <div className="flex flex-col gap-4">
              <div>
                <Label text={t('newProject.saveMode')} />
                <div className="flex gap-2">
                  <OptionCard
                    label={t('newProject.modeLocal')}
                    sub={t('newProject.modeLocalSub')}
                    icon={<FolderOpen size={13} />}
                    active={saveMode === 'local'}
                    onClick={() => setSaveMode('local')}
                  />
                  <OptionCard
                    label={t('newProject.modeGit')}
                    sub={t('newProject.modeGitSub')}
                    icon={<GitBranch size={13} />}
                    active={saveMode === 'git'}
                    onClick={() => setSaveMode('git')}
                  />
                  <OptionCard
                    label={t('newProject.modeBoth')}
                    sub={t('newProject.modeBothSub')}
                    icon={<TrendingUp size={13} />}
                    active={saveMode === 'both'}
                    onClick={() => setSaveMode('both')}
                  />
                </div>
              </div>

              {(saveMode === 'local' || saveMode === 'both') && (
                <div>
                  <Label text={t('newProject.localFolder')} />
                  <div className="flex gap-2">
                    <input
                      value={localFolder}
                      readOnly
                      placeholder={t('newProject.folderPlaceholder')}
                      style={{
                        ...inputStyle,
                        flex: 1,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSelectDir(setLocalFolder)}
                      style={{
                        padding: '7px 12px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--muted)',
                        fontSize: 13,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('newProject.selectFolder')}
                    </button>
                  </div>
                </div>
              )}

              {(saveMode === 'git' || saveMode === 'both') && (
                <div
                  className="flex flex-col gap-2.5 rounded-lg"
                  style={{
                    padding: 14,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <Label text={t('newProject.git.repoUrl')} />
                    <input
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      placeholder={t('newProject.git.repoUrlPlaceholder')}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                    />
                  </div>
                  <div className="flex gap-2.5">
                    <div className="flex-1">
                      <Label text={t('newProject.git.username')} />
                      <input
                        value={gitUser}
                        onChange={(e) => setGitUser(e.target.value)}
                        placeholder="github-user"
                        style={inputStyle}
                      />
                    </div>
                    <div className="flex-1">
                      <Label text={t('newProject.git.branch')} />
                      <input
                        value={gitBranch}
                        onChange={(e) => setGitBranch(e.target.value)}
                        placeholder="main"
                        style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  </div>
                  <div>
                    <Label text={t('newProject.git.token')} />
                    <div className="flex gap-2">
                      <input
                        type={showToken ? 'text' : 'password'}
                        value={gitToken}
                        onChange={(e) => setGitToken(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxx"
                        style={{ ...inputStyle, flex: 1, fontFamily: 'var(--font-mono)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        style={{
                          padding: '7px 10px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 3 }}>
                      {t('newProject.git.tokenHint')}
                    </div>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div
                className="rounded-lg"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  padding: 12,
                }}
              >
                <Label text={t('newProject.summary')} />
                <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
                  <ProjectIcon
                    name={displayName || projName}
                    emoji={activeEmoji}
                    color={selectedColor}
                    size={32}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                      {projName || 'Project'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {projType === 'http'
                        ? 'HTTP / REST'
                        : projType === 'grpc'
                          ? 'gRPC'
                          : 'WebSocket'}
                      {' · '}
                      {branchName} branch
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {saveMode === 'local' &&
                    `${t('newProject.localSave')}${localFolder ? `: ${localFolder}` : ''}`}
                  {saveMode === 'git' &&
                    `${t('newProject.gitSave')} ${gitUrl || t('newProject.noRepo')}`}
                  {saveMode === 'both' && t('newProject.bothSave')}
                </div>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {done && (
            <div className="py-5 text-center">
              <div
                className="mx-auto mb-4 flex items-center justify-center rounded-full"
                style={{ width: 48, height: 48, background: 'var(--green)' }}
              >
                <Check size={22} color="white" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>
                {t('newProject.done')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                &ldquo;{projName}&rdquo; {t('newProject.doneMsg')}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer"
                style={{
                  padding: '7px 20px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {t('newProject.openProject')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div
            className="flex items-center justify-between"
            style={{ padding: '12px 24px', borderTop: '1px solid var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="cursor-pointer"
              style={{
                padding: '6px 14px',
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: 13,
                visibility: step > 1 ? 'visible' : 'hidden',
              }}
            >
              ← {t('newProject.back')}
            </button>

            <div className="flex gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  style={{
                    width: 6,
                    height: 6,
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
              disabled={isCreating || cloning}
              className="cursor-pointer"
              style={{
                padding: '7px 18px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                fontWeight: 600,
                fontSize: 13,
                opacity: isCreating || cloning ? 0.7 : 1,
              }}
            >
              {cloning
                ? t('newProject.git.cloning')
                : isCreating
                  ? t('newProject.creating')
                  : step === 3
                    ? `${t('newProject.create')} ✓`
                    : `${t('newProject.next')} →`}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
