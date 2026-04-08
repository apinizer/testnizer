import { useState, useEffect } from 'react'
import { X, FolderOpen, GitBranch, Loader2, Check, AlertCircle } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import type { SaveMode, GitRepoFile } from '../../types'

type TabMode = 'save' | 'open'

export default function SaveModal() {
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
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Git Open state
  const [gitFiles, setGitFiles] = useState<GitRepoFile[]>([])
  const [gitTmpDir, setGitTmpDir] = useState('')

  useEffect(() => {
    if (show && activeProjectId) {
      fetchSaveHistory(activeProjectId)
    }
  }, [show, activeProjectId, fetchSaveHistory])

  if (!show) return null

  function handleClose() {
    setShow(false)
    setStatus(null)
    setGitFiles([])
    if (gitTmpDir) {
      window.api?.save?.gitCleanup(gitTmpDir)
      setGitTmpDir('')
    }
  }

  async function handleSelectDirectory() {
    const result = await window.api?.save?.selectDirectory() as { success: boolean; data?: string }
    if (result?.success && result.data) {
      setLocalDir(result.data)
    }
  }

  async function handleSave() {
    if (!activeProjectId) return
    setLoading(true)
    setStatus(null)

    try {
      if (saveMode === 'local') {
        const result = await window.api?.save?.local({
          projectId: activeProjectId,
          directoryPath: localDir || undefined,
        }) as { success: boolean; data?: { path: string; fileName: string }; error?: string }

        if (result?.success && result.data) {
          setStatus({ type: 'success', message: `Saved: ${result.data.fileName}` })
          if (result.data.path) {
            const dir = result.data.path.substring(0, result.data.path.lastIndexOf('/'))
            setLocalDir(dir)
          }
          fetchSaveHistory(activeProjectId)
        } else {
          setStatus({ type: 'error', message: result?.error || 'Save failed' })
        }
      } else {
        if (!gitUrl || !gitUsername || !gitToken) {
          setStatus({ type: 'error', message: 'Please fill in all Git fields' })
          setLoading(false)
          return
        }
        const result = await window.api?.save?.git({
          projectId: activeProjectId,
          repoUrl: gitUrl,
          branch: gitBranch,
          username: gitUsername,
          token: gitToken,
          commitMessage: commitMessage || 'Update project',
        }) as { success: boolean; data?: unknown; error?: string }

        if (result?.success) {
          setStatus({ type: 'success', message: `Pushed to ${gitBranch}` })
          fetchSaveHistory(activeProjectId)
        } else {
          setStatus({ type: 'error', message: result?.error || 'Git push failed' })
        }
      }
    } catch (e) {
      setStatus({ type: 'error', message: (e as Error).message })
    }
    setLoading(false)
  }

  async function handleGitOpen() {
    if (!gitUrl || !gitUsername || !gitToken) {
      setStatus({ type: 'error', message: 'Please fill in all Git fields' })
      return
    }
    setLoading(true)
    setStatus(null)

    try {
      const result = await window.api?.save?.gitListFiles({
        repoUrl: gitUrl,
        branch: gitBranch,
        username: gitUsername,
        token: gitToken,
      }) as { success: boolean; data?: { tmpDir: string; files: GitRepoFile[] }; error?: string }

      if (result?.success && result.data) {
        setGitFiles(result.data.files)
        setGitTmpDir(result.data.tmpDir)
        if (result.data.files.length === 0) {
          setStatus({ type: 'error', message: 'No JSON files found in repository' })
        }
      } else {
        setStatus({ type: 'error', message: result?.error || 'Failed to list files' })
      }
    } catch (e) {
      setStatus({ type: 'error', message: (e as Error).message })
    }
    setLoading(false)
  }

  async function handleImportFile(file: GitRepoFile) {
    setLoading(true)
    try {
      const result = await window.api?.save?.gitReadFile(file.path) as { success: boolean; data?: unknown; error?: string }
      if (result?.success && result.data) {
        setStatus({ type: 'success', message: `Loaded: ${file.name}` })
        // Data is available — in a real implementation this would trigger import
      } else {
        setStatus({ type: 'error', message: result?.error || 'Failed to read file' })
      }
    } catch (e) {
      setStatus({ type: 'error', message: (e as Error).message })
    }
    setLoading(false)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={handleClose}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 480,
          maxHeight: '80vh',
          background: 'var(--white)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-4"
          style={{ height: 48, borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[0.925rem] font-semibold" style={{ color: 'var(--heading)' }}>
              Project Save
            </span>
            {/* Tab toggle */}
            <div
              className="flex items-center"
              style={{ background: 'var(--bg)', borderRadius: 6, padding: 2 }}
            >
              <button
                type="button"
                className="cursor-pointer px-3 py-0.5 text-[0.75rem]"
                style={{
                  background: tabMode === 'save' ? 'var(--white)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: tabMode === 'save' ? 'var(--accent)' : 'var(--muted)',
                  fontWeight: tabMode === 'save' ? 600 : 400,
                }}
                onClick={() => { setTabMode('save'); setStatus(null); setGitFiles([]) }}
              >
                Save
              </button>
              <button
                type="button"
                className="cursor-pointer px-3 py-0.5 text-[0.75rem]"
                style={{
                  background: tabMode === 'open' ? 'var(--white)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: tabMode === 'open' ? 'var(--accent)' : 'var(--muted)',
                  fontWeight: tabMode === 'open' ? 600 : 400,
                }}
                onClick={() => { setTabMode('open'); setStatus(null); setGitFiles([]) }}
              >
                Open from Git
              </button>
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tabMode === 'save' ? (
            <>
              {/* Mode selector */}
              <div className="mb-4 flex gap-3">
                <label
                  className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg p-3 text-[0.825rem]"
                  style={{
                    border: `2px solid ${saveMode === 'local' ? 'var(--accent)' : 'var(--border)'}`,
                    background: saveMode === 'local' ? 'var(--accentLight)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="saveMode"
                    checked={saveMode === 'local'}
                    onChange={() => setSaveMode('local')}
                    className="hidden"
                  />
                  <FolderOpen size={16} style={{ color: saveMode === 'local' ? 'var(--accent)' : 'var(--muted)' }} />
                  <div>
                    <div className="font-medium" style={{ color: 'var(--text)' }}>Local</div>
                    <div className="text-[0.75rem]" style={{ color: 'var(--muted)' }}>Save to this computer</div>
                  </div>
                </label>
                <label
                  className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg p-3 text-[0.825rem]"
                  style={{
                    border: `2px solid ${saveMode === 'git' ? 'var(--accent)' : 'var(--border)'}`,
                    background: saveMode === 'git' ? 'var(--accentLight)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="saveMode"
                    checked={saveMode === 'git'}
                    onChange={() => setSaveMode('git')}
                    className="hidden"
                  />
                  <GitBranch size={16} style={{ color: saveMode === 'git' ? 'var(--accent)' : 'var(--muted)' }} />
                  <div>
                    <div className="font-medium" style={{ color: 'var(--text)' }}>Git</div>
                    <div className="text-[0.75rem]" style={{ color: 'var(--muted)' }}>GitHub / GitLab</div>
                  </div>
                </label>
              </div>

              {/* Local mode fields */}
              {saveMode === 'local' && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Directory
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={localDir}
                        onChange={(e) => setLocalDir(e.target.value)}
                        placeholder="Select folder..."
                        readOnly
                        className="flex-1 text-[0.825rem]"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          color: 'var(--text)',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        className="cursor-pointer text-[0.75rem]"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 12px',
                          color: 'var(--text)',
                        }}
                        onClick={handleSelectDirectory}
                      >
                        Browse
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Git mode fields */}
              {saveMode === 'git' && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Repository URL
                    </label>
                    <input
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="w-full text-[0.825rem]"
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                        Branch
                      </label>
                      <input
                        value={gitBranch}
                        onChange={(e) => setGitBranch(e.target.value)}
                        placeholder="main"
                        className="w-full text-[0.825rem]"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          color: 'var(--text)',
                          outline: 'none',
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                        Username
                      </label>
                      <input
                        value={gitUsername}
                        onChange={(e) => setGitUsername(e.target.value)}
                        placeholder="username"
                        className="w-full text-[0.825rem]"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          color: 'var(--text)',
                          outline: 'none',
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Personal Access Token
                    </label>
                    <input
                      type="password"
                      value={gitToken}
                      onChange={(e) => setGitToken(e.target.value)}
                      placeholder="ghp_xxxx..."
                      className="w-full text-[0.825rem]"
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Commit Message
                    </label>
                    <input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Update project"
                      className="w-full text-[0.825rem]"
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Save History */}
              {saveHistory.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                    Recent Saves
                  </div>
                  <div
                    className="max-h-[120px] overflow-y-auto rounded-lg"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {saveHistory.slice(0, 5).map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-[0.75rem]"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        {entry.mode === 'local' ? (
                          <FolderOpen size={12} style={{ color: 'var(--muted)' }} />
                        ) : (
                          <GitBranch size={12} style={{ color: 'var(--muted)' }} />
                        )}
                        <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                          {entry.message}
                        </span>
                        <span style={{ color: 'var(--hint)' }}>
                          {new Date(entry.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Open from Git tab */
            <>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                    Repository URL
                  </label>
                  <input
                    value={gitUrl}
                    onChange={(e) => setGitUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full text-[0.825rem]"
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Branch
                    </label>
                    <input
                      value={gitBranch}
                      onChange={(e) => setGitBranch(e.target.value)}
                      placeholder="main"
                      className="w-full text-[0.825rem]"
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                      Username
                    </label>
                    <input
                      value={gitUsername}
                      onChange={(e) => setGitUsername(e.target.value)}
                      placeholder="username"
                      className="w-full text-[0.825rem]"
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                    Personal Access Token
                  </label>
                  <input
                    type="password"
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    placeholder="ghp_xxxx..."
                    className="w-full text-[0.825rem]"
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* File list from Git repo */}
              {gitFiles.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[0.75rem] font-medium" style={{ color: 'var(--muted)' }}>
                    JSON Files in Repository
                  </div>
                  <div
                    className="max-h-[160px] overflow-y-auto rounded-lg"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {gitFiles.map((file) => (
                      <div
                        key={file.name}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[0.825rem]"
                        style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}
                        onClick={() => handleImportFile(file)}
                        onMouseOver={(e) => {
                          (e.currentTarget as HTMLElement).style.background = 'var(--fill-3)'
                        }}
                        onMouseOut={(e) => {
                          (e.currentTarget as HTMLElement).style.background = 'transparent'
                        }}
                      >
                        <span className="flex-1">{file.name}</span>
                        <span className="text-[0.75rem]" style={{ color: 'var(--hint)' }}>
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Status message */}
          {status && (
            <div
              className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[0.825rem]"
              style={{
                background: status.type === 'success' ? 'var(--greenBg)' : '#fff0f0',
                color: status.type === 'success' ? 'var(--green)' : '#cc2200',
              }}
            >
              {status.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
              {status.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-end gap-2 px-4"
          style={{ height: 52, borderTop: '1px solid var(--border)' }}
        >
          <button
            type="button"
            className="cursor-pointer text-[0.825rem]"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 16px',
              color: 'var(--text)',
            }}
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 text-[0.825rem]"
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
            }}
            disabled={loading}
            onClick={tabMode === 'save' ? handleSave : handleGitOpen}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {tabMode === 'save' ? 'Save' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
