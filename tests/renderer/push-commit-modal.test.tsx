/**
 * Issue #136 — Push asks for a commit message before committing.
 *
 * Before: Push (header button + branch dropdown) committed straight away with
 * an automatic "Update <name> — <date>" message; the user could not type one.
 * Now both open `PushCommitModal`, prefilled with that suggestion, and the
 * typed message travels `pushBranch` → `window.api.git.push(id, {commitMessage})`.
 *
 * Blank-message policy (documented on the modal's `onConfirm` prop): a blank /
 * whitespace-only message is REJECTED — confirm disabled, Enter ignored, an
 * inline hint shown — rather than silently replaced by the default.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

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

import PushCommitModal from '../../src/renderer/components/modals/PushCommitModal'
import BranchDropdown from '../../src/renderer/components/sidebar/BranchDropdown'
import { suggestedCommitMessage } from '../../src/renderer/lib/push-commit-message'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const DEFAULT = 'Update Banking APIs — 10/7/2026, 9:00:00 AM'

function renderModal(over: Partial<React.ComponentProps<typeof PushCommitModal>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <PushCommitModal
      open
      defaultMessage={DEFAULT}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  )
  const input = screen.getByTestId('push-commit-message') as HTMLInputElement
  return { onConfirm, onCancel, input }
}

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  useUIStore.setState({ locale: 'en' })
})
afterEach(cleanup)

describe('PushCommitModal', () => {
  it('opens prefilled with the suggested message, focused and fully selected', async () => {
    const { input } = renderModal()
    expect(screen.getByTestId('push-commit-modal')).toBeInTheDocument()
    expect(input.value).toBe(DEFAULT)
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(DEFAULT.length)
    expect(screen.getByTestId('push-commit-confirm')).toBeEnabled()
  })

  it('confirm sends the typed message, trimmed', () => {
    const { input, onConfirm, onCancel } = renderModal()
    fireEvent.change(input, { target: { value: '  feat: add login endpoint  ' } })
    fireEvent.click(screen.getByTestId('push-commit-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('feat: add login endpoint')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter in the message field confirms', () => {
    const { input, onConfirm } = renderModal()
    fireEvent.change(input, { target: { value: 'fix: typo in header' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('fix: typo in header')
  })

  it('Enter while an IME composition is open does not confirm', () => {
    const { input, onConfirm } = renderModal()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Cancel and Escape both cancel without confirming', () => {
    const first = renderModal()
    fireEvent.click(screen.getByTestId('push-commit-cancel'))
    expect(first.onCancel).toHaveBeenCalledTimes(1)
    cleanup()

    const second = renderModal()
    fireEvent.keyDown(second.input, { key: 'Escape' })
    expect(second.onCancel).toHaveBeenCalledTimes(1)
    expect(first.onConfirm).not.toHaveBeenCalled()
    expect(second.onConfirm).not.toHaveBeenCalled()
  })

  it('a blank / whitespace-only message is rejected, not swapped for the default', () => {
    const { input, onConfirm } = renderModal()
    fireEvent.change(input, { target: { value: '   ' } })
    const confirm = screen.getByTestId('push-commit-confirm')
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Commit message cannot be empty')
    fireEvent.click(confirm)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    render(
      <PushCommitModal
        open={false}
        defaultMessage={DEFAULT}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('push-commit-modal')).toBeNull()
  })

  it('speaks Turkish when the app locale is TR', () => {
    useUIStore.setState({ locale: 'tr' })
    renderModal()
    expect(screen.getByTestId('push-commit-confirm')).toHaveTextContent('Commit ve gönder')
    expect(screen.getByTestId('push-commit-cancel')).toHaveTextContent('İptal')
  })
})

describe('suggestedCommitMessage', () => {
  it('is "Update <name> — <date in the app locale>"', () => {
    const at = new Date(2026, 9, 7, 9, 5, 0)
    expect(suggestedCommitMessage('Banking APIs', 'en', at)).toBe(
      `Update Banking APIs — ${at.toLocaleString('en-US')}`,
    )
    expect(suggestedCommitMessage('Banking APIs', 'tr', at)).toBe(
      `Update Banking APIs — ${at.toLocaleString('tr-TR')}`,
    )
  })
})

describe('Push wiring (branch dropdown → store → bridge)', () => {
  const push = vi.fn()

  beforeEach(() => {
    push.mockReset()
    ;(window as unknown as { api: Record<string, unknown> }).api = { git: { push } }
    useWorkspaceStore.setState({
      activeProjectId: 'p1',
      projects: [
        { id: 'p1', name: 'banking', display_name: 'Banking APIs' },
      ] as unknown as ReturnType<typeof useWorkspaceStore.getState>['projects'],
    })
    // Keep mount-time IPC (hasConfig / listBranches) out of the picture.
    useBranchStore.setState({
      hasGit: true,
      currentBranch: 'main',
      branches: [{ name: 'main', current: true, isRemote: false }],
      ensureDefault: vi.fn(async () => {}),
      fetchBranches: vi.fn(async () => {}),
    })
  })

  it('store: pushBranch forwards the message and reports whether a commit was made', async () => {
    push.mockResolvedValueOnce({
      success: true,
      data: { branch: 'main', pushed: true, committed: true },
    })
    const made = await useBranchStore.getState().pushBranch('p1', 'feat: x')
    expect(push).toHaveBeenCalledWith('p1', { commitMessage: 'feat: x' })
    expect(made).toEqual({ success: true, committed: true })

    push.mockResolvedValueOnce({
      success: true,
      data: { branch: 'main', pushed: true, committed: false },
    })
    expect(await useBranchStore.getState().pushBranch('p1', 'feat: x')).toEqual({
      success: true,
      committed: false,
    })
  })

  it('dropdown Push opens the dialog first; confirming pushes the typed message', async () => {
    push.mockResolvedValue({
      success: true,
      data: { branch: 'main', pushed: true, committed: true },
    })
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    fireEvent.click(screen.getByTestId('branch-push'))

    // Nothing is committed until the user confirms.
    expect(push).not.toHaveBeenCalled()
    const input = (await screen.findByTestId('push-commit-message')) as HTMLInputElement
    expect(input.value).toMatch(/^Update Banking APIs — /)

    fireEvent.change(input, { target: { value: 'feat: add login endpoint' } })
    fireEvent.click(screen.getByTestId('push-commit-confirm'))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Pushed successfully'))
    expect(push).toHaveBeenCalledWith('p1', { commitMessage: 'feat: add login endpoint' })
    expect(screen.queryByTestId('push-commit-modal')).toBeNull()
  })

  it('nothing new to commit → the "pushed, nothing new" toast', async () => {
    push.mockResolvedValue({
      success: true,
      data: { branch: 'main', pushed: true, committed: false },
    })
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    fireEvent.click(screen.getByTestId('branch-push'))
    fireEvent.click(await screen.findByTestId('push-commit-confirm'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Pushed — nothing new to commit'))
  })

  it('Cancel pushes nothing', async () => {
    render(<BranchDropdown />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    fireEvent.click(screen.getByTestId('branch-push'))
    fireEvent.click(await screen.findByTestId('push-commit-cancel'))
    await waitFor(() => expect(screen.queryByTestId('push-commit-modal')).toBeNull())
    expect(push).not.toHaveBeenCalled()
  })
})
