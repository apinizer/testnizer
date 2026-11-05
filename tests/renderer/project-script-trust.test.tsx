/**
 * The renderer's gates: Send (HTTP, SOAP, GraphQL through the request store; MCP
 * through its own), interactive Run, Run now, mock Start and the settings row. Main
 * owns the answer (`tests/main/project-script-trust.test.ts`); here the bridge
 * gives it, and the assertions are what the renderer does with it.
 *
 * The prompt is a wait the user controls, so the tab-switch cases hold it open
 * while the user is on another tab (docs/e2e/test-rules.md rule 1).
 */
import * as React from 'react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const toasts = vi.hoisted(() => ({ warning: vi.fn() }))
// The mock store takes its bridge when the module loads.
const mockStart = vi.hoisted(() => {
  const start = vi.fn(async () => ({ success: true, data: { status: 'running', port: 1 } }))
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = { mock: { server: { start }, onLog: () => () => {}, onStatus: () => () => {} } }
  return start
})
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { warning: toasts.warning, info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import { t, setLocale } from '../../src/renderer/lib/i18n'
import { ensureScriptsAllowed, sendScriptsRefusal } from '../../src/renderer/lib/script-trust-gate'
import ProjectScriptTrustRow from '../../src/renderer/components/modals/ProjectScriptTrustRow'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import {
  liveRunKey,
  startLiveRun,
  useRunnerLiveStore,
} from '../../src/renderer/stores/runner-live.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Tab } from '../../src/renderer/types'

const A = 'tab-a'
const B = 'tab-b'
/** Sets a marker the test reads. Harmless, and proves the body ran. */
const SCRIPT = "globalThis.__scriptTrustCanary = 'ran'"
const scriptRan = (): boolean =>
  (globalThis as { __scriptTrustCanary?: string }).__scriptTrustCanary === 'ran'
const allowed = { success: true, data: { allowed: true, blocked: false, scriptCount: 1 } }
const notNow = { success: true, data: { allowed: false, blocked: true, scriptCount: 1 } }

const ensure = vi.fn()
const send = vi.fn()
const execute = vi.fn()

function tab(id: string, protocol: Tab['protocol'] = 'http'): Tab {
  return { id, name: id, protocol, isDirty: false, isLoading: false } as Tab
}
/** A prompt the test answers when it chooses to. */
function heldPrompt(): (answer: unknown) => void {
  let release: (v: unknown) => void = () => {}
  ensure.mockImplementation(() => new Promise((r) => (release = r)))
  return (answer) => release(answer)
}
const promptOpen = (): Promise<void> => vi.waitFor(() => expect(ensure).toHaveBeenCalled())
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

function installApi(extra: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    projectTrust: { ensure, status: vi.fn(), block: vi.fn() },
    request: {
      send,
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ({ success: true, data: {} })) },
    runner: {
      execute,
      stop: vi.fn(),
      onProgress: () => () => {},
      onPhase: () => () => {},
    },
    ...extra,
  }
}

beforeEach(() => {
  ensure.mockReset()
  send.mockReset()
  delete (globalThis as { __scriptTrustCanary?: string }).__scriptTrustCanary
  execute.mockReset()
  toasts.warning.mockReset()
  send.mockImplementation(async () => ({
    success: true,
    data: {
      requestId: 'r',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
    },
  }))
  execute.mockImplementation(async () => ({ success: true, data: null }))
  installApi()
  useRunnerLiveStore.setState({ runs: {} })
  useWorkspaceStore.setState({ activeWorkspaceId: 'w', activeProjectId: 'p1' })
  useResponseStore.setState({
    response: null,
    isLoading: false,
    byTab: {},
    activeTabId: A,
  } as never)
  useTabsStore.setState({ tabs: [tab(A), tab(B)], activeTabId: A })
  useRequestStore.setState({
    ...useRequestStore.getState(),
    _currentTabId: A,
    method: 'GET',
    url: 'https://a.example.test/',
    params: [],
    headers: [],
    preScript: SCRIPT,
    postScript: '',
  })
})
afterEach(() => {
  cleanup()
  setLocale('en')
})

const responseOf = (tabId: string) => useResponseStore.getState().byTab[tabId]?.response

describe('ensureScriptsAllowed', () => {
  it('no project (Quick Test) is the user typing: allowed, no question', async () => {
    expect(await ensureScriptsAllowed(null)).toBe(true)
    expect(await ensureScriptsAllowed(undefined)).toBe(true)
    expect(ensure).not.toHaveBeenCalled()
  })

  it.each([
    ['allowed: false', notNow],
    ['a failed call', { success: false, error: 'x' }],
    ['no data', { success: true, data: null }],
    ['a truthy but not true answer', { success: true, data: { allowed: 'yes' } }],
  ])('fails closed on %s', async (_label, answer) => {
    ensure.mockResolvedValue(answer)
    expect(await ensureScriptsAllowed('p1')).toBe(false)
  })

  it('fails closed when the bridge throws or is missing', async () => {
    ensure.mockRejectedValue(new Error('gone'))
    expect(await ensureScriptsAllowed('p1')).toBe(false)
    installApi({ projectTrust: undefined })
    expect(await ensureScriptsAllowed('p1')).toBe(false)
  })

  it('a send with only blank scripts does not ask', async () => {
    expect(await sendScriptsRefusal('p1', ['', '  \n', null, undefined])).toBeNull()
    expect(ensure).not.toHaveBeenCalled()
  })
})

describe('Send through the request store', () => {
  it.each(['http', 'soap', 'graphql'] as const)(
    '%s, Not now: nothing is sent, the script does not run, the tab says why',
    async (protocol) => {
      useTabsStore.setState({ tabs: [tab(A, protocol), tab(B)], activeTabId: A })
      ensure.mockResolvedValue(notNow)
      await useRequestStore.getState().sendRequest()
      expect(ensure).toHaveBeenCalledWith('p1', { hasScript: true })
      expect(send).not.toHaveBeenCalled()
      expect(scriptRan()).toBe(false)
      expect(responseOf(A)?.error).toBe(t('scriptTrust.sendRefused'))
      expect(useResponseStore.getState().isLoading).toBe(false)
    },
  )

  it('Allow: the script runs and the request goes', async () => {
    ensure.mockResolvedValue(allowed)
    await useRequestStore.getState().sendRequest()
    expect(scriptRan()).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('no script: nothing is asked', async () => {
    useRequestStore.setState({ preScript: '  ', postScript: '' })
    await useRequestStore.getState().sendRequest()
    expect(ensure).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a post-response script alone asks too: its request would go, then it would run', async () => {
    useRequestStore.setState({ preScript: '', postScript: SCRIPT })
    ensure.mockResolvedValue(notNow)
    await useRequestStore.getState().sendRequest()
    expect(send).not.toHaveBeenCalled()
  })

  it('a script from the project settings asks', async () => {
    useRequestStore.setState({ preScript: '', postScript: '' })
    installApi({
      settings: { get: vi.fn(async () => ({ success: true, data: { preScript: SCRIPT } })) },
    })
    ensure.mockResolvedValue(notNow)
    await useRequestStore.getState().sendRequest()
    expect(ensure).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('no active project: the typed script runs and nothing is asked', async () => {
    useWorkspaceStore.setState({ activeProjectId: null })
    await useRequestStore.getState().sendRequest()
    expect(ensure).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('Not now after moving to another tab lands on the tab that asked', async () => {
    const answer = heldPrompt()
    const sending = useRequestStore.getState().sendRequest()
    await promptOpen()

    switchActiveTab(B)
    useRequestStore.setState({ url: 'https://b.example.test/', preScript: '' })
    answer(notNow)
    await sending

    expect(send).not.toHaveBeenCalled()
    expect(responseOf(A)?.error).toBe(t('scriptTrust.sendRefused'))
    expect(responseOf(B)).toBeFalsy()
    expect(useResponseStore.getState().response).toBeFalsy() // B, on screen, untouched
  })

  it('Allow after moving to another tab sends what the tab that asked holds', async () => {
    const answer = heldPrompt()
    const sending = useRequestStore.getState().sendRequest()
    await promptOpen()

    switchActiveTab(B)
    useRequestStore.setState({ url: 'https://b.example.test/', preScript: '' })
    answer(allowed)
    await sending

    expect(send).toHaveBeenCalledTimes(1)
    expect(String((send.mock.calls[0][0] as { url: string }).url)).toContain('a.example.test')
    expect(responseOf(B)).toBeFalsy()
    expect(responseOf(A)?.status).toBe(200)
  })
})

describe('Send through the MCP store', () => {
  const callTool = vi.fn()
  const readResource = vi.fn()
  const getPrompt = vi.fn()

  beforeEach(() => {
    callTool.mockReset()
    readResource.mockReset()
    getPrompt.mockReset()
    callTool.mockResolvedValue({ success: true, data: { content: [] } })
    readResource.mockResolvedValue({ success: true, data: { contents: [] } })
    getPrompt.mockResolvedValue({ success: true, data: { messages: [] } })
    installApi({ mcp: { callTool, readResource, getPrompt, onNotification: () => () => {} } })
    useTabsStore.setState({ tabs: [tab(A, 'mcp'), tab(B, 'mcp')], activeTabId: A })
    useMcpStore.setState({
      _currentTabId: A,
      url: 'http://a.example/mcp',
      transport: 'http',
      connectionId: 'conn-a',
      connectionState: 'connected',
      tools: [{ name: 'ping' }],
      selectedTool: 'ping',
      toolArgs: '{}',
      toolCallId: null,
      isInvoking: false,
      resultError: null,
      resources: [{ uri: 'x://a', name: 'a' }],
      selectedResource: 'x://a',
      resourceUriDraft: 'x://a',
      prompts: [{ name: 'p' }],
      selectedPrompt: 'p',
    } as never)
    useRequestStore.setState({ preScript: SCRIPT, postScript: '' })
  })

  it('a tool call, Not now: not called, the tab says why, the button comes back', async () => {
    ensure.mockResolvedValue(notNow)
    await useMcpStore.getState().callTool()
    expect(callTool).not.toHaveBeenCalled()
    expect(scriptRan()).toBe(false)
    const s = useMcpStore.getState()
    expect(s.resultError).toBe(t('scriptTrust.sendRefused'))
    expect(s.isInvoking).toBe(false)
    expect(s.toolCallId).toBeNull()
  })

  it('a tool call, Allow: the script runs and the call goes', async () => {
    ensure.mockResolvedValue(allowed)
    await useMcpStore.getState().callTool()
    expect(scriptRan()).toBe(true)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('a tool call with no script does not ask', async () => {
    useRequestStore.setState({ preScript: '', postScript: '' })
    await useMcpStore.getState().callTool()
    expect(ensure).not.toHaveBeenCalled()
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('a resource read and a prompt, Not now: neither goes out', async () => {
    ensure.mockResolvedValue(notNow)
    await useMcpStore.getState().readResource()
    await useMcpStore.getState().getPrompt()
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(readResource).not.toHaveBeenCalled()
    expect(getPrompt).not.toHaveBeenCalled()
  })

  it('Not now after moving to another tab lands on the tab that asked', async () => {
    const answer = heldPrompt()
    const calling = useMcpStore.getState().callTool()
    await promptOpen()

    switchActiveTab(B)
    useMcpStore.setState({ url: 'http://b.example/mcp', resultError: null } as never)
    answer(notNow)
    await calling

    expect(callTool).not.toHaveBeenCalled()
    expect(useMcpStore.getState().resultError).toBeNull()
    switchActiveTab(A)
    expect(useMcpStore.getState().resultError).toBe(t('scriptTrust.sendRefused'))
  })
})

describe('interactive Run', () => {
  const start = (tabId = A, payload: Record<string, unknown> = {}, onStart?: () => void) =>
    startLiveRun({
      tabId,
      totalCount: 1,
      sourceLabel: tabId,
      origin: 'folder' as never,
      payload: { projectId: 'p1', endpointIds: ['e'], runTabId: tabId, ...payload } as never,
      onStart,
    })

  it('Not now: the run does not start and a toast says so', async () => {
    ensure.mockResolvedValue(notNow)
    const onStart = vi.fn()
    await start(A, {}, onStart)
    expect(execute).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(useRunnerLiveStore.getState().runs[liveRunKey(A)]).toBeUndefined()
    expect(toasts.warning).toHaveBeenCalledWith(t('scriptTrust.runRefused'))
  })

  it('Allow: it starts', async () => {
    ensure.mockResolvedValue(allowed)
    const onStart = vi.fn()
    await start(A, {}, onStart)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('a hook typed but not saved counts as a script', async () => {
    ensure.mockResolvedValue(notNow)
    await start(A, { runPreScript: SCRIPT })
    expect(ensure).toHaveBeenCalledWith('p1', { hasScript: true })
    ensure.mockClear()
    await start(A, { runPreScript: '   ' })
    expect(ensure).toHaveBeenCalledWith('p1', undefined)
  })

  it('leaving the tab while the prompt is open: the run still starts on the tab that asked', async () => {
    const answer = heldPrompt()
    const starting = start(A)
    await promptOpen()
    switchActiveTab(B)
    answer(allowed)
    await starting
    expect(execute).toHaveBeenCalledTimes(1)
    expect(useRunnerLiveStore.getState().runs[liveRunKey(B)]).toBeUndefined()
    expect(useRunnerLiveStore.getState().runs[liveRunKey(A)]).toBeDefined()
  })

  it('a second press while the prompt is open starts one run', async () => {
    let release: (v: unknown) => void = () => {}
    ensure.mockImplementation(() => new Promise((r) => (release = r)))
    execute.mockImplementation(() => new Promise(() => {})) // the run stays open
    const first = start(A)
    await promptOpen()
    const firstRelease = release
    const second = start(A)
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(2))
    release(allowed)
    firstRelease(allowed)
    await settle()
    expect(execute).toHaveBeenCalledTimes(1)
    void first
    void second
  })
})

describe('Run now on a scheduled task', () => {
  const task = {
    id: 't1',
    name: 'Nightly',
    running: false,
    project_id: 'p1',
    endpoint_ids: '["e1"]',
    folder_id: null,
    environment_id: null,
    interval_value: 1,
    interval_unit: 'hours',
    delay_ms: 0,
    enabled: 1,
    last_run_at: null,
    next_run_at: 1,
    created_at: 1,
    schedule_type: 'interval',
    schedule_time: null,
    schedule_days: null,
    schedule_cron: null,
    suite_id: null,
  }
  const runNow = vi.fn(async () => ({ success: true, data: { started: true } }))

  async function mountAndClick(row: Record<string, unknown>): Promise<void> {
    runNow.mockClear()
    installApi({
      scheduler: {
        list: vi.fn(async () => ({ success: true, data: [row] })),
        runNow,
        history: async () => ({ success: true, data: [] }),
        taskEndpoints: async () => ({ success: true, data: { items: [], source: 'empty' } }),
        onRunCompleted: () => () => {},
      },
      testSuite: { list: async () => ({ success: true, data: [] }) },
    })
    render(<ScheduledTasksView onBack={() => {}} />)
    fireEvent.click(await screen.findByTestId('scheduled-task-run-now'))
  }

  it('Not now: main is not told to run, and a toast says so', async () => {
    ensure.mockResolvedValue(notNow)
    await mountAndClick(task)
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled())
    expect(runNow).not.toHaveBeenCalled()
  })

  it('a second click while the prompt is open does not start a second run', async () => {
    const answer = heldPrompt()
    await mountAndClick(task)
    await promptOpen()
    fireEvent.click(screen.getByTestId('scheduled-task-run-now'))
    answer(allowed)
    await waitFor(() => expect(runNow).toHaveBeenCalled())
    await settle()
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(runNow).toHaveBeenCalledTimes(1)
  })

  it('after Not now the button works again', async () => {
    ensure.mockResolvedValue(notNow)
    await mountAndClick(task)
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('scheduled-task-run-now').hasAttribute('disabled')).toBe(false),
    )
    ensure.mockResolvedValue(allowed)
    fireEvent.click(screen.getByTestId('scheduled-task-run-now'))
    await waitFor(() => expect(runNow).toHaveBeenCalledWith('t1'))
  })

  it('Allow: it runs; a hook on the task counts as a script', async () => {
    ensure.mockResolvedValue(allowed)
    await mountAndClick({ ...task, run_pre_script: SCRIPT })
    await waitFor(() => expect(runNow).toHaveBeenCalledWith('t1'))
    expect(ensure).toHaveBeenCalledWith('p1', { hasScript: true })
  })
})

describe('mock Start', () => {
  beforeEach(() => {
    mockStart.mockClear()
    useMockStore.setState({
      servers: [{ id: 's1', projectId: 'p1' }],
      projectId: 'p1',
    } as never)
  })

  it('asks once, and starts whatever the answer', async () => {
    ensure.mockResolvedValue(notNow)
    await useMockStore.getState().startServer('s1')
    expect(ensure).toHaveBeenCalledWith('p1', undefined)
    expect(mockStart).toHaveBeenCalledWith('s1')
  })
})

describe('the Project Settings row', () => {
  const status = vi.fn()
  const block = vi.fn()

  beforeEach(() => {
    status.mockReset()
    block.mockReset()
    installApi({ projectTrust: { ensure, status, block } })
  })

  it('blocked: says so with the count, Allow goes to main, the row follows its answer', async () => {
    status.mockResolvedValueOnce({ success: true, data: { blocked: true, scriptCount: 3 } })
    render(<ProjectScriptTrustRow projectId="p1" />)
    const row = await screen.findByTestId('project-script-trust')
    await waitFor(() => expect(row.getAttribute('data-blocked')).toBe('true'))
    expect(screen.getByTestId('project-script-trust-state').textContent).toContain('3')

    ensure.mockResolvedValue(allowed)
    status.mockResolvedValueOnce({ success: true, data: { blocked: false, scriptCount: 3 } })
    fireEvent.click(screen.getByTestId('project-script-trust-allow'))
    await waitFor(() => expect(ensure).toHaveBeenCalledWith('p1', { hasScript: true }))
    await waitFor(() => expect(row.getAttribute('data-blocked')).toBe('false'))
  })

  it('Not now in the prompt keeps it blocked', async () => {
    status.mockResolvedValue({ success: true, data: { blocked: true, scriptCount: 1 } })
    render(<ProjectScriptTrustRow projectId="p1" />)
    const row = await screen.findByTestId('project-script-trust')
    await waitFor(() => expect(row.getAttribute('data-blocked')).toBe('true'))
    ensure.mockResolvedValue(notNow)
    fireEvent.click(screen.getByTestId('project-script-trust-allow'))
    await waitFor(() => expect(ensure).toHaveBeenCalled())
    await settle()
    expect(row.getAttribute('data-blocked')).toBe('true')
  })

  it('allowed: Block goes to main', async () => {
    status.mockResolvedValueOnce({ success: true, data: { blocked: false, scriptCount: 1 } })
    render(<ProjectScriptTrustRow projectId="p1" />)
    const row = await screen.findByTestId('project-script-trust')
    await waitFor(() => expect(row.getAttribute('data-blocked')).toBe('false'))
    block.mockResolvedValue({ success: true, data: true })
    status.mockResolvedValueOnce({ success: true, data: { blocked: true, scriptCount: 1 } })
    fireEvent.click(screen.getByTestId('project-script-trust-block'))
    await waitFor(() => expect(block).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(row.getAttribute('data-blocked')).toBe('true'))
  })

  it('has its text in Turkish too', async () => {
    setLocale('tr')
    status.mockResolvedValue({ success: true, data: { blocked: true, scriptCount: 2 } })
    render(<ProjectScriptTrustRow projectId="p1" />)
    await waitFor(() =>
      expect(screen.getByTestId('project-script-trust-state').textContent).toBe(
        t('general.scriptTrustBlocked').replace('{count}', '2'),
      ),
    )
    setLocale('en')
    const en = t('general.scriptTrustBlocked')
    setLocale('tr')
    expect(t('general.scriptTrustBlocked')).not.toBe(en)
  })
})

/**
 * The guard against a new way in: where project scripts can evaluate, and where a
 * run can start. A new site fails here until it goes through a gate.
 */
describe('no evaluator or run start outside the gates', () => {
  const SRC = join(__dirname, '../../src')
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })
  }
  /** Comments name these APIs too; only code counts. */
  const codeOnly = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n')
  const ALL = sources(SRC).map((path) => ({
    path: relative(SRC, path).replaceAll('\\', '/'),
    text: codeOnly(readFileSync(path, 'utf-8')),
  }))
  const filesMatching = (re: RegExp): string[] =>
    ALL.filter((f) => re.test(f.text))
      .map((f) => f.path)
      .sort()

  it('code evaluators live only at the gated sites', () => {
    expect(
      filesMatching(
        /new AsyncFunction|new Function\(|\beval\(|vm\.runIn|vm\.Script|compileFunction/,
      ),
    ).toEqual(['main/ipc/runner.handler.ts', 'main/mock/script.ts', 'renderer/lib/test-runner.ts'])
  })

  it('the renderer evaluator is called only from gated files', () => {
    expect(
      ALL.filter(
        (f) =>
          f.path.startsWith('renderer/') &&
          f.path !== 'renderer/lib/test-runner.ts' &&
          /[^.\w]runScript\(/.test(f.text),
      )
        .map((f) => f.path)
        .sort(),
    ).toEqual(['renderer/lib/mcp-send-scripts.ts', 'renderer/stores/request.store.ts'])
    const mcpStore = ALL.find((f) => f.path === 'renderer/stores/mcp.store.ts')!.text
    expect(mcpStore.match(/beginMcpScripts\(/g)?.length).toBe(
      mcpStore.match(/await preScriptsAllow\(/g)?.length,
    )
  })

  it('a run starts from the renderer only behind the gate', () => {
    expect(filesMatching(/runner\?*\.execute\(/).filter((p) => p.startsWith('renderer/'))).toEqual([
      'renderer/stores/runner-live.store.ts',
      'renderer/stores/runner.store.ts',
    ])
    for (const path of [
      'renderer/stores/runner-live.store.ts',
      'renderer/stores/runner.store.ts',
      'renderer/components/runner/ScheduledTasksView.tsx',
    ]) {
      expect(ALL.find((f) => f.path === path)!.text, path).toContain('runScriptsAllowed(')
    }
  })
})
