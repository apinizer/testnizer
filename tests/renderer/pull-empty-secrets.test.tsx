/**
 * Git fidelity — secrets never travel through git (issue #177), so after a
 * pull the teammate is told how many secret values are still empty on their
 * machine instead of meeting a silent 401 on the first Send.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const toastSuccess = vi.fn()
const toastWarning = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: vi.fn(),
    info: vi.fn(),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}))

import BranchDropdown from '../../src/renderer/components/sidebar/BranchDropdown'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { emptySecretsMessage } from '../../src/renderer/lib/pull-messages'
import { useTranslation } from '../../src/renderer/lib/i18n'

const git = { changes: vi.fn(), pull: vi.fn() }

beforeEach(() => {
  toastSuccess.mockReset()
  toastWarning.mockReset()
  useUIStore.setState({ locale: 'en' })
  ;(window as unknown as { api: Record<string, unknown> }).api = { git }
  git.changes.mockResolvedValue({ success: false })
  useWorkspaceStore.setState({
    activeProjectId: 'p1',
    projects: [{ id: 'p1', name: 'banking' }] as unknown as ReturnType<
      typeof useWorkspaceStore.getState
    >['projects'],
    syncAfterGit: vi.fn(async () => {}),
  })
  useBranchStore.setState({
    hasGit: true,
    hasToken: true,
    currentBranch: 'main',
    branches: [{ name: 'main', current: true, isRemote: false }],
    ensureDefault: vi.fn(async () => {}),
    fetchBranches: vi.fn(async () => {}),
  })
})
afterEach(cleanup)

async function pull(data: Record<string, unknown>): Promise<void> {
  git.pull.mockResolvedValue({ success: true, data: { state: 'clean', branch: 'main', ...data } })
  render(<BranchDropdown />)
  fireEvent.click(screen.getByTestId('branch-pill'))
  fireEvent.click(await screen.findByTestId('branch-pull'))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Pulled successfully'))
}

describe('pull → empty secrets warning', () => {
  it('warns with the count when secret values are still empty here', async () => {
    await pull({ emptySecrets: 3 })
    expect(toastWarning).toHaveBeenCalledWith(
      '3 secret values are empty on this machine (secrets never travel through git) — fill them in Environments / project settings',
    )
  })

  it('says nothing extra when nothing is empty', async () => {
    await pull({ emptySecrets: 0 })
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('singular and Turkish', () => {
    function Probe({ n }: { n: number }) {
      const { t } = useTranslation()
      return <span data-testid="m">{emptySecretsMessage(t, n)}</span>
    }
    useUIStore.setState({ locale: 'tr' })
    render(<Probe n={1} />)
    expect(screen.getByTestId('m')).toHaveTextContent('Bu makinede 1 gizli değer boş')
  })
})
