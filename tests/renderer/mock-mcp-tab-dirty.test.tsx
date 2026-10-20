/**
 * Issue #210 — Mock MCP editor: one draft, one Save (product decision), but
 * the user could not tell which tab held the unsaved edits, and a default
 * item from "Add" (new_tool, mock://resource-1, new_prompt) was easy to save
 * by accident. Now Tools / Resources / Prompts carry an unsaved dot, and Save
 * warns about untouched defaults (Save anyway / Go back).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import {
  blankDefaultItems,
  sectionDirty,
} from '../../src/renderer/components/mock-mcp/mock-mcp-dirty'
import {
  blankPrompt,
  blankResource,
  blankToolDraft,
  serverToDraft,
} from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import { installBridge, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

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
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

async function renderEditor(): Promise<void> {
  await act(async () => {
    await useMockMcpStore.getState().loadServers('p-1')
  })
  render(<MockMcpServerEditor serverId="a" />)
}

const dot = (id: string) => screen.queryByTestId(`mock-mcp-tab-dirty-${id}`)

describe('unsaved dot per tab (issue #210)', () => {
  it('only the tab whose section changed gets the dot; the label text is unchanged', async () => {
    await renderEditor()
    expect(dot('tools')).toBeNull()
    expect(dot('resources')).toBeNull()
    expect(dot('prompts')).toBeNull()

    fireEvent.click(screen.getByTestId('mock-mcp-tab-resources'))
    fireEvent.click(screen.getByTestId('mock-mcp-resource-add'))
    expect(dot('resources')).toBeInTheDocument()
    expect(dot('resources')).toHaveAccessibleName('Unsaved changes in this tab')
    expect(dot('tools')).toBeNull()
    expect(dot('prompts')).toBeNull()
    expect(screen.getByTestId('mock-mcp-tab-resources')).toHaveTextContent(/^Resources \(1\)$/)

    fireEvent.click(screen.getByTestId('mock-mcp-tab-prompts'))
    fireEvent.click(screen.getByTestId('mock-mcp-prompt-add'))
    expect(dot('prompts')).toBeInTheDocument()
    expect(dot('tools')).toBeNull()
  })

  it('editing a General field marks no list tab; undoing a list edit clears its dot', async () => {
    await renderEditor()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    expect(screen.getByTestId('mock-mcp-unsaved')).toBeInTheDocument()
    expect(dot('tools')).toBeNull()

    fireEvent.click(screen.getByTestId('mock-mcp-tab-resources'))
    fireEvent.click(screen.getByTestId('mock-mcp-resource-add'))
    expect(dot('resources')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-mcp-resource-delete'))
    expect(dot('resources')).toBeNull()
    // The draft (name edit) is still unsaved.
    expect(screen.getByTestId('mock-mcp-unsaved')).toBeInTheDocument()
  })

  it('a tool edit marks the Tools tab; Save clears every dot', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    const desc = within(screen.getByTestId('mock-mcp-tool-form')).getByDisplayValue('Echoes')
    fireEvent.change(desc, { target: { value: 'Echoes back' } })
    expect(dot('tools')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dot('tools')).toBeNull())
  })

  it('the header Save says it saves all tabs', async () => {
    await renderEditor()
    expect(screen.getByTestId('mock-mcp-save')).toHaveAttribute(
      'title',
      'Save all tabs (General, Scenarios, Tools, Resources, Prompts)',
    )
  })
})

describe('warning before saving blank defaults (issue #210)', () => {
  it('Save with an untouched added resource asks first; Go back keeps the draft', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-resources'))
    fireEvent.click(screen.getByTestId('mock-mcp-resource-add'))
    fireEvent.click(screen.getByTestId('mock-mcp-save'))

    const dialog = await screen.findByTestId('mock-mcp-blank-dialog')
    expect(within(dialog).getByTestId('mock-mcp-blank-list')).toHaveTextContent('mock://resource-1')
    expect(stub.bridge.server.update).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByTestId('mock-mcp-blank-back'))
    await waitFor(() => expect(screen.queryByTestId('mock-mcp-blank-dialog')).toBeNull())
    expect(stub.bridge.server.update).not.toHaveBeenCalled()
    expect(useMockMcpStore.getState().drafts.a?.resources).toHaveLength(1)
  })

  it('Save anyway saves once, through the normal path', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    fireEvent.click(screen.getByTestId('mock-mcp-tool-add'))
    fireEvent.keyDown(screen.getByTestId('mock-mcp-editor'), { key: 's', ctrlKey: true })
    const dialog = await screen.findByTestId('mock-mcp-blank-dialog')
    expect(within(dialog).getByTestId('mock-mcp-blank-list')).toHaveTextContent('new_tool')
    // Ctrl+S while the warning is open does not save behind it.
    fireEvent.keyDown(within(dialog).getByTestId('mock-mcp-blank-back'), {
      key: 's',
      ctrlKey: true,
    })
    expect(stub.bridge.server.update).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByTestId('mock-mcp-blank-save'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    const patch = vi.mocked(stub.bridge.server.update).mock.calls[0][1]
    // Explicit element type: the bridge types come from the preload .d.ts,
    // which an editor outside the web tsconfig resolves to `any`.
    expect(patch.tools?.map((x: { name: string }) => x.name)).toEqual(['echo', 'new_tool'])
    await waitFor(() => expect(useMockMcpStore.getState().drafts.a).toBeUndefined())
  })

  it('a filled-in item saves without asking', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-resources'))
    fireEvent.click(screen.getByTestId('mock-mcp-resource-add'))
    fireEvent.change(screen.getByTestId('mock-mcp-resource-uri'), {
      target: { value: 'mock://readme' },
    })
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('mock-mcp-blank-dialog')).toBeNull()
  })

  it('the warning is translated', async () => {
    useUIStore.getState().setLocale('tr')
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-prompts'))
    fireEvent.click(screen.getByTestId('mock-mcp-prompt-add'))
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    const dialog = await screen.findByTestId('mock-mcp-blank-dialog')
    expect(within(dialog).getByTestId('mock-mcp-blank-save')).toHaveTextContent('Yine de kaydet')
    expect(within(dialog).getByTestId('mock-mcp-blank-back')).toHaveTextContent('Geri dön')
  })
})

describe('mock-mcp-dirty helpers (issue #210)', () => {
  const server = sampleServer({ id: 'a' })

  it('a fresh draft of the saved server is clean, despite new React keys', () => {
    expect(sectionDirty(serverToDraft(server), serverToDraft(server))).toEqual({
      tools: false,
      resources: false,
      prompts: false,
    })
  })

  it('a cleared optional field reads as unchanged', () => {
    const saved = serverToDraft(server)
    const draft = { ...saved, tools: saved.tools.map((x) => ({ ...x, title: '' })) }
    expect(sectionDirty(draft, saved).tools).toBe(false)
  })

  it('an unparseable schema marks Tools dirty', () => {
    const saved = serverToDraft(server)
    const draft = { ...saved, tools: saved.tools.map((x) => ({ ...x, schemaText: '{' })) }
    expect(sectionDirty(draft, saved).tools).toBe(true)
  })

  it('flags only untouched defaults that are not already saved', () => {
    const saved = serverToDraft(server)
    const draft = {
      ...saved,
      tools: [...saved.tools, blankToolDraft('new_tool'), blankToolDraft('weather')],
      resources: [blankResource(1), { ...blankResource(2), text: 'hello' }],
      prompts: [blankPrompt('new_prompt_2')],
    }
    expect(blankDefaultItems(draft, server)).toEqual([
      { kind: 'tool', label: 'new_tool' },
      { kind: 'resource', label: 'mock://resource-1' },
      { kind: 'prompt', label: 'new_prompt_2' },
    ])
    // Saved once on purpose — not asked about again.
    const savedWithBlank = sampleServer({
      tools: [{ ...server.tools[0], name: 'new_tool' }],
      resources: [{ uri: 'mock://resource-1', name: 'resource-1' }],
    })
    expect(
      blankDefaultItems(
        { ...draft, tools: [blankToolDraft('new_tool')], prompts: [] },
        savedWithBlank,
      ),
    ).toEqual([])
  })
})
