import { useState } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import BranchDropdown from '../sidebar/BranchDropdown'
import PushCommitModal, { type PushChoice } from '../modals/PushCommitModal'
import { suggestedCommitMessage } from '../../lib/push-commit-message'
import { pullWarnings, type PullNotices } from '../../lib/pull-messages'
import { toast } from '../../lib/toast'
import { gitErrorText } from '../../lib/git-error-text'
import { formatShortcut } from '../../lib/shortcut-format'
import HeaderGitOpButton, { type OpStatus } from './HeaderGitOpButton'

/**
 * The header's right-hand project actions: status message, branch, Pull,
 * Push and Save. Split out of `Header.tsx` (which was ~500 lines); the
 * header lays it out as a non-shrinking group so these never leave the
 * screen however many project tabs are open (tester finding 7).
 */
export default function HeaderProjectActions() {
  const setShowSaveModal = useUIStore((s) => s.setShowSaveModal)
  const syncAfterGit = useWorkspaceStore((s) => s.syncAfterGit)
  const setGitLoading = useUIStore((s) => s.setGitLoading)
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const { t, locale } = useTranslation()

  const [saveStatus, setSaveStatus] = useState<OpStatus>('idle')
  const [pushStatus, setPushStatus] = useState<OpStatus>('idle')
  const [pullStatus, setPullStatus] = useState<OpStatus>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  // Commit message being edited in the Push dialog; null = dialog closed.
  const [pushDraft, setPushDraft] = useState<string | null>(null)

  const isGitProject =
    activeProject && (activeProject.save_mode === 'git' || activeProject.save_mode === 'both')

  // ─── Local save ──────────────────────────────────────────
  async function handleSave() {
    if (!activeProject) {
      setShowSaveModal(true)
      return
    }
    const mode = activeProject.save_mode || 'local'

    if (mode === 'local' || mode === 'both') {
      setSaveStatus('loading')
      try {
        const result = (await window.api?.save?.local({
          projectId: activeProject.id,
          directoryPath: activeProject.local_path || undefined,
        })) as { success: boolean; error?: string }
        if (result?.success) {
          setSaveStatus('success')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } else if (result?.error === 'Cancelled') {
          // User backed out of the directory picker — don't punish that by
          // popping the Save modal on top (issue #2).
          setSaveStatus('idle')
        } else {
          setShowSaveModal(true)
          setSaveStatus('idle')
        }
      } catch {
        setShowSaveModal(true)
        setSaveStatus('idle')
      }
      return
    }
    // git-only mode: use push (through the commit-message dialog)
    handlePush()
  }

  /** Show a git op's outcome, then clear it (success 3 s, error 5 s — as before). */
  function finishOp(setOp: (st: OpStatus) => void, status: 'success' | 'error', msg: string) {
    setStatusMsg(msg)
    setOp(status)
    setTimeout(
      () => {
        setOp('idle')
        setStatusMsg('')
      },
      status === 'success' ? 3000 : 5000,
    )
  }

  // ─── Git push (uses real git — pushes current branch) ────
  // Push asks for the commit message first (issue #136); `runPush` does it.
  function handlePush() {
    if (!activeProject) return
    setPushDraft(suggestedCommitMessage(activeProject.display_name || activeProject.name, locale))
  }

  async function runPush(commitMessage: string, choice?: PushChoice) {
    setPushDraft(null)
    if (!activeProject) return
    setPushStatus('loading')
    setStatusMsg('')
    setGitLoading(t('git.pushing'))
    try {
      const result = await window.api.git.push(activeProject.id, {
        commitMessage,
        commitPending: choice?.commitPending !== false,
      })
      if (result?.success) {
        const done = result.data?.committed === false ? 'toast.pushedNoChanges' : 'toast.pushed'
        finishOp(
          setPushStatus,
          'success',
          `${t(done)} (${result.data?.branch || t('git.branchFallback')})`,
        )
      } else {
        finishOp(setPushStatus, 'error', gitErrorText(result) || t('toast.pushFailed'))
      }
    } catch (e) {
      finishOp(setPushStatus, 'error', (e as Error).message)
    }
    setGitLoading(null)
  }

  // ─── Git pull (uses real git — pulls current branch) ────
  async function handlePull() {
    if (!activeProject) return
    setPullStatus('loading')
    setStatusMsg('')
    setGitLoading(t('git.pulling'))
    try {
      const result = await window.api.git.pull(activeProject.id)
      if (result?.success) {
        const branch = result.data?.branch || t('git.branchFallback')
        // A pull that stopped on conflicts (nothing imported — the branch
        // dropdown's conflict flow takes over) or found no project .json is
        // not a success from the user's seat — say so instead of "pulled".
        // Shown for 3 s like a success, as before.
        if (result.data?.state === 'conflicted') {
          setStatusMsg(`${t('toast.pullConflicted')} (${branch})`)
          setPullStatus('error')
        } else if (result.data?.imported === false) {
          setStatusMsg(`${t('toast.pullNoProjectFile')} (${branch})`)
          setPullStatus('error')
        } else {
          setStatusMsg(`${t('toast.pulled')} (${branch})`)
          setPullStatus('success')
          pullWarnings(t, result.data as PullNotices | undefined).forEach((m) => toast.warning(m))
        }
        // git:pull already re-imported the pulled project file into the DB.
        // Refresh project list (a rename may have arrived), tree, tabs, stores.
        await syncAfterGit(activeProject.id)
        setTimeout(() => {
          setPullStatus('idle')
          setStatusMsg('')
        }, 3000)
      } else {
        finishOp(setPullStatus, 'error', gitErrorText(result) || t('toast.pullFailed'))
      }
    } catch (e) {
      finishOp(setPullStatus, 'error', (e as Error).message)
    }
    setGitLoading(null)
  }

  const anyLoading =
    saveStatus === 'loading' || pushStatus === 'loading' || pullStatus === 'loading'

  return (
    <>
      {/* Status message */}
      {/* Bounded so a long git error can never push the buttons off screen. */}
      {statusMsg && (
        <div
          data-testid="header-status"
          title={statusMsg}
          className="no-drag min-w-0 max-w-[280px] truncate"
          style={{
            fontSize: 13,
            padding: '2px 10px',
            borderRadius: 4,
            color: pushStatus === 'error' || pullStatus === 'error' ? 'var(--red)' : 'var(--green)',
            background:
              pushStatus === 'error' || pullStatus === 'error'
                ? 'rgba(239,68,68,0.1)'
                : 'var(--green-bg)',
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Branch dropdown */}
      <BranchDropdown pill />

      {isGitProject && (
        <HeaderGitOpButton
          kind="pull"
          status={pullStatus}
          anyLoading={anyLoading}
          onClick={handlePull}
        />
      )}
      {isGitProject && (
        <HeaderGitOpButton
          kind="push"
          status={pushStatus}
          anyLoading={anyLoading}
          onClick={handlePush}
        />
      )}

      {/* Local Save */}
      <button
        type="button"
        onClick={handleSave}
        disabled={anyLoading}
        data-testid="header-save"
        title={`${t('header.saveProjectHint')} (${formatShortcut(['Mod', 'Shift', 'S'])})`}
        aria-label={t('header.saveProjectHint')}
        className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-[7px] border bg-transparent px-2.5 py-1 text-sm transition-all duration-200 ${
          saveStatus === 'success'
            ? 'border-[var(--green)] text-[var(--green)]'
            : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
        }`}
      >
        {saveStatus === 'loading' ? (
          <Loader2 size={12} aria-hidden="true" className="animate-spin" />
        ) : (
          <Save size={12} aria-hidden="true" />
        )}
        {saveStatus === 'success' && <span>✓</span>}
      </button>

      <PushCommitModal
        open={pushDraft !== null}
        projectId={activeProject?.id}
        defaultMessage={pushDraft ?? ''}
        onConfirm={runPush}
        onCancel={() => setPushDraft(null)}
      />
    </>
  )
}
