import { useState, useEffect } from 'react'
import {
  X,
  FolderOpen,
  GitBranch,
  Loader2,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  RefreshCw,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import { toast } from '../../lib/toast'
import { gitErrorText } from '../../lib/git-error-text'
import { pullWarnings, skippedFilesMessage, type PullNotices } from '../../lib/pull-messages'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { formatDate } from '../../lib/format-datetime'
import type { SaveMode, GitRepoFile } from '../../types'
import Modal from '../shared/Modal'

type TabMode = 'save' | 'push' | 'pull' | 'open'

interface DiffEntry {
  id: string
  name: string
  status: 'added' | 'removed' | 'modified'
}
interface DiffCategory {
  added: number
  removed: number
  modified: number
  details: DiffEntry[]
}
interface DiffResult {
  direction: 'push' | 'pull'
  remoteExists: boolean
  totalChanges: number
  changes: {
    endpoints: DiffCategory
    folders: DiffCategory
    savedRequests: DiffCategory
    environments: DiffCategory
    globalVariables: DiffCategory
  }
  summary: string
}

function DiffCategoryView({ label, diff }: { label: string; diff: DiffCategory }) {
  const total = diff.added + diff.removed + diff.modified
  if (total === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="mb-1 flex items-center gap-2 font-semibold" style={{ color: 'var(--text)' }}>
        {label}
        <span
          className="rounded px-1.5 py-px font-normal"
          style={{ background: 'var(--surface)', color: 'var(--muted)' }}
        >
          {total}
        </span>
      </div>
      <div className="rounded-md" style={{ border: '1px solid var(--border)' }}>
        {diff.details.map((item, i) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-2.5 py-1"
            style={{
              borderBottom: i < diff.details.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            {item.status === 'added' && <Plus size={11} style={{ color: '#1a7a4a' }} />}
            {item.status === 'removed' && <Minus size={11} style={{ color: '#cc2200' }} />}
            {item.status === 'modified' && <RefreshCw size={11} style={{ color: '#b35a00' }} />}
            <span
              className="flex-1 truncate"
              style={{
                color:
                  item.status === 'added'
                    ? '#1a7a4a'
                    : item.status === 'removed'
                      ? '#cc2200'
                      : '#b35a00',
              }}
            >
              {item.name}
            </span>
            <span
              style={{
                color: 'var(--muted)',
                background:
                  item.status === 'added'
                    ? '#e8f9f1'
                    : item.status === 'removed'
                      ? '#fff0f0'
                      : '#fff4e0',
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
  width: '100%',
}

export default function SaveModal() {
  const { t, locale } = useTranslation()
  const show = useUIStore((s) => s.showSaveModal)
  const setShow = useUIStore((s) => s.setShowSaveModal)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const fetchSaveHistory = useBranchStore((s) => s.fetchSaveHistory)
  const saveHistory = useBranchStore((s) => s.saveHistory)

  const [tabMode, setTabMode] = useState<TabMode>('save')
  const [saveMode, setSaveMode] = useState<SaveMode>('local')
  const [commitMessage, setCommitMessage] = useState('')
  const [localDir, setLocalDir] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitUsername, setGitUsername] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [loading, setLoading] = useState(false)
  // Diff-specific errors stay in-modal (next to the diff preview) so the user
  // doesn't lose context. Action results (save/push/pull) go to toast.
  const [diffError, setDiffError] = useState<string | null>(null)

  // Git Open state
  const [gitFiles, setGitFiles] = useState<GitRepoFile[]>([])
  const [gitTmpDir, setGitTmpDir] = useState('')

  // Diff preview state
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (show && activeProjectId) {
      fetchSaveHistory(activeProjectId)
    }
  }, [show, activeProjectId, fetchSaveHistory])

  // Auto-fetch diff when switching to push/pull tabs
  useEffect(() => {
    if (show && activeProjectId && (tabMode === 'push' || tabMode === 'pull')) {
      fetchDiff(tabMode === 'push' ? 'push' : 'pull')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, tabMode, activeProjectId])

  if (!show) return null

  function handleClose() {
    setShow(false)
    setDiffError(null)
    setGitFiles([])
    setDiffResult(null)
    setDiffLoading(false)
    if (gitTmpDir) {
      window.api?.save?.gitCleanup(gitTmpDir)
      setGitTmpDir('')
    }
  }

  async function fetchDiff(direction: 'push' | 'pull') {
    if (!activeProjectId) return
    setDiffLoading(true)
    setDiffResult(null)
    setDiffError(null)
    try {
      const result = (await window.api?.save?.gitDiff({
        projectId: activeProjectId,
        direction,
      })) as {
        success: boolean
        data?: DiffResult
        error?: string
      }
      if (result?.success && result.data) {
        setDiffResult(result.data)
      } else {
        setDiffError(gitErrorText(result) || t('saveModal.diffFailed'))
      }
    } catch (e) {
      setDiffError((e as Error).message)
    }
    setDiffLoading(false)
  }

  async function handleSelectDirectory() {
    const result = (await window.api?.save?.selectDirectory()) as {
      success: boolean
      data?: string
    }
    if (result?.success && result.data) setLocalDir(result.data)
  }

  async function handleSave() {
    if (!activeProjectId) return
    setLoading(true)
    try {
      if (saveMode === 'local') {
        const result = (await window.api?.save?.local({
          projectId: activeProjectId,
          directoryPath: localDir || undefined,
        })) as { success: boolean; data?: { path: string; fileName: string }; error?: string }
        if (result?.success && result.data) {
          toast.success(`${t('toast.saved')}: ${result.data.fileName}`)
          if (result.data.path)
            setLocalDir(result.data.path.substring(0, result.data.path.lastIndexOf('/')))
          fetchSaveHistory(activeProjectId)
        } else {
          toast.error(result?.error || t('toast.saveFailed'))
        }
      } else {
        if (!gitUrl || !gitUsername || !gitToken) {
          toast.error(t('saveModal.fillGitFields'))
          return
        }
        const result = (await window.api?.save?.git({
          projectId: activeProjectId,
          repoUrl: gitUrl,
          branch: gitBranch,
          username: gitUsername,
          token: gitToken,
          commitMessage: commitMessage || 'Update project',
        })) as { success: boolean; error?: string }
        if (result?.success) {
          toast.success(`${t('toast.pushed')}: ${gitBranch}`)
          fetchSaveHistory(activeProjectId)
        } else {
          toast.error(gitErrorText(result) || t('toast.pushFailed'))
        }
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      // try/finally — without this an exception during setLoading would
      // leave the Save button permanently disabled.
      setLoading(false)
    }
  }

  async function handleGitPush() {
    if (!activeProjectId) return
    setLoading(true)
    try {
      const result = (await window.api?.save?.gitPush({
        projectId: activeProjectId,
        commitMessage: commitMessage || undefined,
      })) as { success: boolean; data?: { noChanges?: boolean; message?: string }; error?: string }
      if (result?.success) {
        toast.success(
          result.data?.noChanges
            ? t('saveModal.noChangesToPush')
            : `${t('toast.pushed')}: ${result.data?.message || t('saveModal.pushSuccess')}`,
        )
        fetchSaveHistory(activeProjectId)
      } else {
        toast.error(gitErrorText(result) || t('toast.pushFailed'))
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  async function handleGitPull() {
    if (!activeProjectId) return
    setLoading(true)
    try {
      const result = (await window.api?.save?.gitPull({ projectId: activeProjectId })) as {
        success: boolean
        data?: PullNotices & { imported?: Record<string, number> }
        error?: string
      }
      if (result?.success) {
        const imp = result.data?.imported
        const msg = imp
          ? `${t('toast.pulled')}: ${t('saveModal.pulledSummary')
              .replace('{endpoints}', String(imp.endpoints || 0))
              .replace('{requests}', String(imp.savedRequests || 0))
              .replace('{environments}', String(imp.environments || 0))}`
          : t('toast.pulled')
        toast.success(msg)
        pullWarnings(t, result.data).forEach((m) => toast.warning(m))
        fetchSaveHistory(activeProjectId)
      } else {
        toast.error(gitErrorText(result) || t('toast.pullFailed'))
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  async function handleGitOpen() {
    if (!gitUrl || !gitUsername || !gitToken) {
      toast.error(t('saveModal.fillGitFields'))
      return
    }
    setLoading(true)
    try {
      const result = (await window.api?.save?.gitListFiles({
        repoUrl: gitUrl,
        branch: gitBranch,
        username: gitUsername,
        token: gitToken,
      })) as {
        success: boolean
        data?: { tmpDir: string; files: GitRepoFile[]; skipped?: Array<{ file: string }> }
        error?: string
      }
      if (result?.success && result.data) {
        setGitFiles(result.data.files)
        setGitTmpDir(result.data.tmpDir)
        const skipped = result.data.skipped?.map((s) => s.file) ?? []
        if (skipped.length > 0) toast.warning(skippedFilesMessage(t, skipped))
        else if (result.data.files.length === 0) toast.warning(t('saveModal.noJsonFiles'))
      } else {
        toast.error(gitErrorText(result) || t('saveModal.listFilesFailed'))
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  async function handleImportFile(file: GitRepoFile) {
    setLoading(true)
    try {
      const result = (await window.api?.save?.gitReadFile(file.path)) as {
        success: boolean
        error?: string
      }
      if (result?.success) {
        toast.success(t('saveModal.loaded').replace('{name}', file.name))
      } else {
        toast.error(gitErrorText(result) || t('saveModal.readFileFailed'))
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  // Worded here, not with main's English `summary`, so it follows the UI
  // language (tester finding 6).
  function diffSummary(total: number): string {
    if (total === 0) return t('saveModal.diffInSync')
    return formatCount(total, t('saveModal.diffChangesOne'), t('saveModal.diffChanges'))
  }

  const tabs: { id: TabMode; label: string; icon?: React.ReactNode }[] = [
    { id: 'save', label: t('common.save') },
    { id: 'push', label: t('git.push'), icon: <ArrowUp size={11} /> },
    { id: 'pull', label: t('git.pull'), icon: <ArrowDown size={11} /> },
    { id: 'open', label: t('saveModal.tabOpen') },
  ]

  return (
    <Modal
      open={show}
      onOpenChange={(o) => !o && handleClose()}
      title={t('saveModal.title')}
      testId="save-modal"
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 520,
          maxHeight: '80vh',
          background: 'var(--white)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header with tabs */}
        <div
          className="flex shrink-0 items-center justify-between px-4"
          style={{ height: 48, borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--text)' }}>
              {t('saveModal.project')}
            </span>
            <div
              className="flex items-center"
              style={{ background: 'var(--surface)', borderRadius: 6, padding: 2 }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="flex cursor-pointer items-center gap-1 px-2.5 py-1"
                  style={{
                    background: tabMode === tab.id ? 'var(--white)' : 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    color: tabMode === tab.id ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: tabMode === tab.id ? 600 : 400,
                  }}
                  onClick={() => {
                    setTabMode(tab.id)
                    setDiffError(null)
                    setGitFiles([])
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            onClick={handleClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarGutter: 'stable' }}>
          {/* ── SAVE TAB ── */}
          {tabMode === 'save' && (
            <>
              <div className="mb-3 flex gap-2">
                {(['local', 'git'] as SaveMode[]).map((mode) => (
                  <label
                    key={mode}
                    className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg p-2.5"
                    style={{
                      border: `1.5px solid ${saveMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                      background: saveMode === mode ? 'var(--accent-light)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="saveMode"
                      checked={saveMode === mode}
                      onChange={() => setSaveMode(mode)}
                      className="hidden"
                    />
                    {mode === 'local' ? (
                      <FolderOpen
                        size={14}
                        style={{ color: saveMode === mode ? 'var(--accent)' : 'var(--muted)' }}
                      />
                    ) : (
                      <GitBranch
                        size={14}
                        style={{ color: saveMode === mode ? 'var(--accent)' : 'var(--muted)' }}
                      />
                    )}
                    <div>
                      <div className="font-medium" style={{ color: 'var(--text)' }}>
                        {mode === 'local' ? t('saveModal.modeLocal') : 'Git'}
                      </div>
                      <div style={{ color: 'var(--muted)' }}>
                        {mode === 'local' ? t('saveModal.modeLocalHint') : 'GitHub / GitLab'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {saveMode === 'local' && (
                <div className="flex gap-2">
                  <input
                    value={localDir}
                    readOnly
                    placeholder={t('saveModal.selectFolder')}
                    style={{ ...inputStyle, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  />
                  <button
                    type="button"
                    className="cursor-pointer"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 12px',
                      color: 'var(--text)',
                    }}
                    onClick={handleSelectDirectory}
                  >
                    {t('saveModal.browse')}
                  </button>
                </div>
              )}

              {saveMode === 'git' && (
                <div className="space-y-2.5">
                  <input
                    value={gitUrl}
                    onChange={(e) => setGitUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                    style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  />
                  <div className="flex gap-2">
                    <input
                      value={gitBranch}
                      onChange={(e) => setGitBranch(e.target.value)}
                      placeholder="main"
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                    />
                    <input
                      value={gitUsername}
                      onChange={(e) => setGitUsername(e.target.value)}
                      placeholder={t('saveModal.usernamePlaceholder')}
                      style={inputStyle}
                    />
                  </div>
                  <input
                    type="password"
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    placeholder="ghp_xxxx..."
                    style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder={t('saveModal.commitPlaceholder')}
                    style={inputStyle}
                  />
                </div>
              )}

              {saveHistory.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 font-semibold" style={{ color: 'var(--muted)' }}>
                    {t('saveModal.recentSaves')}
                  </div>
                  <div
                    className="max-h-[100px] overflow-y-auto rounded-md"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {saveHistory.slice(0, 5).map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 px-2.5 py-1"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        {entry.mode === 'local' ? (
                          <FolderOpen size={11} style={{ color: 'var(--muted)' }} />
                        ) : (
                          <GitBranch size={11} style={{ color: 'var(--muted)' }} />
                        )}
                        <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                          {entry.message}
                        </span>
                        <span style={{ color: 'var(--hint)' }}>
                          {formatDate(entry.timestamp, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── PUSH TAB ── */}
          {tabMode === 'push' && (
            <>
              <div className="mb-3">
                <input
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder={t('saveModal.commitOptionalPlaceholder')}
                  style={inputStyle}
                />
              </div>

              {diffLoading && (
                <div
                  className="flex items-center gap-2 py-6 text-center"
                  style={{ color: 'var(--muted)', justifyContent: 'center' }}
                >
                  <Loader2 size={14} className="animate-spin" /> {t('saveModal.comparing')}
                </div>
              )}

              {diffResult && !diffLoading && (
                <div>
                  {/* Summary bar */}
                  <div
                    className="mb-3 flex items-center gap-2 rounded-md px-3 py-2"
                    style={{
                      background: diffResult.totalChanges === 0 ? 'var(--surface)' : '#fff4e0',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <ArrowUp
                      size={13}
                      style={{ color: diffResult.totalChanges === 0 ? 'var(--muted)' : '#b35a00' }}
                    />
                    <span
                      style={{
                        color: diffResult.totalChanges === 0 ? 'var(--muted)' : '#b35a00',
                        fontWeight: 500,
                      }}
                    >
                      {diffSummary(diffResult.totalChanges)}
                    </span>
                  </div>

                  {diffResult.totalChanges > 0 && (
                    <div className="max-h-[220px] overflow-y-auto">
                      <DiffCategoryView
                        label={t('saveModal.catEndpoints')}
                        diff={diffResult.changes.endpoints}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catSavedRequests')}
                        diff={diffResult.changes.savedRequests}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catFolders')}
                        diff={diffResult.changes.folders}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catEnvironments')}
                        diff={diffResult.changes.environments}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catGlobalVariables')}
                        diff={diffResult.changes.globalVariables}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── PULL TAB ── */}
          {tabMode === 'pull' && (
            <>
              {diffLoading && (
                <div
                  className="flex items-center gap-2 py-6 text-center"
                  style={{ color: 'var(--muted)', justifyContent: 'center' }}
                >
                  <Loader2 size={14} className="animate-spin" /> {t('saveModal.comparing')}
                </div>
              )}

              {diffResult && !diffLoading && (
                <div>
                  <div
                    className="mb-3 flex items-center gap-2 rounded-md px-3 py-2"
                    style={{
                      background: diffResult.totalChanges === 0 ? 'var(--surface)' : '#e8f4ff',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <ArrowDown
                      size={13}
                      style={{ color: diffResult.totalChanges === 0 ? 'var(--muted)' : '#0066cc' }}
                    />
                    <span
                      style={{
                        color: diffResult.totalChanges === 0 ? 'var(--muted)' : '#0066cc',
                        fontWeight: 500,
                      }}
                    >
                      {diffSummary(diffResult.totalChanges)}
                    </span>
                  </div>

                  {diffResult.totalChanges > 0 && (
                    <div className="max-h-[220px] overflow-y-auto">
                      <DiffCategoryView
                        label={t('saveModal.catEndpoints')}
                        diff={diffResult.changes.endpoints}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catSavedRequests')}
                        diff={diffResult.changes.savedRequests}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catFolders')}
                        diff={diffResult.changes.folders}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catEnvironments')}
                        diff={diffResult.changes.environments}
                      />
                      <DiffCategoryView
                        label={t('saveModal.catGlobalVariables')}
                        diff={diffResult.changes.globalVariables}
                      />
                    </div>
                  )}

                  {!diffResult.remoteExists && (
                    <div
                      className="mt-2 rounded-md px-3 py-2"
                      style={{ background: '#fff0f0', color: '#cc2200' }}
                    >
                      {t('saveModal.noRemote')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── OPEN FROM GIT TAB ── */}
          {tabMode === 'open' && (
            <>
              <div className="space-y-2.5">
                <input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                />
                <div className="flex gap-2">
                  <input
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                    placeholder="main"
                    style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                  <input
                    value={gitUsername}
                    onChange={(e) => setGitUsername(e.target.value)}
                    placeholder={t('saveModal.usernamePlaceholder')}
                    style={inputStyle}
                  />
                </div>
                <input
                  type="password"
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                  placeholder="ghp_xxxx..."
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                />
              </div>
              {gitFiles.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 font-semibold" style={{ color: 'var(--muted)' }}>
                    {t('saveModal.repoJsonFiles')}
                  </div>
                  <div
                    className="max-h-[140px] overflow-y-auto rounded-md"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {gitFiles.map((file) => (
                      <div
                        key={file.name}
                        className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-[var(--surface)]"
                        style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}
                        onClick={() => handleImportFile(file)}
                      >
                        <span className="flex-1">{file.name}</span>
                        <span style={{ color: 'var(--hint)' }}>
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Diff error stays in-context next to push/pull preview so the
              user doesn't lose the comparison. Other action results (save /
              push / pull / open) use global toasts. */}
          {diffError && (tabMode === 'push' || tabMode === 'pull') && (
            <div
              className="mt-3 rounded-md px-3 py-2"
              style={{ background: '#fff0f0', color: '#cc2200' }}
            >
              {diffError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-end gap-2 px-4"
          style={{ height: 48, borderTop: '1px solid var(--border)' }}
        >
          <button
            type="button"
            className="cursor-pointer"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 14px',
              color: 'var(--text)',
            }}
            onClick={handleClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5"
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              padding: '5px 14px',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
            }}
            disabled={loading}
            onClick={
              tabMode === 'save'
                ? handleSave
                : tabMode === 'push'
                  ? handleGitPush
                  : tabMode === 'pull'
                    ? handleGitPull
                    : handleGitOpen
            }
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            {tabMode === 'save'
              ? t('common.save')
              : tabMode === 'push'
                ? t('git.push')
                : tabMode === 'pull'
                  ? t('git.pull')
                  : t('saveModal.connect')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
