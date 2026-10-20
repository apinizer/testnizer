import { useMemo, useState } from 'react'
import CommitChangesModal from '../modals/CommitChangesModal'
import DiscardChangesDialog from '../modals/DiscardChangesDialog'
import { useBranchStore } from '../../stores/branch.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { suggestedCommitMessage } from '../../lib/push-commit-message'
import {
  GIT_MERGE_IN_PROGRESS_ERROR,
  GIT_NOTHING_COMMITTED_ERROR,
} from '../../../shared/git-changes'

export type GitFlowMode = 'commit' | 'discard' | null

/**
 * Commit / Commit and push / Discard all changes (issue #207), opened from
 * the branch menu. Owns the dialogs and the store calls so the menu only
 * says which one to open. After every successful step the app re-syncs from
 * the DB (`syncAfterGit`, as pull / switch do) and the summary is re-read.
 */
export default function GitCommitFlow({
  mode,
  setMode,
}: {
  mode: GitFlowMode
  setMode: (mode: GitFlowMode) => void
}) {
  const { t, locale } = useTranslation()
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const projectName = useWorkspaceStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return p ? p.display_name || p.name : ''
  })
  const syncAfterGit = useWorkspaceStore((s) => s.syncAfterGit)
  const changes = useBranchStore((s) => s.changes)
  const changesLoading = useBranchStore((s) => s.changesLoading)
  const hasToken = useBranchStore((s) => s.hasToken)
  const fetchChanges = useBranchStore((s) => s.fetchChanges)
  const fetchBranches = useBranchStore((s) => s.fetchBranches)
  const commitChanges = useBranchStore((s) => s.commitChanges)
  const discardChanges = useBranchStore((s) => s.discardChanges)
  const pushBranch = useBranchStore((s) => s.pushBranch)
  const setGitLoading = useUIStore((s) => s.setGitLoading)
  const [busy, setBusy] = useState(false)

  // Computed in the render that opens the dialog: the stamp is the moment
  // the user clicked Commit, and the form mounts with it.
  const defaultMessage = useMemo(
    () => (mode === 'commit' ? suggestedCommitMessage(projectName || 'project', locale) : ''),
    [mode, projectName, locale],
  )

  function gitError(error: string | undefined, fallbackKey: string): string {
    if (error === GIT_MERGE_IN_PROGRESS_ERROR) return t('gitCommit.mergeInProgress')
    if (error === GIT_NOTHING_COMMITTED_ERROR) return t('gitCommit.nothingCommitted')
    return error || t(fallbackKey)
  }

  async function refresh(id: string): Promise<void> {
    await syncAfterGit(id)
    await fetchBranches(id)
    await fetchChanges(id)
  }

  async function runCommit(message: string, andPush: boolean, only?: string[]): Promise<void> {
    if (!projectId || busy) return
    setBusy(true)
    setGitLoading(andPush ? t('gitCommit.pushing') : t('gitCommit.committing'))
    try {
      if (andPush) {
        // The #136 path: commit with this message (only the checked changes,
        // issue #214), then push.
        const r = await pushBranch(projectId, message, only ? { only } : undefined)
        if (!r.success) {
          toast.error(gitError(r.error, 'toast.pushFailed'))
          return
        }
        toast.success(t(r.committed === false ? 'toast.pushedNoChanges' : 'toast.pushed'))
      } else {
        const r = await commitChanges(projectId, message, only)
        if (!r.success) {
          toast.error(gitError(r.error, 'gitCommit.commitFailed'))
          return
        }
        if (r.committed && r.partial) {
          toast.success(
            t('gitCommit.committedPartial')
              .replace('{included}', String(r.included ?? only?.length ?? 0))
              .replace('{count}', String(changes?.items.length ?? 0)),
          )
        } else {
          toast.success(t(r.committed ? 'gitCommit.committed' : 'gitCommit.nothingToCommit'))
        }
      }
      setMode(null)
      await refresh(projectId)
    } finally {
      setGitLoading(null)
      setBusy(false)
    }
  }

  async function runDiscard(): Promise<void> {
    if (!projectId || busy) return
    setBusy(true)
    setGitLoading(t('gitCommit.discarding'))
    try {
      const r = await discardChanges(projectId)
      if (!r.success) {
        toast.error(gitError(r.error, 'gitCommit.discardFailed'))
        return
      }
      toast.success(t('gitCommit.discarded'))
      setMode(null)
      // Rows the discard removed may be open in tabs; the same re-sync a
      // branch switch does handles that.
      await refresh(projectId)
    } finally {
      setGitLoading(null)
      setBusy(false)
    }
  }

  return (
    <>
      <CommitChangesModal
        open={mode === 'commit'}
        changes={changes}
        loading={changesLoading}
        defaultMessage={defaultMessage}
        canPush={hasToken}
        busy={busy}
        onCommit={(message, andPush, only) => void runCommit(message, andPush, only)}
        onDiscard={() => setMode('discard')}
        onCancel={() => setMode(null)}
      />
      <DiscardChangesDialog
        open={mode === 'discard'}
        count={changes?.items.length ?? 0}
        onConfirm={() => void runDiscard()}
        onCancel={() => setMode(null)}
      />
    </>
  )
}
