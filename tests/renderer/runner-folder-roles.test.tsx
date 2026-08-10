/**
 * A role set on a folder has to reach the RUN — issue #90.
 *
 * `runner-sequence-tree.test.tsx` proves the folder row reports the right
 * folder. This proves the other half, which is the half that can go wrong
 * silently: the sequence draws from `folderGroups` while the run is built from
 * the flat `endpoints` list, so a folder role that updated only the groups
 * would look applied and run as though it never was. That is the same wire the
 * `stopOnError` bug lived on, and the same reason these assertions are about
 * the payload rather than about the screen.
 *
 * It also pins the nesting: a folder role that stopped at direct children would
 * be worse than none, because the folder would read "Teardown" while the
 * requests in its subfolder still ran in the flow.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : typeof p === 'string' && p.startsWith('on')
            ? () => () => {}
            : () => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openFolderRunner } from '../../src/renderer/lib/open-runner-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { TreeNode, Tab } from '../../src/renderer/types'
import type { RunnerExecuteOptions } from '../../src/shared/runner-types'

;(globalThis as unknown as { React: typeof React }).React = React

let execute: ReturnType<typeof vi.fn>

/**
 * Suite
 *   ├─ Fixtures
 *   │    ├─ Seed user            (direct)
 *   │    └─ Nested
 *   │         └─ Seed account    (one level deeper — the trap)
 *   └─ Checks
 *        └─ Read profile
 */
function tree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'suite',
          type: 'folder',
          label: 'Suite',
          children: [
            {
              id: 'fixtures',
              type: 'folder',
              label: 'Fixtures',
              children: [
                { id: 'seed-user', type: 'endpoint', label: 'Seed user', method: 'POST', path: '/u' },
                {
                  id: 'nested',
                  type: 'folder',
                  label: 'Nested',
                  children: [
                    {
                      id: 'seed-account',
                      type: 'endpoint',
                      label: 'Seed account',
                      method: 'POST',
                      path: '/acct',
                    },
                  ],
                },
              ],
            },
            {
              id: 'checks',
              type: 'folder',
              label: 'Checks',
              children: [
                {
                  id: 'read-profile',
                  type: 'endpoint',
                  label: 'Read profile',
                  method: 'GET',
                  path: '/p',
                },
              ],
            },
          ],
        },
      ],
    },
  ]
}

function runnerTab(): Tab {
  return {
    id: 'runner-suite',
    name: 'Suite',
    protocol: 'runner',
    folderId: 'suite',
    isDirty: false,
    isLoading: false,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  execute = vi.fn().mockResolvedValue({ success: true, data: null })
  mockWindowApi({
    runner: {
      execute,
      stop: () => Promise.resolve({ success: true, data: true }),
      onProgress: () => () => {},
      history: () => Promise.resolve({ success: true, data: [] }),
    },
  })

  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    treeData: tree(),
    openNodeIds: new Set(['default-module']),
    searchQuery: '',
  })
  useUIStore.setState({ activeSidebarPage: 'tests' })
  useTabsStore.setState({ tabs: [runnerTab()], activeTabId: 'runner-suite' })
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

async function openRunner(): Promise<void> {
  render(<Workbench />)
  act(() => {
    openFolderRunner('suite', 'Suite')
  })
  await screen.findByTestId('runner-start')
}

async function start(): Promise<RunnerExecuteOptions> {
  fireEvent.click(screen.getByTestId('runner-start'))
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
  return execute.mock.calls[0][0] as RunnerExecuteOptions
}

describe('folder roles reach the run', () => {
  it('sends a whole folder as setup, subfolders included', async () => {
    await openRunner()

    fireEvent.change(screen.getByLabelText(/Phase — Fixtures/i), { target: { value: 'setup' } })
    const payload = await start()

    // Both the direct child AND the one a level deeper. The nested request is
    // the assertion that matters: a role that stopped at direct children would
    // leave it in the flow while the folder claimed otherwise.
    expect(payload.setupEndpointIds).toEqual(
      expect.arrayContaining(['seed-user', 'seed-account']),
    )
    // …and they must leave the flow, or they run twice.
    expect(payload.endpointIds).not.toContain('seed-user')
    expect(payload.endpointIds).not.toContain('seed-account')
    expect(payload.endpointIds).toContain('read-profile')
  })

  it('sends a whole folder as teardown', async () => {
    await openRunner()

    fireEvent.change(screen.getByLabelText(/Phase — Checks/i), { target: { value: 'teardown' } })
    // Fixtures stays in the flow, so the run still has something to run.
    const payload = await start()

    expect(payload.teardownEndpointIds).toEqual(['read-profile'])
    expect(payload.endpointIds).not.toContain('read-profile')
  })

  it('leaves the folders it was not applied to alone', async () => {
    await openRunner()

    fireEvent.change(screen.getByLabelText(/Phase — Fixtures/i), { target: { value: 'setup' } })
    const payload = await start()

    expect(payload.setupEndpointIds).not.toContain('read-profile')
    expect(payload.teardownEndpointIds).toBeUndefined()
  })

  it('lets a single request override the role its folder set', async () => {
    // Folder roles are the bulk tool; per-request roles stay for the exception.
    await openRunner()

    fireEvent.change(screen.getByLabelText(/Phase — Fixtures/i), { target: { value: 'setup' } })
    fireEvent.change(screen.getByLabelText(/Phase: Seed account/i), { target: { value: 'main' } })
    const payload = await start()

    expect(payload.setupEndpointIds).toEqual(['seed-user'])
    expect(payload.endpointIds).toContain('seed-account')
  })

  it('deselects a whole folder from its checkbox', async () => {
    await openRunner()

    fireEvent.click(screen.getByLabelText(/Select folder Fixtures/i))
    const payload = await start()

    // Deselected requests are not in the run at all — in any phase.
    expect(payload.endpointIds).toEqual(['read-profile'])
    expect(payload.setupEndpointIds).toBeUndefined()
  })
})
