/**
 * Issue #207 — Commit panel, Discard confirmation and the branch menu's
 * ahead/behind + disabled states.
 *
 * Before: the branch menu had Push / Pull / Merge only — no local commit,
 * no discard, no pre-commit summary (there is no `branch-commit`,
 * `branch-discard` or `git-commit-modal` to find).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { GitChangesSummary } from '../../src/shared/git-changes'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

import CommitChangesModal from '../../src/renderer/components/modals/CommitChangesModal'
import BranchDropdown from '../../src/renderer/components/sidebar/BranchDropdown'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const SUMMARY: GitChangesSummary = {
  items: [
    { kind: 'folder', id: 'f1', name: 'Legacy', change: 'deleted' },
    { kind: 'endpoint', id: 'e1', name: 'Payments', change: 'added' },
    { kind: 'endpoint', id: 'e2', name: 'Orders', change: 'modified' },
    { kind: 'variable', id: 'v1', name: 'Dev › baseUrl', change: 'modified' },
  ],
  ahead: 2,
  behind: 1,
  branch: 'feature/x',
  hasUpstream: true,
}

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  useUIStore.setState({ locale: 'en' })
})
afterEach(cleanup)

describe('CommitChangesModal', () => {
  function renderModal(over: Partial<React.ComponentProps<typeof CommitChangesModal>> = {}) {
    const onCommit = vi.fn()
    const onDiscard = vi.fn()
    const onCancel = vi.fn()
    render(
      <CommitChangesModal
        open
        changes={SUMMARY}
        loading={false}
        defaultMessage="Update Banking — now"
        canPush
        busy={false}
        onCommit={onCommit}
        onDiscard={onDiscard}
        onCancel={onCancel}
        {...over}
      />,
    )
    return { onCommit, onDiscard, onCancel }
  }

  it('lists the changes grouped by kind with A / M / D markers and a count', () => {
    renderModal()
    expect(screen.getByTestId('git-changes-heading')).toHaveTextContent('Changes (4)')
    const groups = screen.getAllByTestId('git-changes-group')
    expect(groups.map((g) => g.getAttribute('data-kind'))).toEqual([
      'folder',
      'endpoint',
      'variable',
    ])
    expect(groups[1]).toHaveTextContent('Endpoints · 2')
    const rows = within(groups[1]).getAllByTestId('git-change-item')
    expect(rows.map((r) => [r.textContent, r.getAttribute('data-change')])).toEqual([
      ['APayments', 'added'],
      ['MOrders', 'modified'],
    ])
    expect(within(groups[0]).getByTestId('git-change-item')).toHaveTextContent('DLegacy')
    expect(groups[2]).toHaveTextContent('Dev › baseUrl')
  })

  it('Commit / Commit and push / Discard call back with the trimmed message', () => {
    const { onCommit, onDiscard } = renderModal()
    fireEvent.change(screen.getByTestId('git-commit-message'), {
      target: { value: '  feat: payments  ' },
    })
    fireEvent.click(screen.getByTestId('git-commit-confirm'))
    expect(onCommit).toHaveBeenLastCalledWith('feat: payments', false, undefined)
    fireEvent.click(screen.getByTestId('git-commit-and-push'))
    expect(onCommit).toHaveBeenLastCalledWith('feat: payments', true, undefined)
    fireEvent.click(screen.getByTestId('git-commit-discard'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('nothing to commit, a blank message or no token disable the matching buttons', () => {
    renderModal({ changes: { ...SUMMARY, items: [], ahead: 0 }, canPush: false })
    expect(screen.getByTestId('git-changes-empty')).toHaveTextContent(
      'No changes since the last commit',
    )
    expect(screen.getByTestId('git-commit-confirm')).toBeDisabled()
    expect(screen.getByTestId('git-commit-discard')).toBeDisabled()
    expect(screen.getByTestId('git-commit-and-push')).toBeDisabled()
    cleanup()

    renderModal()
    fireEvent.change(screen.getByTestId('git-commit-message'), { target: { value: '   ' } })
    expect(screen.getByTestId('git-commit-confirm')).toBeDisabled()
    expect(screen.getByTestId('git-commit-and-push')).toBeDisabled()
  })

  it('speaks Turkish', () => {
    useUIStore.setState({ locale: 'tr' })
    renderModal()
    expect(screen.getByTestId('git-commit-confirm')).toHaveTextContent('Commit et')
    expect(screen.getByTestId('git-commit-and-push')).toHaveTextContent('Commit et ve gönder')
    expect(screen.getByTestId('git-commit-discard')).toHaveTextContent('Tüm değişiklikleri at')
    expect(screen.getByTestId('git-changes-heading')).toHaveTextContent('Değişiklikler (4)')
  })
})

describe('branch menu → Commit / Discard (store → bridge)', () => {
  const git = {
    changes: vi.fn(),
    commit: vi.fn(),
    discard: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
  }
  const syncAfterGit = vi.fn(async () => {})

  beforeEach(() => {
    for (const fn of Object.values(git)) fn.mockReset()
    syncAfterGit.mockClear()
    ;(window as unknown as { api: Record<string, unknown> }).api = { git }
    useWorkspaceStore.setState({
      activeProjectId: 'p1',
      projects: [
        { id: 'p1', name: 'banking', display_name: 'Banking APIs' },
      ] as unknown as ReturnType<typeof useWorkspaceStore.getState>['projects'],
      syncAfterGit,
    })
    useBranchStore.setState({
      hasGit: true,
      hasToken: true,
      changes: null,
      currentBranch: 'feature/x',
      branches: [{ name: 'feature/x', current: true, isRemote: false }],
      ensureDefault: vi.fn(async () => {}),
      fetchBranches: vi.fn(async () => {}),
    })
  })

  async function openMenu(summary: GitChangesSummary): Promise<void> {
    git.changes.mockResolvedValue({ success: true, data: summary })
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    await waitFor(() => expect(screen.getByTestId('branch-sync-counts')).toBeInTheDocument())
  }

  it('shows "behind↓ ahead↑" and the counts on Pull / Push / Commit', async () => {
    await openMenu(SUMMARY)
    expect(git.changes).toHaveBeenCalledWith('p1')
    expect(screen.getByTestId('branch-sync-counts')).toHaveTextContent('1↓ 2↑')
    expect(screen.getByTestId('branch-pull')).toHaveTextContent('1↓')
    expect(screen.getByTestId('branch-push')).toHaveTextContent('2↑')
    expect(screen.getByTestId('branch-commit')).toHaveTextContent('4')
  })

  it('Commit… opens the panel; Commit commits locally with the typed message and re-syncs', async () => {
    git.commit.mockResolvedValue({
      success: true,
      data: { committed: true, sha: 'abc', branch: 'feature/x' },
    })
    await openMenu(SUMMARY)
    fireEvent.click(screen.getByTestId('branch-commit'))
    const input = (await screen.findByTestId('git-commit-message')) as HTMLTextAreaElement
    expect(input.value).toMatch(/^Update Banking APIs — /)
    expect(screen.getAllByTestId('git-change-item')).toHaveLength(4)

    fireEvent.change(input, { target: { value: 'feat: payments' } })
    fireEvent.click(screen.getByTestId('git-commit-confirm'))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Committed locally — push to share it'),
    )
    expect(git.commit).toHaveBeenCalledWith('p1', 'feat: payments')
    expect(git.push).not.toHaveBeenCalled()
    expect(syncAfterGit).toHaveBeenCalledWith('p1')
  })

  it('Commit and push goes through git:push with the typed message (issue #136 path)', async () => {
    git.push.mockResolvedValue({
      success: true,
      data: { branch: 'feature/x', pushed: true, committed: true },
    })
    await openMenu(SUMMARY)
    fireEvent.click(screen.getByTestId('branch-commit'))
    fireEvent.change(await screen.findByTestId('git-commit-message'), {
      target: { value: 'feat: ship it' },
    })
    fireEvent.click(screen.getByTestId('git-commit-and-push'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Pushed successfully'))
    expect(git.push).toHaveBeenCalledWith('p1', { commitMessage: 'feat: ship it' })
    expect(git.commit).not.toHaveBeenCalled()
  })

  it('Discard all changes asks first, naming the count; only Confirm discards', async () => {
    git.discard.mockResolvedValue({ success: true, data: { discarded: true, file: 'x.json' } })
    await openMenu(SUMMARY)
    fireEvent.click(screen.getByTestId('branch-discard'))
    expect(await screen.findByTestId('git-discard-body')).toHaveTextContent(
      '4 changes will be lost',
    )
    expect(screen.getByTestId('git-discard-confirm')).toHaveTextContent('Discard 4 changes')
    expect(git.discard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('git-discard-cancel'))
    await waitFor(() => expect(screen.queryByTestId('git-discard-dialog')).toBeNull())
    expect(git.discard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('branch-pill'))
    await waitFor(() => expect(screen.getByTestId('branch-discard')).toBeEnabled())
    fireEvent.click(screen.getByTestId('branch-discard'))
    fireEvent.click(await screen.findByTestId('git-discard-confirm'))
    await waitFor(() => expect(git.discard).toHaveBeenCalledWith('p1'))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Changes discarded — back to the last commit'),
    )
    expect(syncAfterGit).toHaveBeenCalledWith('p1')
  })

  it('a refused discard (merge in progress) shows the translated reason', async () => {
    const { GIT_MERGE_IN_PROGRESS_ERROR } = await import('../../src/shared/git-changes')
    git.discard.mockResolvedValue({ success: false, error: GIT_MERGE_IN_PROGRESS_ERROR })
    useUIStore.setState({ locale: 'tr' })
    await openMenu(SUMMARY)
    fireEvent.click(screen.getByTestId('branch-discard'))
    fireEvent.click(await screen.findByTestId('git-discard-confirm'))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Devam eden bir birleştirme var. Önce dal menüsünden çözün veya iptal edin.',
      ),
    )
  })

  it('disabled states: nothing to commit, nothing ahead, no upstream', async () => {
    // Tracked branch, nothing ahead, nothing to commit: Commit / Discard / Push off.
    await openMenu({ items: [], ahead: 0, behind: 0, branch: 'feature/x', hasUpstream: true })
    expect(screen.getByTestId('branch-sync-counts')).toHaveTextContent('0↓ 0↑')
    expect(screen.getByTestId('branch-commit')).toBeDisabled()
    expect(screen.getByTestId('branch-discard')).toBeDisabled()
    expect(screen.getByTestId('branch-push')).toBeDisabled()
    expect(screen.getByTestId('branch-pull')).toBeEnabled()
    expect(screen.getByTestId('branch-merge')).toBeEnabled()
    cleanup()

    // No origin/<branch> (master-only remote, or a branch created offline):
    // nothing to Pull, but Push is what publishes the branch — stays enabled.
    await openMenu({ items: [], ahead: 0, behind: 0, branch: 'feature/x', hasUpstream: false })
    expect(screen.getByTestId('branch-pull')).toBeDisabled()
    expect(screen.getByTestId('branch-push')).toBeEnabled()
    expect(screen.getByTestId('branch-commit')).toBeDisabled()
    cleanup()

    // A local commit ahead: Push applies, Commit does not.
    await openMenu({ items: [], ahead: 1, behind: 0, branch: 'feature/x', hasUpstream: true })
    expect(screen.getByTestId('branch-commit')).toBeDisabled()
    expect(screen.getByTestId('branch-push')).toBeEnabled()
  })

  it('unknown summary (older bridge without git.changes) disables nothing', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api = { git: { push: git.push } }
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    await waitFor(() => expect(screen.getByTestId('branch-push')).toBeEnabled())
    expect(screen.getByTestId('branch-pull')).toBeEnabled()
    expect(screen.getByTestId('branch-commit')).toBeEnabled()
    expect(screen.queryByTestId('branch-sync-counts')).toBeNull()
  })
})
