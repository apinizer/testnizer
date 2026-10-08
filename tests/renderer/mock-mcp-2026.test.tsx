/**
 * Issue #152 — Mock MCP editor on protocol 2026-07-28: Legacy clients
 * (`legacyMode`) and Cache TTL on the General tab, the per-tool Elicitation
 * section (fields table ⇄ the restricted schema, kept across a round trip),
 * the "Ask name (elicitation)" preset (a copy of the backend's example — kept
 * equal and valid here), and the served eras in the header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  draftToPatch,
  serverToDraft,
  toolToDraft,
} from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import {
  draftToElicit,
  elicitToDraft,
  rowsToElicitSchema,
} from '../../src/renderer/components/mock-mcp/mock-mcp-elicit'
import { elicitationExampleTool } from '../../src/renderer/components/mock-mcp/mock-mcp-presets'
import {
  exampleElicitationTool,
  normalizeTools,
  validateMockMcpConfig,
} from '../../src/main/mock-mcp/config'
import { installBridge, runningState, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

let stub: BridgeStub

beforeEach(() => {
  stub = installBridge([sampleServer({ id: 'a', name: 'Alpha' })])
  useMockMcpStore.setState({
    servers: [],
    projectId: null,
    stateByServer: {},
    logsByServer: {},
    drafts: {},
  })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

afterEach(() => cleanup())

async function renderEditor(): Promise<void> {
  await act(async () => {
    await useMockMcpStore.getState().loadServers('p-1')
  })
  render(<MockMcpServerEditor serverId="a" />)
}

async function savedPatch(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId('mock-mcp-save'))
  await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
  return vi.mocked(stub.bridge.server.update).mock.calls[0][1] as Record<string, unknown>
}

describe('elicitation draft ⇄ DTO', () => {
  it('the preset equals the backend example and passes the backend validator', () => {
    expect(elicitationExampleTool()).toEqual(exampleElicitationTool())
    const problem = validateMockMcpConfig({
      name: 'x',
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      authMode: 'none',
      latencyMs: 0,
      errorMode: { kind: 'none' },
      protocolPin: null,
      legacyMode: 'stateless',
      cacheTtlMs: 0,
      tools: normalizeTools([elicitationExampleTool()]),
      resources: [],
      prompts: [],
    })
    expect(problem).toBeNull()
  })

  it('round-trips an elicitation unchanged — extra keywords (title, minLength) kept', () => {
    const tool = elicitationExampleTool()
    const draft = toolToDraft(tool)
    expect(draft.elicit?.fields).toMatchObject([
      { name: 'name', type: 'string', required: true, extra: { title: 'Name', minLength: 1 } },
    ])
    const patch = draftToPatch({ ...serverToDraft(sampleServer()), tools: [draft] })
    expect(patch.patch?.tools?.[0].elicit).toEqual(tool.elicit)
  })

  it('enum / number / boolean rows build the restricted schema; titled oneOf reads as enum', () => {
    const d = elicitToDraft({
      key: 'k',
      message: 'm',
      schema: {
        type: 'object',
        properties: { tier: { type: 'string', oneOf: [{ const: 'pro', title: 'Pro' }] } },
      },
    })
    expect(d.fields[0]).toMatchObject({ type: 'enum', enumText: 'pro', required: false })
    d.fields.push(
      { id: 'n', name: 'qty', type: 'integer', enumText: '', required: true, extra: {} },
      { id: 'b', name: 'ok', type: 'boolean', enumText: '', required: false, extra: {} },
      { id: 'x', name: ' ', type: 'string', enumText: '', required: true, extra: {} },
    )
    d.fields[0].enumText = 'free, pro ,, enterprise'
    expect(rowsToElicitSchema(d.fields)).toEqual({
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
        qty: { type: 'integer' },
        ok: { type: 'boolean' },
      },
      required: ['qty'],
    })
    expect(draftToElicit({ ...d, responseTemplate: '  ' })).not.toHaveProperty('responseTemplate')
  })

  it('an enum field without values blocks Save with a readable problem', () => {
    const draft = toolToDraft(elicitationExampleTool())
    if (!draft.elicit) throw new Error('elicit expected')
    draft.elicit.fields[0] = { ...draft.elicit.fields[0], type: 'enum', enumText: ' , ' }
    const r = draftToPatch({ ...serverToDraft(sampleServer()), tools: [draft] })
    expect(r.problem).toEqual({
      key: 'mockMcp.validation.elicitEnum',
      tool: 'ask_name',
      detail: 'name',
    })
  })
})

describe('Mock MCP editor — 2026-07-28 knobs', () => {
  it('General: Legacy clients = Reject and a Cache TTL reach the patch; the pin list offers 2026-07-28', async () => {
    await renderEditor()
    const pin = screen.getByTestId('mock-mcp-protocol-pin') as HTMLSelectElement
    expect([...pin.options].map((o) => o.value)).toContain('2026-07-28')
    expect(screen.getByTestId('mock-mcp-legacy-mode')).toHaveValue('stateless')
    fireEvent.change(screen.getByTestId('mock-mcp-legacy-mode'), { target: { value: 'reject' } })
    expect(screen.getByText(/-32022/)).toBeInTheDocument()
    const ttl = screen.getByTestId('mock-mcp-cache-ttl')
    fireEvent.focus(ttl)
    fireEvent.change(ttl, { target: { value: '60000' } })
    fireEvent.blur(ttl)
    const patch = await savedPatch()
    expect(patch).toMatchObject({ legacyMode: 'reject', cacheTtlMs: 60000 })
  })

  it('Tools: the "Ask name" preset and an edited Elicitation section are saved as `elicit`', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    fireEvent.click(screen.getByTestId('mock-mcp-tool-add-elicit'))
    expect(screen.getByTestId('mock-mcp-tool-elicit-enabled')).toBeChecked()
    expect(screen.getByTestId('mock-mcp-tool-elicit-key')).toHaveValue('name')
    fireEvent.change(screen.getByTestId('mock-mcp-tool-elicit-message'), {
      target: { value: 'Who are you?' },
    })
    fireEvent.click(screen.getByTestId('mock-mcp-tool-elicit-add-field'))
    const names = screen.getAllByTestId('mock-mcp-tool-elicit-field-name')
    fireEvent.change(names[1], { target: { value: 'tier' } })
    fireEvent.change(screen.getAllByTestId('mock-mcp-tool-elicit-field-type')[1], {
      target: { value: 'enum' },
    })
    fireEvent.change(screen.getAllByTestId('mock-mcp-tool-elicit-field-enum')[1], {
      target: { value: 'free, pro' },
    })
    fireEvent.click(screen.getAllByTestId('mock-mcp-tool-elicit-field-required')[1])
    const patch = await savedPatch()
    const tools = patch.tools as Array<{ name: string; elicit?: Record<string, unknown> }>
    expect(tools.map((t) => t.name)).toEqual(['echo', 'ask_name'])
    expect(tools[1].elicit).toEqual({
      key: 'name',
      message: 'Who are you?',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name', minLength: 1 },
          tier: { type: 'string', enum: ['free', 'pro'] },
        },
        required: ['name'],
      },
    })
  })

  it('turning the Elicitation section off removes `elicit` from the tool', async () => {
    stub = installBridge([sampleServer({ id: 'a', tools: [elicitationExampleTool()] })])
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    fireEvent.click(screen.getByTestId('mock-mcp-tool-elicit-enabled'))
    const patch = await savedPatch()
    expect((patch.tools as Array<Record<string, unknown>>)[0]).not.toHaveProperty('elicit')
  })

  it('the header lists the served eras and the 2025 no-notifications hint; Notify calls the IPC', async () => {
    vi.mocked(stub.bridge.server.status).mockResolvedValue({
      success: true,
      data: { ...runningState('a'), eras: ['legacy', 'modern'], legacyNotifications: false },
    })
    await renderEditor()
    const eras = await screen.findByTestId('mock-mcp-eras')
    expect(eras).toHaveTextContent('2026-07-28 + 2025 (stateless)')
    expect(eras).toHaveTextContent('2025 clients get no list_changed')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-mcp-notify'))
    })
    expect(stub.bridge.server.notify).toHaveBeenCalledWith('a', 'tools')
  })
})
