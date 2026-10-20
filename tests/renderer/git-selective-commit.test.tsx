/**
 * Issue #214 — choose which changes go into a commit (Insomnia Git Sync
 * parity), renderer side.
 *
 * Before: the Commit panel's list was read-only ("all of these changes are
 * committed together") and the Push dialog always committed every pending
 * change. Now each change has a checkbox (all checked by default), the
 * checked keys travel as `only`, a change pulls in what it requires and
 * unchecking pulls out what requires it, and the Push dialog can push the
 * existing commits only.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { GitChangesSummary } from '../../src/shared/git-changes'

const toastSuccess = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

import CommitChangesModal from '../../src/renderer/components/modals/CommitChangesModal'
import PushCommitModal from '../../src/renderer/components/modals/PushCommitModal'
import BranchDropdown from '../../src/renderer/components/sidebar/BranchDropdown'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const SUMMARY: GitChangesSummary = {
  items: [
    { kind: 'folder', id: 'f2', name: 'Billing', change: 'added' },
    { kind: 'endpoint', id: 'e3', name: 'Invoices', change: 'added', requires: ['folder:f2'] },
    { kind: 'endpoint', id: 'e4', name: 'Draft', change: 'added' },
    { kind: 'variable', id: 'v1', name: 'Dev › baseUrl', change: 'modified' },
  ],
  ahead: 0,
  behind: 0,
  branch: 'main',
  hasUpstream: true,
}

beforeEach(() => {
  toastSuccess.mockReset()
  useUIStore.setState({ locale: 'en' })
})
afterEach(cleanup)

function renderCommit() {
  const onCommit = vi.fn()
  render(
    <CommitChangesModal
      open
      changes={SUMMARY}
      loading={false}
      defaultMessage="msg"
      canPush
      busy={false}
      onCommit={onCommit}
      onDiscard={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  return { onCommit }
}

const box = (name: string): HTMLInputElement =>
  screen.getByRole('checkbox', { name }) as HTMLInputElement

describe('Commit panel checkboxes (issue #214)', () => {
  it('everything is checked by default and Commit sends no `only`', () => {
    const { onCommit } = renderCommit()
    expect(screen.getAllByTestId('git-change-checkbox')).toHaveLength(4)
    expect(
      screen.getAllByTestId('git-change-checkbox').every((c) => (c as HTMLInputElement).checked),
    ).toBe(true)
    fireEvent.click(screen.getByTestId('git-commit-confirm'))
    expect(onCommit).toHaveBeenLastCalledWith('msg', false, undefined)
  })

  it('unchecking a change commits only the checked keys; heading and note say so', () => {
    const { onCommit } = renderCommit()
    fireEvent.click(box('Draft'))
    expect(screen.getByTestId('git-changes-heading')).toHaveTextContent('Changes (3 of 4 selected)')
    expect(screen.getByTestId('git-changes-note')).toHaveTextContent(
      'Unchecked changes stay uncommitted',
    )
    fireEvent.click(screen.getByTestId('git-commit-confirm'))
    expect(onCommit).toHaveBeenLastCalledWith('msg', false, [
      'folder:f2',
      'endpoint:e3',
      'variable:v1',
    ])
    fireEvent.click(screen.getByTestId('git-commit-and-push'))
    expect(onCommit).toHaveBeenLastCalledWith('msg', true, [
      'folder:f2',
      'endpoint:e3',
      'variable:v1',
    ])
  })

  it('unchecking a folder unchecks the request that needs it; checking the request brings it back', () => {
    renderCommit()
    fireEvent.click(box('Billing'))
    expect(box('Billing').checked).toBe(false)
    expect(box('Invoices').checked).toBe(false)
    expect(box('Draft').checked).toBe(true)
    fireEvent.click(box('Invoices'))
    expect(box('Invoices').checked).toBe(true)
    expect(box('Billing').checked).toBe(true)
    expect(
      screen.getAllByTestId('git-change-item').find((r) => r.textContent?.includes('Invoices')),
    ).toHaveAttribute('title', 'Committed together with: Billing')
  })

  it('group and select-all checkboxes; nothing selected disables both commit buttons', () => {
    renderCommit()
    const endpoints = within(
      screen
        .getAllByTestId('git-changes-group')
        .find((g) => g.getAttribute('data-kind') === 'endpoint')!,
    ).getByTestId('git-change-group-checkbox')
    fireEvent.click(endpoints)
    expect(box('Invoices').checked).toBe(false)
    expect(box('Draft').checked).toBe(false)
    expect((endpoints as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByTestId('git-changes-select-all')) // some → all
    expect(
      screen.getAllByTestId('git-change-checkbox').every((c) => (c as HTMLInputElement).checked),
    ).toBe(true)
    fireEvent.click(screen.getByTestId('git-changes-select-all')) // all → none
    expect(screen.getByTestId('git-commit-confirm')).toBeDisabled()
    expect(screen.getByTestId('git-commit-and-push')).toBeDisabled()
  })
})

describe('branch menu → selective Commit (store → bridge)', () => {
  const git = { changes: vi.fn(), commit: vi.fn(), discard: vi.fn(), push: vi.fn(), pull: vi.fn() }

  beforeEach(() => {
    for (const fn of Object.values(git)) fn.mockReset()
    ;(window as unknown as { api: Record<string, unknown> }).api = { git }
    useWorkspaceStore.setState({
      activeProjectId: 'p1',
      projects: [
        { id: 'p1', name: 'banking', display_name: 'Banking APIs' },
      ] as unknown as ReturnType<typeof useWorkspaceStore.getState>['projects'],
      syncAfterGit: vi.fn(async () => {}),
    })
    useBranchStore.setState({
      hasGit: true,
      hasToken: true,
      changes: null,
      currentBranch: 'main',
      branches: [{ name: 'main', current: true, isRemote: false }],
      ensureDefault: vi.fn(async () => {}),
      fetchBranches: vi.fn(async () => {}),
    })
    git.changes.mockResolvedValue({ success: true, data: SUMMARY })
  })

  async function openCommit(): Promise<void> {
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    await waitFor(() => expect(screen.getByTestId('branch-sync-counts')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('branch-commit'))
    await screen.findByTestId('git-commit-message')
  }

  it('Commit passes `only` to git:commit and reports the partial commit', async () => {
    git.commit.mockResolvedValue({
      success: true,
      data: { committed: true, partial: true, included: 3, sha: 'abc', branch: 'main' },
    })
    await openCommit()
    fireEvent.click(box('Draft'))
    fireEvent.click(screen.getByTestId('git-commit-confirm'))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Committed 3 of 4 changes locally — the rest stay uncommitted',
      ),
    )
    expect(git.commit).toHaveBeenCalledWith('p1', expect.stringMatching(/^Update Banking APIs/), {
      only: ['folder:f2', 'endpoint:e3', 'variable:v1'],
    })
  })

  it('Commit and push passes `only` to git:push', async () => {
    git.push.mockResolvedValue({ success: true, data: { branch: 'main', committed: true } })
    await openCommit()
    fireEvent.click(box('Draft'))
    fireEvent.click(screen.getByTestId('git-commit-and-push'))
    await waitFor(() => expect(git.push).toHaveBeenCalled())
    expect(git.push).toHaveBeenCalledWith('p1', {
      commitMessage: expect.stringMatching(/^Update Banking APIs/),
      only: ['folder:f2', 'endpoint:e3', 'variable:v1'],
    })
  })
})

describe('Push dialog: uncommitted changes (issue #214)', () => {
  beforeEach(() => {
    useBranchStore.setState({ changes: SUMMARY, fetchChanges: vi.fn(async () => SUMMARY) })
  })

  function renderPush() {
    const onConfirm = vi.fn()
    render(
      <PushCommitModal
        open
        projectId="p1"
        defaultMessage="msg"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    return { onConfirm }
  }

  it('says how many changes the push would commit; checked by default (the #136 behaviour)', () => {
    const { onConfirm } = renderPush()
    const include = screen.getByTestId('push-include-pending') as HTMLInputElement
    expect(include.checked).toBe(true)
    expect(include.closest('label')).toHaveTextContent('Commit the 4 uncommitted changes first')
    expect(useBranchStore.getState().fetchChanges).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByTestId('push-commit-confirm'))
    expect(onConfirm).toHaveBeenCalledWith('msg', { commitPending: true })
  })

  it('unchecked: no message needed, "Push commits", commitPending false', () => {
    const { onConfirm } = renderPush()
    fireEvent.click(screen.getByTestId('push-include-pending'))
    const input = screen.getByTestId('push-commit-message') as HTMLInputElement
    expect(input).toBeDisabled()
    fireEvent.change(input, { target: { value: '' } })
    const confirm = screen.getByTestId('push-commit-confirm')
    expect(confirm).toHaveTextContent('Push commits')
    expect(confirm).toBeEnabled()
    expect(screen.getByText(/the changes stay uncommitted/)).toBeInTheDocument()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('', { commitPending: false })
  })

  it('no pending changes: no choice is shown', () => {
    useBranchStore.setState({ changes: { ...SUMMARY, items: [] } })
    renderPush()
    expect(screen.queryByTestId('push-include-pending')).toBeNull()
  })

  it('Turkish', () => {
    useUIStore.setState({ locale: 'tr' })
    renderPush()
    expect(screen.getByTestId('push-include-pending').closest('label')).toHaveTextContent(
      'Önce commit edilmemiş 4 değişikliği commit et',
    )
    fireEvent.click(screen.getByTestId('push-include-pending'))
    expect(screen.getByTestId('push-commit-confirm')).toHaveTextContent("Commit'leri gönder")
  })
})
