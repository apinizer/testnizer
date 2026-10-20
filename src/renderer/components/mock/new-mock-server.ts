/**
 * Logic behind the "New mock server" dialog (issues #140, #221): the type
 * list, the preset catalog of every type, the name / port suggestions and
 * the create action. One flow for every type — only the factory at the end
 * differs: MCP has its own store; HTTP and SSE share the HTTP mock table and
 * `createFromHttpPreset` (the preset carries the server kind).
 *
 * Adding a type (AI, Faz 2) = one entry in `MOCK_DIALOG_KINDS` plus one in
 * each `Record<MockKind, …>` below — TypeScript flags every one that is
 * missing.
 */
import { useMockStore } from '../../stores/mock.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import {
  buildPresetInput,
  MOCK_MCP_PRESET_HINT_KEYS,
  MOCK_MCP_PRESET_IDS,
  MOCK_MCP_PRESET_LABEL_KEYS,
  MOCK_MCP_PRESET_NAMES,
  type MockMcpPresetId,
} from '../mock-mcp/mock-mcp-presets'
import { openMockMcpServerTab } from '../mock-mcp/mock-mcp-tabs'
import {
  buildHttpPreset,
  createFromHttpPreset,
  MOCK_HTTP_PRESET_HINT_KEYS,
  MOCK_HTTP_PRESET_IDS,
  MOCK_HTTP_PRESET_LABEL_KEYS,
  MOCK_HTTP_PRESET_NAMES,
  type HttpPreset,
  type MockHttpPresetId,
} from './mock-http-presets'
import {
  buildSsePreset,
  MOCK_SSE_PRESET_HINT_KEYS,
  MOCK_SSE_PRESET_IDS,
  MOCK_SSE_PRESET_LABEL_KEYS,
  MOCK_SSE_PRESET_NAMES,
  type MockSsePresetId,
} from './mock-sse-presets'
import {
  HTTP_MOCK_PORT_START,
  MCP_MOCK_PORT_START,
  SSE_MOCK_PORT_START,
  suggestPort,
} from './mock-create-helpers'
import { openMockServerTab } from './mock-http-tabs'

/** A type offered by the dialog. */
export type MockKind = 'http' | 'mcp' | 'sse'

/** The dialog's type switch, in order (the Mocks sidebar uses the same order). */
export const MOCK_DIALOG_KINDS: readonly MockKind[] = ['http', 'mcp', 'sse']

export const MOCK_KIND_LABEL: Record<MockKind, string> = { http: 'HTTP', mcp: 'MCP', sse: 'SSE' }

/** i18n key of the one-line hint under the type switch — literal for the key-coverage test. */
export const MOCK_KIND_HINT_KEYS: Record<MockKind, string> = {
  http: 'mockNew.typeHttpHint',
  mcp: 'mockNew.typeMcpHint',
  sse: 'mockNew.typeSseHint',
}

export interface MockPresetOption {
  id: string
  labelKey: string
  hintKey: string
  defaultName: string
}

export const DEFAULT_PRESET: Record<MockKind, string> = {
  http: 'blank',
  mcp: 'echo',
  sse: 'ticker',
}

function optionsOf<Id extends string>(
  ids: readonly Id[],
  labels: Record<Id, string>,
  hints: Record<Id, string>,
  names: Record<Id, string>,
): MockPresetOption[] {
  return ids.map((id) => ({
    id,
    labelKey: labels[id],
    hintKey: hints[id],
    defaultName: names[id],
  }))
}

const OPTIONS: Record<MockKind, MockPresetOption[]> = {
  http: optionsOf(
    MOCK_HTTP_PRESET_IDS,
    MOCK_HTTP_PRESET_LABEL_KEYS,
    MOCK_HTTP_PRESET_HINT_KEYS,
    MOCK_HTTP_PRESET_NAMES,
  ),
  mcp: optionsOf(
    MOCK_MCP_PRESET_IDS,
    MOCK_MCP_PRESET_LABEL_KEYS,
    MOCK_MCP_PRESET_HINT_KEYS,
    MOCK_MCP_PRESET_NAMES,
  ),
  sse: optionsOf(
    MOCK_SSE_PRESET_IDS,
    MOCK_SSE_PRESET_LABEL_KEYS,
    MOCK_SSE_PRESET_HINT_KEYS,
    MOCK_SSE_PRESET_NAMES,
  ),
}

const PORT_START: Record<MockKind, number> = {
  http: HTTP_MOCK_PORT_START,
  mcp: MCP_MOCK_PORT_START,
  sse: SSE_MOCK_PORT_START,
}

export function presetOptions(kind: MockKind): MockPresetOption[] {
  return OPTIONS[kind]
}

export function presetOption(kind: MockKind, presetId: string): MockPresetOption {
  const list = presetOptions(kind)
  return list.find((o) => o.id === presetId) ?? list[0]
}

/** HTTP suggestions start at 3001, MCP at 3100, SSE at 3200; all skip every mock port in the project. */
export function suggestMockPort(kind: MockKind, takenPorts: Iterable<number>): number {
  return suggestPort(takenPorts, PORT_START[kind])
}

export interface CreateMockInput {
  kind: MockKind
  presetId: string
  projectId: string
  name: string
  port: number
}

/** Presets of the types that live in the HTTP mock table. */
function tablePreset(kind: Exclude<MockKind, 'mcp'>, presetId: string): HttpPreset {
  const id = presetOption(kind, presetId).id
  return kind === 'sse'
    ? buildSsePreset(id as MockSsePresetId)
    : buildHttpPreset(id as MockHttpPresetId)
}

/**
 * Create the server through its type's factory, refresh that type's list and
 * open the new server's editor tab. Returns the error message, or null.
 */
export async function createMockServer(input: CreateMockInput): Promise<string | null> {
  const { kind, presetId, projectId, name, port } = input
  if (kind !== 'mcp') {
    const r = await createFromHttpPreset(projectId, tablePreset(kind, presetId), name, port)
    if (!r.server) return r.error
    await useMockStore.getState().loadServers(projectId)
    openMockServerTab(r.server)
    return null
  }
  const id = presetOption('mcp', presetId).id as MockMcpPresetId
  const base = buildPresetInput(id, { projectId, takenNames: [], takenPorts: [] })
  const r = await useMockMcpStore.getState().createServer({ ...base, name, port })
  if (!r.server) return r.error
  openMockMcpServerTab(r.server)
  return null
}
