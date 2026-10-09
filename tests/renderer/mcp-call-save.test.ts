/**
 * Issue #159 — Save the MCP call. Ctrl+S on an MCP tab used to persist only
 * the connection config (transport / url / headers / auth / protocol), so a
 * reopened request came back with no tool selected and `{}` arguments. The
 * call — capability tab, selected tool + raw args (`{{var}}` kept), resource
 * URI, prompt + its args — now rides `metadata.mcp.call`, survives Connect /
 * Disconnect, and edits to it flip the dirty dot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import { restoreMcpCall, useMcpStore } from '../../src/renderer/stores/mcp.store'
import { readSavedMcpCall } from '../../src/renderer/stores/mcp-call.slice'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

const ECHO = {
  name: 'echo',
  inputSchema: {
    type: 'object',
    properties: { msg: { type: 'string' }, times: { type: 'integer' } },
    required: ['msg'],
  },
}

function installApi() {
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: 'conn-159', transport: 'http', url: 'http://x/mcp' },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({ success: true, data: [ECHO] })),
    listResources: vi.fn(async () => ({ success: true, data: { resources: [], templates: [] } })),
    listPrompts: vi.fn(async () => ({ success: true, data: [] })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

function openTab(id: string): void {
  useTabsStore.setState({
    tabs: [{ id, name: 'MCP', protocol: 'mcp', isDirty: false } as Tab],
    activeTabId: id,
  })
  useMcpStore.getState().switchToTab(id)
}

const isDirty = (id: string): boolean =>
  useTabsStore.getState().tabs.find((t) => t.id === id)?.isDirty ?? false

beforeEach(() => {
  installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('MCP call snapshot (issue #159)', () => {
  it('Ctrl+S captures the capability tab, tool + raw args, resource and prompt', () => {
    openTab('tab-src')
    useMcpStore.setState({
      url: 'http://x/mcp',
      capabilityTab: 'prompts',
      selectedTool: 'echo',
      toolArgs: '{\n  "msg": "{{who}}"\n}',
      selectedResourceUri: 'test://item/{id}',
      resourceUriDraft: 'test://item/42',
      selectedPrompt: 'greet',
      promptArgs: { name: '{{user}}' },
    })
    const { protocolMeta } = snapshotProtocol({ id: 'tab-src', protocol: 'mcp' } as Tab)
    const mcp = (protocolMeta as { mcp: Record<string, unknown> }).mcp
    expect(mcp.call).toEqual({
      capabilityTab: 'prompts',
      selectedTool: 'echo',
      toolArgs: '{\n  "msg": "{{who}}"\n}',
      selectedResourceUri: 'test://item/{id}',
      resourceUriDraft: 'test://item/42',
      selectedPrompt: 'greet',
      promptArgs: { name: '{{user}}' },
    })
  })

  it('reopen restores the call into the new tab and leaves it clean', () => {
    openTab('tab-src')
    useMcpStore.setState({
      url: 'http://x/mcp',
      capabilityTab: 'resources',
      selectedTool: 'echo',
      toolArgs: '{"msg":"{{who}}"}',
      selectedResourceUri: 'test://a',
      resourceUriDraft: 'test://a',
    })
    const { protocolMeta } = snapshotProtocol({ id: 'tab-src', protocol: 'mcp' } as Tab)

    openTab('tab-reopen')
    restoreProtocolFromMetadata('mcp', protocolMeta)
    const s = useMcpStore.getState()
    expect(s._currentTabId).toBe('tab-reopen')
    expect(s.capabilityTab).toBe('resources')
    expect(s.selectedTool).toBe('echo')
    expect(s.toolArgs).toBe('{"msg":"{{who}}"}')
    expect(s.resourceUriDraft).toBe('test://a')
    expect(isDirty('tab-reopen')).toBe(false)
  })

  it('a row saved before #159 (no call) opens as today', () => {
    openTab('tab-old')
    restoreProtocolFromMetadata('mcp', { mcp: { transport: 'http', url: 'http://x/mcp' } })
    const s = useMcpStore.getState()
    expect(s.capabilityTab).toBe('tools')
    expect(s.selectedTool).toBeNull()
    expect(s.toolArgs).toBe('{}')
    expect(s.selectedPrompt).toBeNull()
    expect(s.promptArgs).toEqual({})
  })

  it('readSavedMcpCall is tolerant of junk', () => {
    expect(readSavedMcpCall(undefined)).toEqual({})
    expect(readSavedMcpCall('nope')).toEqual({})
    expect(
      readSavedMcpCall({
        capabilityTab: 'bogus',
        selectedTool: 7,
        toolArgs: '{"a":1}',
        promptArgs: { a: 'x', b: 3 },
      }),
    ).toEqual({ toolArgs: '{"a":1}', promptArgs: { a: 'x' } })
  })
})

describe('MCP call survives the connection (issue #159)', () => {
  it('Connect keeps the saved tool selected and does not regenerate its args', async () => {
    openTab('tab-conn')
    useMcpStore.setState({ url: 'http://x/mcp' })
    restoreMcpCall({ selectedTool: 'echo', toolArgs: '{"msg":"saved"}' })
    await useMcpStore.getState().connect()
    let s = useMcpStore.getState()
    expect(s.connectionState).toBe('connected')
    expect(s.tools.map((t) => t.name)).toEqual(['echo'])
    expect(s.selectedTool).toBe('echo')
    expect(s.toolArgs).toBe('{"msg":"saved"}')

    // Re-clicking the selected tool keeps the args (only a different tool resets them).
    useMcpStore.getState().setSelectedTool('echo')
    expect(useMcpStore.getState().toolArgs).toBe('{"msg":"saved"}')

    await useMcpStore.getState().disconnect()
    s = useMcpStore.getState()
    expect(s.selectedTool).toBe('echo')
    expect(s.toolArgs).toBe('{"msg":"saved"}')
  })

  it('selecting a different tool still fills example args (defaults first)', async () => {
    openTab('tab-ex')
    useMcpStore.setState({ url: 'http://x/mcp' })
    await useMcpStore.getState().connect()
    useMcpStore.setState({
      tools: [
        ECHO,
        {
          name: 'count',
          inputSchema: { type: 'object', properties: { n: { type: 'integer', default: 3 } } },
        },
      ],
    })
    useMcpStore.getState().setSelectedTool('count')
    expect(JSON.parse(useMcpStore.getState().toolArgs)).toEqual({ n: 3 })
  })

  it('restoreMcpCall writes the live slice without marking the tab dirty', () => {
    openTab('tab-restore')
    restoreMcpCall({
      capabilityTab: 'prompts',
      selectedPrompt: 'greet',
      promptArgs: { name: 'Ada' },
    })
    const s = useMcpStore.getState()
    expect(s.capabilityTab).toBe('prompts')
    expect(s.selectedPrompt).toBe('greet')
    expect(s.promptArgs).toEqual({ name: 'Ada' })
    expect(isDirty('tab-restore')).toBe(false)
  })
})

describe('MCP call edits flip the dirty dot (issue #159)', () => {
  it('picking a different tool / resource / prompt flips it (it rewrites saved fields)', () => {
    openTab('tab-s1')
    useMcpStore.setState({ tools: [ECHO] })
    useMcpStore.getState().setSelectedTool('echo')
    expect(isDirty('tab-s1')).toBe(true)

    openTab('tab-s2')
    useMcpStore.getState().selectResource('test://a')
    expect(isDirty('tab-s2')).toBe(true)

    openTab('tab-s3')
    useMcpStore.getState().setSelectedPrompt('greet')
    expect(isDirty('tab-s3')).toBe(true)
  })

  it('re-selecting the selected resource keeps an edited template URI', () => {
    openTab('tab-s4')
    restoreMcpCall({ selectedResourceUri: 'test://item/{id}', resourceUriDraft: 'test://item/42' })
    useMcpStore.getState().selectResource('test://item/{id}')
    expect(useMcpStore.getState().resourceUriDraft).toBe('test://item/42')
  })

  it('args / prompt arg / resource URI edits mark the active tab dirty', () => {
    openTab('tab-d1')
    useMcpStore.getState().setToolArgs('{"msg":"x"}')
    expect(isDirty('tab-d1')).toBe(true)

    openTab('tab-d2')
    useMcpStore.getState().setPromptArg('name', 'Ada')
    expect(isDirty('tab-d2')).toBe(true)

    openTab('tab-d3')
    useMcpStore.getState().setResourceUriDraft('test://b')
    expect(isDirty('tab-d3')).toBe(true)
  })
})
