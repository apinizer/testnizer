/**
 * Issue #160 (renderer half) — Scripts + Tests around an MCP call on Send:
 *  - the pre-request script runs BEFORE `{{var}}` resolves in the arguments
 *    (`pm.variables.set` resolves for this call only, `pm.environment.set`
 *    persists — HTTP's rules), a throw aborts the call, skipRequest skips it;
 *  - the reply goes through the shared adapter (`src/shared/mcp-response.ts`):
 *    assertion rows + the post-response script see `pm.response` and `pm.mcp`;
 *  - no checks for a cancelled / failed call or an `input_required` round —
 *    they run on the FINAL round (via respondInput);
 *  - results land on the tab that started the call (issue #76 class) and show
 *    in a Test Results view with HTTP's counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Tab, TestAssertion } from '../../src/renderer/types'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useConsoleStore } from '../../src/renderer/stores/console.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { resolveAssertionVars } from '../../src/renderer/lib/test-runner'
import { setLocale } from '../../src/renderer/lib/i18n'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'

type Reply = { success: boolean; data?: unknown; error?: string; cancelled?: boolean }

const TOOLS = [
  { name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  {
    name: 'add',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    },
  },
  { name: 'ask', inputSchema: { type: 'object', properties: {} } },
]

/** An echo / add server: echo returns its text, add returns structuredContent. */
function reply(tool: string, args: Record<string, unknown>): Reply {
  if (tool === 'add') {
    const sum = Number(args.a) + Number(args.b)
    return {
      success: true,
      data: { content: [{ type: 'text', text: String(sum) }], structuredContent: { sum } },
    }
  }
  if (tool === 'fail') {
    return { success: true, data: { content: [{ type: 'text', text: 'blew up' }], isError: true } }
  }
  return { success: true, data: { content: [{ type: 'text', text: String(args.text ?? '') }] } }
}

let env: Record<string, string>
let mcp: {
  callTool: ReturnType<typeof vi.fn>
  respondInput: ReturnType<typeof vi.fn>
  readResource: ReturnType<typeof vi.fn>
  getPrompt: ReturnType<typeof vi.fn>
  cancelCall: ReturnType<typeof vi.fn>
}
let applyScriptUpdates: ReturnType<typeof vi.fn>

function installApi(): void {
  mcp = {
    callTool: vi.fn(async (_cid: string, tool: string, args: Record<string, unknown>) =>
      reply(tool, args),
    ),
    respondInput: vi.fn(async () => ({
      success: true,
      data: { content: [{ type: 'text', text: 'after input' }] },
    })),
    readResource: vi.fn(async (_cid: string, uri: string) => ({
      success: true,
      data: { contents: [{ uri, text: `contents of ${uri}` }] },
    })),
    getPrompt: vi.fn(async () => ({
      success: true,
      data: { messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }] },
    })),
    cancelCall: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
  }
  ;(window as unknown as { api: unknown }).api = { mcp }
}

function openTab(id: string): void {
  useTabsStore.setState({
    tabs: [
      ...useTabsStore.getState().tabs.filter((t) => t.id !== id),
      { id, name: id, protocol: 'mcp', isDirty: false } as Tab,
    ],
    activeTabId: id,
  })
  useMcpStore.getState().switchToTab(id)
  useRequestStore.getState().switchToTab(id)
  useMcpStore.setState({
    url: 'http://127.0.0.1:3100/mcp',
    connectionId: `conn-${id}`,
    connectionState: 'connected',
    tools: TOOLS,
    selectedTool: 'echo',
    toolArgs: '{"text":"hi"}',
  })
}

function switchTo(id: string): void {
  useTabsStore.setState({ activeTabId: id })
  useMcpStore.getState().switchToTab(id)
  useRequestStore.getState().switchToTab(id)
}

function scripts(pre: string, post: string, assertions: TestAssertion[] = []): void {
  useRequestStore.setState({ preScript: pre, postScript: post, assertions })
}

const row = (a: Partial<TestAssertion> & Pick<TestAssertion, 'type'>): TestAssertion => ({
  id: Math.random().toString(36).slice(2),
  name: a.type,
  enabled: true,
  ...a,
})

const names = (run: { results: { assertion: { name: string }; passed: boolean }[] } | null) =>
  run?.results.map((r) => [r.assertion.name, r.passed])

beforeEach(() => {
  window.localStorage.clear()
  // Raw JSON view: these tests send args as typed (the form view validates first).
  window.localStorage.setItem('testnizer-mcp-args-view', 'json')
  setLocale('en')
  installApi()
  env = { greeting: 'hello mcp' }
  applyScriptUpdates = vi.fn(async (envUpdates: Record<string, string>) => {
    Object.assign(env, envUpdates)
  })
  useEnvironmentStore.setState({
    getActiveVariables: () => ({ ...env }),
    applyScriptUpdates,
    globalVariables: [],
  } as never)
  useWorkspaceStore.setState({ activeWorkspaceId: null, activeProjectId: null } as never)
  useConsoleStore.setState({ entries: [] } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
  openTab('tab-a')
})

afterEach(() => {
  cleanup()
  setLocale('en')
})

describe('pre-request script', () => {
  it('runs before {{var}} resolves in the args; pm.variables is not persisted', async () => {
    scripts("pm.variables.set('who', 'scripts')", '')
    useMcpStore.setState({ toolArgs: '{"text":"hi {{who}}"}' })
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-tab-a',
      'echo',
      { text: 'hi scripts' },
      expect.anything(),
    )
    expect(applyScriptUpdates).not.toHaveBeenCalled()
  })

  it('pm.environment.set resolves now AND persists (HTTP rule, issue #29)', async () => {
    scripts("pm.environment.set('token', 'T-1')", '')
    useMcpStore.setState({ toolArgs: '{"text":"{{token}}"}' })
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-tab-a',
      'echo',
      { text: 'T-1' },
      expect.anything(),
    )
    expect(applyScriptUpdates).toHaveBeenCalledWith({ token: 'T-1' }, {})
  })

  it('a throw aborts the call with the script error; Run is free again', async () => {
    scripts("throw new Error('no token')", "pm.test('never', () => {})")
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).not.toHaveBeenCalled()
    const s = useMcpStore.getState()
    expect(s.resultError).toBe('Pre-request script error: no token')
    expect(s.isInvoking).toBe(false)
    expect(s.toolCallId).toBeNull()
    expect(s.toolTests).toBeNull()
  })

  it('pm.execution.skipRequest() skips the call', async () => {
    scripts('pm.execution.skipRequest()', '')
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).not.toHaveBeenCalled()
    expect(useMcpStore.getState().resultError).toMatch(/skipRequest/)
  })

  it('a resource URI and prompt args resolve with the pre-script writes too', async () => {
    scripts("pm.variables.set('doc', 'readme'); pm.variables.set('name', 'Ada')", '')
    useMcpStore.setState({ resourceUriDraft: 'test://{{doc}}', selectedResourceUri: null })
    await useMcpStore.getState().readResource()
    expect(mcp.readResource).toHaveBeenCalledWith('conn-tab-a', 'test://readme', expect.anything())
    useMcpStore.setState({
      prompts: [{ name: 'greet', arguments: [{ name: 'name', required: true }] }],
      selectedPrompt: 'greet',
      promptArgs: { name: '{{name}}' },
    })
    await useMcpStore.getState().getPrompt()
    expect(mcp.getPrompt).toHaveBeenCalledWith(
      'conn-tab-a',
      'greet',
      { name: 'Ada' },
      expect.anything(),
    )
  })

  it('console.log of the scripts reaches the Console panel', async () => {
    scripts("console.log('pre says hi')", "console.log('post says hi')")
    await useMcpStore.getState().callTool()
    const logs = useConsoleStore
      .getState()
      .entries.flatMap((e) => e.scriptLogs ?? [])
      .map((l) => l.message)
    expect(logs).toEqual(expect.arrayContaining(['pre says hi', 'post says hi']))
  })
})

describe('post-response checks', () => {
  it('assertion rows ({{var}} resolved) + pm.test with pm.response and pm.mcp', async () => {
    useMcpStore.setState({ toolArgs: '{"text":"{{greeting}}"}' })
    scripts(
      '',
      [
        "pm.test('text body', () => pm.expect(pm.response.text()).to.eql('hello mcp'))",
        "pm.test('status 200', () => pm.response.to.have.status(200))",
        "pm.test('pm.mcp', () => {",
        "  pm.expect(pm.mcp.capability).to.eql('tool')",
        "  pm.expect(pm.mcp.name).to.eql('echo')",
        '  pm.expect(pm.mcp.isError).to.eql(false)',
        "  pm.expect(pm.mcp.content[0].text).to.eql('hello mcp')",
        '})',
      ].join('\n'),
      [
        row({ name: 'Status is 200', type: 'status_equals', expected: 200 }),
        row({ name: 'Body has greeting', type: 'body_contains', expected: '{{greeting}}' }),
      ],
    )
    await useMcpStore.getState().callTool()
    expect(names(useMcpStore.getState().toolTests)).toEqual([
      ['Status is 200', true],
      ['Body has greeting', true],
      ['text body', true],
      ['status 200', true],
      ['pm.mcp', true],
    ])
  })

  it('structuredContent → pm.response.json(); JSONPath row passes', async () => {
    useMcpStore.setState({ selectedTool: 'add', toolArgs: '{"a":2,"b":3}' })
    scripts('', "pm.test('json', () => pm.expect(pm.response.json().sum).to.eql(5))", [
      row({ name: 'jsonpath sum', type: 'body_jsonpath', jsonPath: '$.sum', expected: '5' }),
    ])
    await useMcpStore.getState().callTool()
    expect(names(useMcpStore.getState().toolTests)).toEqual([
      ['jsonpath sum', true],
      ['json', true],
    ])
  })

  it('pm.environment.set in the post-script persists and chains into the next call', async () => {
    scripts('', "pm.environment.set('tok', pm.response.text())")
    useMcpStore.setState({ toolArgs: '{"text":"token-123"}' })
    await useMcpStore.getState().callTool()
    expect(applyScriptUpdates).toHaveBeenCalledWith({ tok: 'token-123' }, {})
    scripts('', "pm.test('chained', () => pm.expect(pm.response.text()).to.eql('got token-123'))")
    useMcpStore.setState({ toolArgs: '{"text":"got {{tok}}"}' })
    await useMcpStore.getState().callTool()
    expect(names(useMcpStore.getState().toolTests)).toEqual([['chained', true]])
  })

  it('a post-script throw is reported next to the results, not swallowed', async () => {
    scripts('', "pm.test('first', () => {}); throw new Error('oops')")
    await useMcpStore.getState().callTool()
    const run = useMcpStore.getState().toolTests
    expect(names(run)).toEqual([['first', true]])
    expect(run?.scriptError).toBe('oops')
  })

  it('no checks configured → no Test Results at all', async () => {
    scripts('', '')
    await useMcpStore.getState().callTool()
    expect(useMcpStore.getState().toolTests).toBeNull()
  })

  it('resource and prompt calls get checks with pm.mcp.capability', async () => {
    scripts(
      '',
      "pm.test('cap', () => pm.expect(['resource', 'prompt']).to.include(pm.mcp.capability))",
    )
    useMcpStore.setState({ resourceUriDraft: 'test://a', selectedResourceUri: 'test://a' })
    await useMcpStore.getState().readResource()
    expect(names(useMcpStore.getState().resourceTests)).toEqual([['cap', true]])
    useMcpStore.setState({ prompts: [{ name: 'greet' }], selectedPrompt: 'greet' })
    await useMcpStore.getState().getPrompt()
    expect(names(useMcpStore.getState().promptTests)).toEqual([['cap', true]])
  })
})

describe('no checks without a final result', () => {
  it('a failed call runs no post-response script', async () => {
    mcp.callTool.mockResolvedValueOnce({ success: false, error: 'boom' })
    scripts('', "pm.test('never', () => {})", [row({ type: 'status_equals', expected: 200 })])
    await useMcpStore.getState().callTool()
    expect(useMcpStore.getState().resultError).toBe('boom')
    expect(useMcpStore.getState().toolTests).toBeNull()
  })

  it('a cancelled call runs none', async () => {
    mcp.callTool.mockResolvedValueOnce({ success: false, cancelled: true })
    scripts('', "pm.test('never', () => {})")
    await useMcpStore.getState().callTool()
    expect(useMcpStore.getState().toolMeta?.status).toBe('cancelled')
    expect(useMcpStore.getState().toolTests).toBeNull()
  })

  it('an input_required round runs none; the final round (respondInput) does', async () => {
    mcp.callTool.mockResolvedValueOnce({
      success: true,
      data: {
        __mcp: {
          kind: 'input_required',
          inputRequests: {
            q: {
              method: 'elicitation/create',
              params: { message: 'Name?', requestedSchema: { type: 'object', properties: {} } },
            },
          },
          requestState: 's1',
        },
      },
    })
    useMcpStore.setState({ selectedTool: 'ask', toolArgs: '{}' })
    scripts(
      "pm.variables.set('x', '1')",
      "pm.test('final', () => pm.expect(pm.response.text()).to.eql('after input'))",
    )
    await useMcpStore.getState().callTool()
    expect(useMcpStore.getState().pendingInput).not.toBeNull()
    expect(useMcpStore.getState().toolTests).toBeNull()
    await useMcpStore.getState().respondInput({ q: { action: 'accept', content: {} } })
    expect(useMcpStore.getState().pendingInput).toBeNull()
    expect(names(useMcpStore.getState().toolTests)).toEqual([['final', true]])
  })
})

describe('a running pre-request script already owns the call', () => {
  /** A pre-script that waits on a promise the test releases. */
  function gatedPreScript(): () => void {
    let open!: () => void
    ;(globalThis as unknown as { __mcpGate: Promise<void> }).__mcpGate = new Promise<void>((r) => {
      open = r
    })
    scripts("await globalThis.__mcpGate; pm.variables.set('x', '1')", '')
    return open
  }

  it('Cancel during the script: the call never reaches the server', async () => {
    const open = gatedPreScript()
    const run = useMcpStore.getState().callTool()
    expect(useMcpStore.getState().isInvoking).toBe(true)
    await useMcpStore.getState().cancelCall('tool')
    expect(useMcpStore.getState().toolMeta?.status).toBe('cancelled')
    open()
    await run
    expect(mcp.callTool).not.toHaveBeenCalled()
    expect(useMcpStore.getState().toolMeta?.status).toBe('cancelled')
    expect(useMcpStore.getState().isInvoking).toBe(false)
  })

  it('a second Run while the script runs is ignored — one call goes out', async () => {
    const open = gatedPreScript()
    const first = useMcpStore.getState().callTool()
    const second = useMcpStore.getState().callTool()
    open()
    await Promise.all([first, second])
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
  })
})

describe('pm.request on an MCP call (what Run shows)', () => {
  it('method MCP, the server URL and the enabled custom headers — pre and post', async () => {
    useMcpStore.setState({
      customHeaders: [
        { id: 'h1', key: 'X-Team', value: '{{team}}', enabled: true },
        { id: 'h2', key: 'X-Off', value: 'no', enabled: false },
      ],
    })
    scripts(
      [
        "pm.test('pre method', () => pm.expect(pm.request.method).to.eql('MCP'))",
        "pm.environment.set('preUrl', pm.request.url.toString())",
        "pm.environment.set('preTeam', pm.request.headers.get('X-Team'))",
      ].join('\n'),
      [
        "pm.test('post method', () => pm.expect(pm.request.method).to.eql('MCP'))",
        "pm.test('post url', () => pm.expect(pm.request.url.toString()).to.eql('http://127.0.0.1:3100/mcp'))",
        "pm.test('no disabled header', () => pm.expect(pm.request.headers.has('X-Off')).to.eql(false))",
      ].join('\n'),
    )
    await useMcpStore.getState().callTool()
    expect(env.preUrl).toBe('http://127.0.0.1:3100/mcp')
    expect(env.preTeam).toBe('{{team}}')
    expect(names(useMcpStore.getState().toolTests)).toEqual([
      ['post method', true],
      ['post url', true],
      ['no disabled header', true],
    ])
  })

  it('a post-script that only chains a variable leaves no empty Test Results view', async () => {
    scripts('', "pm.environment.set('last', pm.response.text())")
    await useMcpStore.getState().callTool()
    expect(applyScriptUpdates).toHaveBeenCalledWith({ last: 'hi' }, {})
    expect(useMcpStore.getState().toolTests).toBeNull()
  })
})

describe('per tab (issue #76 class)', () => {
  it('scripts are captured from the starting tab; results land on it, not on the tab in view', async () => {
    let release!: (r: Reply) => void
    mcp.callTool.mockImplementationOnce(
      () =>
        new Promise<Reply>((r) => {
          release = r
        }),
    )
    scripts('', "pm.test('from tab A', () => {})")
    const run = useMcpStore.getState().callTool()
    await vi.waitFor(() => expect(mcp.callTool).toHaveBeenCalledTimes(1))

    openTab('tab-b')
    scripts('', "pm.test('from tab B', () => {})")
    release({ success: true, data: { content: [{ type: 'text', text: 'A' }] } })
    await run

    expect(useMcpStore.getState().toolTests).toBeNull()
    expect(names(useMcpStore.getState()._tabStates.get('tab-a')?.toolTests ?? null)).toEqual([
      ['from tab A', true],
    ])
    switchTo('tab-a')
    expect(names(useMcpStore.getState().toolTests)).toEqual([['from tab A', true]])
  })
})

describe('Test Results view', () => {
  it('Result | Test Results tabs with HTTP’s passed/total count and PASSED / FAILED rows', async () => {
    scripts('', "pm.test('ok', () => {}); pm.test('bad', () => pm.expect(1).to.eql(2))", [
      row({ name: 'Status is 200', type: 'status_equals', expected: 200 }),
    ])
    render(<McpToolPane />)
    expect(screen.queryByTestId('mcp-result-tab-tests')).toBeNull()
    await act(async () => {
      await useMcpStore.getState().callTool()
    })
    const summary = screen.getByTestId('mcp-tests-summary')
    expect(summary).toHaveTextContent('2/3')
    expect(summary.getAttribute('data-passed')).toBe('false')
    // The result stays the default view.
    expect(screen.getByTestId('mcp-result')).toBeTruthy()
    fireEvent.click(screen.getByTestId('mcp-result-tab-tests'))
    const panel = within(screen.getByTestId('mcp-test-results'))
    expect(panel.getAllByText('PASSED')).toHaveLength(2)
    expect(panel.getAllByText('FAILED')).toHaveLength(1)
    expect(panel.getByText('Status is 200')).toBeTruthy()
  })

  it('all passed → green summary; Turkish label', async () => {
    const prev = useUIStore.getState().locale
    useUIStore.setState({ locale: 'tr' })
    try {
      scripts('', "pm.test('ok', () => {})")
      render(<McpToolPane />)
      await act(async () => {
        await useMcpStore.getState().callTool()
      })
      expect(screen.getByTestId('mcp-tests-summary').getAttribute('data-passed')).toBe('true')
      expect(screen.getByTestId('mcp-result-tab-tests')).toHaveTextContent('Test Sonuçları')
    } finally {
      useUIStore.setState({ locale: prev })
    }
  })
})

describe('resolveAssertionVars (Send reads rows like the Runner)', () => {
  it('resolves {{var}} in expected / headerName / range; leaves the rest untouched', () => {
    const r = (t: string) =>
      t.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => ({ a: 'A', n: '201' })[k] ?? '')
    const [one, two, three] = resolveAssertionVars(
      [
        row({ type: 'body_contains', expected: 'x{{a}}' }),
        row({ type: 'header_equals', headerName: '{{a}}-h', expected: 7 }),
        row({ type: 'status_in_range', rangeMin: '{{n}}' as unknown as number, rangeMax: 299 }),
      ],
      r,
    )
    expect(one.expected).toBe('xA')
    expect(two.headerName).toBe('A-h')
    expect(two.expected).toBe(7)
    expect(three.rangeMin).toBe(201)
    expect(three.rangeMax).toBe(299)
  })
})

describe('review item 3: a cancelled call\'s late reply never steals the next call\'s script context', () => {
  it('cancel A, start B, A answers late — B still runs its post-response checks', async () => {
    let answerA!: (r: Reply) => void
    let answerB!: (r: Reply) => void
    mcp.callTool
      .mockImplementationOnce(() => new Promise<Reply>((r) => (answerA = r)))
      .mockImplementationOnce(() => new Promise<Reply>((r) => (answerB = r)))
    scripts('', "pm.test('B body', () => pm.expect(pm.response.text()).to.eql('B'))")

    const callA = useMcpStore.getState().callTool()
    await vi.waitFor(() => expect(mcp.callTool).toHaveBeenCalledTimes(1))
    await useMcpStore.getState().cancelCall('tool')

    const callB = useMcpStore.getState().callTool()
    await vi.waitFor(() => expect(mcp.callTool).toHaveBeenCalledTimes(2))

    // A's reply arrives after the user moved on to B.
    answerA({ success: true, data: { content: [{ type: 'text', text: 'A' }] } })
    await callA
    answerB({ success: true, data: { content: [{ type: 'text', text: 'B' }] } })
    await callB

    expect(names(useMcpStore.getState().toolTests)).toEqual([['B body', true]])
  })
})

describe('review item 18: the Send console never shows the raw server secret', () => {
  it('script-log entries carry the masked URL', async () => {
    useMcpStore.setState({ url: 'http://user:pw@127.0.0.1:3100/mcp?api_key=SECRET1' })
    scripts("console.log('pre')", "console.log('post')")
    await useMcpStore.getState().callTool()
    const entries = useConsoleStore.getState().entries
    expect(entries.length).toBeGreaterThan(0)
    const all = JSON.stringify(entries)
    expect(all).not.toContain('SECRET1')
    expect(all).not.toContain('user:pw')
    expect(all).toContain('127.0.0.1:3100/mcp')
  })

  it('a stdio command line is masked too', async () => {
    useMcpStore.setState({ url: 'npx -y srv --api-key SECRET2' })
    scripts("console.log('pre')", '')
    await useMcpStore.getState().callTool()
    expect(JSON.stringify(useConsoleStore.getState().entries)).not.toContain('SECRET2')
  })
})
