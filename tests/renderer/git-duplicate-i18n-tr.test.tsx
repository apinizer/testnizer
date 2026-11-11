/**
 * Tester finding 6 — with the UI in Turkish, the git surfaces stayed in
 * English: the header's Pull / Push buttons and the "Pulling from remote…"
 * overlay they raise, the branch menu's Pull / Push / Merge / New Branch, and
 * the project Duplicate toast. They were string literals, not `t()` calls.
 *
 * Each case renders the surface in TR, asserts the Turkish text and that the
 * English one is gone, then renders it in EN and asserts the English text is
 * byte-identical (e2e specs select by it).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : (..._a: unknown[]) => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

import { mockWindowApi } from './screens/_mount'
import HeaderProjectActions from '../../src/renderer/components/layout/HeaderProjectActions'
import BranchDropdown from '../../src/renderer/components/sidebar/BranchDropdown'
import ProjectHome from '../../src/renderer/components/layout/ProjectHome'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import type { Project } from '../../src/renderer/types'

const PROJECT = {
  id: 'p1',
  workspace_id: 'ws-1',
  name: 'banking',
  display_name: 'Banking',
  type: 'http',
  save_mode: 'git',
  created_at: Date.now(),
  updated_at: Date.now(),
} as unknown as Project

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

/** Resolves when the test lets the pending git IPC finish. */
let releasePull: () => void = () => {}

beforeEach(() => {
  for (const fn of Object.values(toastMock)) fn.mockReset()
  useUIStore.setState({ gitLoading: null })
  mockWindowApi({
    git: {
      changes: vi.fn(async () => ({ success: false })),
      pull: vi.fn(
        () =>
          new Promise((res) => {
            releasePull = () => res({ success: true, data: { state: 'clean', branch: 'main' } })
          }),
      ),
    },
    project: {
      duplicate: vi.fn(async () => ({ success: true, data: { projectId: 'p2' } })),
    },
  })
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'p1',
    projects: [PROJECT],
    fetchProjects: vi.fn(async () => {}),
    syncAfterGit: vi.fn(async () => {}),
  } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>)
  useBranchStore.setState({
    hasGit: true,
    hasToken: true,
    currentBranch: 'main',
    branches: [
      { name: 'main', current: true, isRemote: false },
      { name: 'feature', current: false, isRemote: false },
    ],
    changes: null,
    ensureDefault: vi.fn(async () => {}),
    fetchBranches: vi.fn(async () => {}),
    fetchChanges: vi.fn(async () => {}),
  } as unknown as Partial<ReturnType<typeof useBranchStore.getState>>)
})

afterEach(() => {
  releasePull()
  cleanup()
  useLocale('en')
})

describe('finding 6 — header Pull / Push follow the UI language', () => {
  it('renders the buttons and the pull overlay text in Turkish', async () => {
    useLocale('tr')
    render(<HeaderProjectActions />)
    expect(screen.getByTestId('header-pull').textContent).toBe('Çek')
    expect(screen.getByTestId('header-push').textContent).toBe('Gönder')
    expect(screen.getByTestId('header-pull').getAttribute('title')).toBe('Uzak depodan çek (pull)')
    expect(screen.getByTestId('header-push').getAttribute('title')).toBe(
      'Uzak depoya gönder (push)',
    )

    fireEvent.click(screen.getByTestId('header-pull'))
    await waitFor(() => expect(useUIStore.getState().gitLoading).toBe('Uzak depodan çekiliyor…'))
    releasePull()
    await waitFor(() =>
      expect(screen.getByTestId('header-status').textContent).toBe('Çekim başarılı (main)'),
    )
  })

  it('keeps the English text byte-identical', async () => {
    useLocale('en')
    render(<HeaderProjectActions />)
    expect(screen.getByTestId('header-pull').textContent).toBe('Pull')
    expect(screen.getByTestId('header-push').textContent).toBe('Push')
    expect(screen.getByTestId('header-pull').getAttribute('title')).toBe('Git Pull')
    fireEvent.click(screen.getByTestId('header-pull'))
    await waitFor(() => expect(useUIStore.getState().gitLoading).toBe('Pulling from remote...'))
  })
})

describe('finding 6 — branch menu follows the UI language', () => {
  it('renders Pull / Push / Merge / New Branch and the merge picker in Turkish', () => {
    useLocale('tr')
    render(<BranchDropdown pill />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    expect(screen.getByTestId('branch-pull').textContent).toBe('Çek')
    expect(screen.getByTestId('branch-push').textContent).toBe('Gönder')
    expect(screen.getByTestId('branch-merge').textContent).toBe('Birleştir')
    expect(screen.getByTestId('branch-new').textContent).toBe('Yeni Dal')
    expect(screen.queryByText('Merge')).toBeNull()
    expect(screen.queryByText('New Branch')).toBeNull()

    fireEvent.click(screen.getByTestId('branch-merge'))
    expect(screen.getByText(/birleştirilecek dal/)).toBeTruthy()
    expect(screen.queryByText(/Merge into/)).toBeNull()

    fireEvent.click(screen.getByTestId('branch-new'))
    expect(screen.getByPlaceholderText('main dalından yeni dal')).toBeTruthy()
  })

  it('keeps the English labels byte-identical', () => {
    useLocale('en')
    render(<BranchDropdown pill />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    expect(screen.getByTestId('branch-pull').textContent).toBe('Pull')
    expect(screen.getByTestId('branch-push').textContent).toBe('Push')
    expect(screen.getByTestId('branch-merge').textContent).toBe('Merge')
    expect(screen.getByTestId('branch-new').textContent).toBe('New Branch')
    fireEvent.click(screen.getByTestId('branch-new'))
    expect(screen.getByPlaceholderText('New branch from main')).toBeTruthy()
  })
})

describe('finding 6 — project Duplicate toast follows the UI language', () => {
  async function duplicate(): Promise<void> {
    useWorkspaceStore.setState({ activeProjectId: null })
    render(<ProjectHome />)
    const card = screen.getByText('Banking').closest('[data-testid="project-card"]') as HTMLElement
    const trigger = within(card)
      .getAllByRole('button')
      .find((b) => (b.textContent ?? '').trim() === '') as HTMLElement
    fireEvent.click(trigger)
    const dup = within(card)
      .getAllByRole('button')
      .find((b) => ['Duplicate', 'Çoğalt'].includes((b.textContent ?? '').trim())) as HTMLElement
    fireEvent.click(dup)
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
  }

  it('says "çoğaltıldı" in Turkish', async () => {
    useLocale('tr')
    await duplicate()
    const msg = String(toastMock.success.mock.calls[0][0])
    expect(msg).toBe('"Banking" çoğaltıldı')
    expect(msg).not.toMatch(/Duplicated/i)
  })

  it('keeps the English toast byte-identical', async () => {
    useLocale('en')
    await duplicate()
    expect(toastMock.success).toHaveBeenCalledWith('Duplicated "Banking"')
  })
})

/*
 * Main used to return hard-coded Turkish ("Git yapılandırması bulunamadı.",
 * "Aktif branch silinemez…"), so an English UI showed Turkish and a Turkish
 * UI could not word anything else. Main now sends English + `errorCode`
 * (src/shared/git-errors.ts); these envelopes are exactly what it returns.
 */
const CONFIG_MISSING = {
  success: false,
  error: 'Git configuration not found.',
  errorCode: 'GIT_CONFIG_MISSING',
}
const ACTIVE_BRANCH = {
  success: false,
  error: 'The active branch cannot be deleted. Switch to another branch first.',
  errorCode: 'GIT_ACTIVE_BRANCH_DELETE',
}

describe('finding 6 — git failures main reports by code follow the UI language', () => {
  function failPull(): void {
    mockWindowApi({
      git: {
        changes: vi.fn(async () => ({ success: false })),
        pull: vi.fn(async () => CONFIG_MISSING),
      },
    })
  }

  it('header Pull without a git config says it in Turkish', async () => {
    useLocale('tr')
    failPull()
    render(<HeaderProjectActions />)
    fireEvent.click(screen.getByTestId('header-pull'))
    await waitFor(() =>
      expect(screen.getByTestId('header-status').textContent).toBe(
        'Git yapılandırması bulunamadı.',
      ),
    )
  })

  it('…and in English for an English UI', async () => {
    useLocale('en')
    failPull()
    render(<HeaderProjectActions />)
    fireEvent.click(screen.getByTestId('header-pull'))
    await waitFor(() =>
      expect(screen.getByTestId('header-status').textContent).toBe('Git configuration not found.'),
    )
  })

  async function deleteFeature(): Promise<void> {
    mockWindowApi({
      git: {
        changes: vi.fn(async () => ({ success: false })),
        deleteBranch: vi.fn(async () => ACTIVE_BRANCH),
      },
    })
    render(<BranchDropdown pill />)
    fireEvent.click(screen.getByTestId('branch-pill'))
    const row = screen
      .getAllByTestId('branch-item')
      .find((r) => (r.textContent ?? '').includes('feature')) as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    const input = screen.queryByTestId('delete-confirm-input')
    if (input) fireEvent.change(input, { target: { value: 'delete' } })
    fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1))
  }

  it('deleting the active branch (switched elsewhere meanwhile) is refused in Turkish', async () => {
    useLocale('tr')
    await deleteFeature()
    expect(toastMock.error).toHaveBeenCalledWith('Etkin dal silinemez. Önce başka bir dala geçin.')
  })

  it('…and in English for an English UI', async () => {
    useLocale('en')
    await deleteFeature()
    expect(toastMock.error).toHaveBeenCalledWith(ACTIVE_BRANCH.error)
  })
})

/*
 * The git-config.ts family (auth, non-fast-forward, transient 5xx, …) used to
 * be hard-coded Turkish too. These envelopes are what `describeGitFailure`
 * returns: English text + code + git's own line as `errorDetail`.
 */
const AUTH_FAILED = {
  success: false,
  error:
    "Git authentication failed (401/403). Check the username and the Personal Access Token. (fatal: Authentication failed for 'https://github.com/a/b.git/')",
  errorCode: 'GIT_AUTH_FAILED',
  errorDetail: "fatal: Authentication failed for 'https://github.com/a/b.git/'",
}
const PUSH_TRANSIENT = {
  success: false,
  error:
    'The remote server returned a temporary error (HTTP 5xx) and the push failed after several attempts. Your changes are not lost; only sending them to the remote failed. Try Push again shortly — no new (duplicate) commit is created. (remote: Internal Server Error)',
  errorCode: 'GIT_PUSH_TRANSIENT',
  errorDetail: 'remote: Internal Server Error',
}

describe('finding 6 — git-config failures (auth, transient 5xx) follow the UI language', () => {
  async function pullFails(): Promise<string> {
    mockWindowApi({
      git: {
        changes: vi.fn(async () => ({ success: false })),
        pull: vi.fn(async () => AUTH_FAILED),
      },
    })
    render(<HeaderProjectActions />)
    fireEvent.click(screen.getByTestId('header-pull'))
    await waitFor(() => expect(screen.getByTestId('header-status').textContent).not.toBe(''))
    return screen.getByTestId('header-status').textContent ?? ''
  }

  async function pushFails(): Promise<string> {
    mockWindowApi({
      git: {
        changes: vi.fn(async () => ({ success: false })),
        push: vi.fn(async () => PUSH_TRANSIENT),
      },
    })
    render(<HeaderProjectActions />)
    fireEvent.click(screen.getByTestId('header-push'))
    fireEvent.click(await screen.findByTestId('push-commit-confirm'))
    await waitFor(() => expect(screen.getByTestId('header-status').textContent).not.toBe(''))
    return screen.getByTestId('header-status').textContent ?? ''
  }

  it('GIT_AUTH_FAILED reads in Turkish, git’s own line kept as-is', async () => {
    useLocale('tr')
    expect(await pullFails()).toBe(
      "Git kimlik doğrulaması başarısız (401/403). Kullanıcı adını ve Personal Access Token’ı kontrol edin. (fatal: Authentication failed for 'https://github.com/a/b.git/')",
    )
  })

  it('GIT_AUTH_FAILED stays the English sentence main sent for an English UI', async () => {
    useLocale('en')
    expect(await pullFails()).toBe(AUTH_FAILED.error)
  })

  it('GIT_PUSH_TRANSIENT says "nothing lost, no duplicate commit" in Turkish', async () => {
    useLocale('tr')
    const text = await pushFails()
    expect(text).toContain('Değişiklikleriniz kaybolmadı')
    expect(text).toContain('yeni (çift) bir commit oluşturulmaz')
    expect(text.endsWith('(remote: Internal Server Error)')).toBe(true)
  })

  it('GIT_PUSH_TRANSIENT stays the English sentence main sent for an English UI', async () => {
    useLocale('en')
    expect(await pushFails()).toBe(PUSH_TRANSIENT.error)
  })
})
