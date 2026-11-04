/**
 * A repository can hold `extra.json -> /dev/zero`. A read leaves such a file out,
 * and the person pulling is told which files were left out.
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
import SaveModal from '../../src/renderer/components/modals/SaveModal'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { skippedFilesMessage } from '../../src/renderer/lib/pull-messages'
import { t, setLocale } from '../../src/renderer/lib/i18n'

const git = { changes: vi.fn(), pull: vi.fn() }

beforeEach(() => {
  toastSuccess.mockReset()
  toastWarning.mockReset()
  setLocale('en')
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

describe('pull → skipped files', () => {
  it('Pull from the branch menu names them', async () => {
    await pull({ skippedFiles: ['extra.json', 'link.json'] })
    expect(toastWarning).toHaveBeenCalledWith(
      '2 files in the repository were not read because each is a link, a special file or too large: extra.json, link.json',
    )
  })

  it('says nothing extra when none were skipped', async () => {
    await pull({ skippedFiles: [] })
    expect(toastWarning).not.toHaveBeenCalled()
  })
})

describe('the Save dialog', () => {
  const save = {
    gitPull: vi.fn(),
    gitListFiles: vi.fn(),
    gitDiff: vi.fn(async () => ({ success: false })),
    getHistory: vi.fn(async () => ({ success: true, data: [] })),
  }
  const openTab = (name: RegExp): void => {
    render(<SaveModal />)
    fireEvent.click(screen.getByRole('button', { name }))
  }
  beforeEach(() => {
    ;(window as unknown as { api: Record<string, unknown> }).api = { git, save }
    useUIStore.setState({ showSaveModal: true })
    useBranchStore.setState({ fetchSaveHistory: vi.fn(async () => {}), saveHistory: [] })
  })

  it('Pull names them', async () => {
    save.gitPull.mockResolvedValue({
      success: true,
      data: { imported: { endpoints: 1 }, skippedFiles: ['extra.json'] },
    })
    openTab(/^Pull$/)
    const actions = screen.getAllByRole('button', { name: /^Pull$/ })
    fireEvent.click(actions[actions.length - 1])
    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('extra.json')),
    )
  })

  it('Open from Git names them', async () => {
    save.gitListFiles.mockResolvedValue({
      success: true,
      data: {
        tmpDir: '/tmp/x',
        files: [],
        skipped: [{ file: 'extra.json', reason: '"extra.json" is a link' }],
      },
    })
    openTab(/^Open from Git$/)
    fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo.git'), {
      target: { value: 'https://x.test/r.git' },
    })
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'u' } })
    fireEvent.change(screen.getByPlaceholderText('ghp_xxxx...'), { target: { value: 't' } })
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }))
    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('extra.json')),
    )
    expect(toastWarning).toHaveBeenCalledTimes(1)
  })
})

describe('skippedFilesMessage', () => {
  it('singular', () => {
    expect(skippedFilesMessage(t, ['a.json'])).toBe(
      '1 file in the repository was not read because it is a link, a special file or too large: a.json',
    )
  })

  it('a long list stays readable: five names and the count', () => {
    const names = Array.from({ length: 8 }, (_, i) => `f${i}.json`)
    const text = skippedFilesMessage(t, names)
    expect(text).toContain('8 files')
    expect(text).toContain('f4.json')
    expect(text).not.toContain('f5.json')
  })

  it('Turkish', () => {
    setLocale('tr')
    expect(skippedFilesMessage(t, ['a.json'])).toBe(
      'Depodaki 1 dosya okunmadı; bağlantı, özel dosya ya da çok büyük: a.json',
    )
  })
})
