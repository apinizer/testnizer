/**
 * The wire between the Runner UI and `runner:execute`.
 *
 * This is the test whose absence let a whole feature ship dead. Testers reported
 * that "Stop run if an error occurs" had no effect: with the box checked, a
 * failing step did not stop the run. The main-process loop was never at fault —
 * it honours the flag in three places and 23 main-process tests cover it, every
 * one of them passing `stopOnError` by hand. What no test looked at was whether
 * the UI ever SENT it. It did not, and main defaults it to `false` while the
 * checkbox defaults to `true`. `persistResponses` was missing the same way, so
 * turning body persistence off was silently ignored.
 *
 * So the assertions here are deliberately about the CALL ARGUMENT rather than
 * about run behaviour: they are the only thing that can catch a field that
 * exists everywhere except in the payload.
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
import { useRunnerStore } from '../../src/renderer/stores/runner.store'
import {
  buildExecutePayload,
  RUNNER_DEFAULTS,
  type RunSettings,
} from '../../src/renderer/lib/runner-payload'
import type { TreeNode, Tab } from '../../src/renderer/types'
import type { RunnerExecuteOptions } from '../../src/shared/runner-types'

;(globalThis as unknown as { React: typeof React }).React = React

/** Captures the payload the UI hands to `runner:execute`. */
let execute: ReturnType<typeof vi.fn>

function tree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'folder-a',
          type: 'folder',
          label: 'Folder A',
          children: [
            { id: 'ep-a1', type: 'endpoint', label: 'Alpha endpoint', method: 'GET', path: '/a' },
          ],
        },
      ],
    },
  ]
}

function runnerTab(): Tab {
  return {
    id: 'runner-folder-a',
    name: 'Folder A',
    protocol: 'runner',
    folderId: 'folder-a',
    isDirty: false,
    isLoading: false,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  execute = vi.fn().mockResolvedValue({ success: true, data: null })
  // The bridge is a Proxy whose `get` trap ignores the target, so assigning
  // `api.runner` afterwards is invisible — the namespace must be passed in as an
  // override.
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
  useTabsStore.setState({ tabs: [runnerTab()], activeTabId: 'runner-folder-a' })
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

/** Renders the runner tab and presses Start run. */
async function startRun(): Promise<RunnerExecuteOptions> {
  render(<Workbench />)
  act(() => {
    openFolderRunner('folder-a', 'Folder A')
  })
  fireEvent.click(await screen.findByTestId('runner-start'))
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
  return execute.mock.calls[0][0] as RunnerExecuteOptions
}

describe('buildExecutePayload', () => {
  it('carries every run setting through to the payload', () => {
    const settings: RunSettings = {
      delay: 250,
      iterationDelay: 750,
      iterations: 3,
      stopOnError: false,
      persistResponses: false,
      keepVariableValues: false,
    }
    const payload = buildExecutePayload({ projectId: 'p', endpointIds: ['a'] }, settings)
    expect(payload).toMatchObject(settings)
  })

  it('defaults stopOnError to on, matching the checkbox', () => {
    // The mismatch that produced the bug: the UI checkbox defaulted to true
    // while main's fallback was false, so an omitted field silently inverted it.
    expect(RUNNER_DEFAULTS.stopOnError).toBe(true)
    expect(RUNNER_DEFAULTS.persistResponses).toBe(true)
  })
})

describe('RunnerTab → runner:execute payload', () => {
  it('sends stopOnError and persistResponses (the reported bug)', async () => {
    const payload = await startRun()
    expect(payload).toMatchObject({
      stopOnError: true,
      persistResponses: true,
      keepVariableValues: true,
    })
  })

  it('sends the delay between iterations the user typed (issue #89)', async () => {
    render(<Workbench />)
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })

    const field = (await screen.findByTestId('runner-iteration-delay')) as HTMLInputElement
    fireEvent.change(field, { target: { value: '2500' } })
    fireEvent.blur(field)
    fireEvent.click(await screen.findByTestId('runner-start'))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    // Same class as the stopOnError bug this file exists for: the field can
    // look right on screen and still never reach the run.
    const payload = execute.mock.calls[0][0] as RunnerExecuteOptions
    expect(payload.iterationDelay).toBe(2500)
    // …and it must not have been mistaken for the per-request delay.
    expect(payload.delay).toBe(RUNNER_DEFAULTS.delay)
  })

  it('sends stopOnError:false when the user unchecks it', async () => {
    render(<Workbench />)
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })

    // The checkbox lives under "Advanced Settings", which is always rendered.
    const box = (await screen.findByLabelText(
      /Stop run if an error occurs/i,
    )) as HTMLInputElement
    expect(box.checked, 'precondition: the box starts checked').toBe(true)
    fireEvent.click(box)
    expect(box.checked, 'clicking the box unchecks it').toBe(false)

    fireEvent.click(screen.getByTestId('runner-start'))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect((execute.mock.calls[0][0] as RunnerExecuteOptions).stopOnError).toBe(false)
  })

  it('never sends NaN iterations after the box is cleared', async () => {
    // `Math.max(1, Number(''))` is 1 in RunnerConfig and plain `Number('')` is 0
    // in the legacy view — either way the box could not be emptied, and the
    // legacy path wrote NaN straight into the run payload. Same class the
    // testers reported on the Password Generator length field.
    render(<Workbench />)
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })

    const box = screen.getByTestId('runner-iterations') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '' } })
    expect(box.value, 'the box can actually be emptied').toBe('')
    fireEvent.change(box, { target: { value: '3' } })
    expect(box.value, 'the typed digit stands alone, not beside the old one').toBe('3')

    fireEvent.click(screen.getByTestId('runner-start'))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect((execute.mock.calls[0][0] as RunnerExecuteOptions).iterations).toBe(3)
  })

  it('falls back to the last good iterations when the box is left empty', async () => {
    render(<Workbench />)
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })

    const box = screen.getByTestId('runner-iterations') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    // Blurring an empty box restores the previous value rather than picking the
    // minimum for the user — and a run started now is still a valid run.
    expect(box.value).toBe('1')

    fireEvent.click(screen.getByTestId('runner-start'))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const sent = (execute.mock.calls[0][0] as RunnerExecuteOptions).iterations
    expect(Number.isNaN(sent as number)).toBe(false)
    expect(sent).toBe(1)
  })

  it('still sends the run identity fields it always did', async () => {
    const payload = await startRun()
    expect(payload.projectId).toBe('proj-1')
    expect(payload.endpointIds).toEqual(['ep-a1'])
    expect(payload.workspaceId).toBe('ws-1')
  })
})

describe('runner store → runner:execute payload', () => {
  it('sends the run settings from the store surface too', async () => {
    // The Command Palette used to open a modal backed by this store, and THIS
    // path dropped a different set of fields (setup/teardown, hooks, iteration
    // data). Both surfaces now build the payload the same way.
    useRunnerStore.setState({
      endpoints: [
        { id: 'ep-a1', name: 'Alpha', method: 'GET', url: '/a', selected: true },
        { id: 'ep-a2', name: 'Beta', method: 'GET', url: '/b', selected: false },
      ],
      stopOnError: false,
      persistResponses: false,
    })
    await useRunnerStore.getState().run('proj-1', 'ws-1', 'env-1')

    expect(execute).toHaveBeenCalledTimes(1)
    const payload = execute.mock.calls[0][0] as RunnerExecuteOptions
    expect(payload).toMatchObject({
      projectId: 'proj-1',
      endpointIds: ['ep-a1'],
      stopOnError: false,
      persistResponses: false,
      sourceLabel: 'Runner',
    })
  })
})
