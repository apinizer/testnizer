/**
 * Logic behind the "New mock server" dialog (issue #140): the preset catalog
 * of both mock kinds, the name / port suggestions and the create action.
 * One flow for HTTP and MCP — only the factory at the end differs.
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
  type MockHttpPresetId,
} from './mock-http-presets'
import { HTTP_MOCK_PORT_START, MCP_MOCK_PORT_START, suggestPort } from './mock-create-helpers'
import { openMockServerTab } from './mock-http-tabs'

export type MockKind = 'http' | 'mcp'

export interface MockPresetOption {
  id: string
  labelKey: string
  hintKey: string
  defaultName: string
}

export const DEFAULT_PRESET: Record<MockKind, string> = { http: 'blank', mcp: 'echo' }

const HTTP_OPTIONS: MockPresetOption[] = MOCK_HTTP_PRESET_IDS.map((id) => ({
  id,
  labelKey: MOCK_HTTP_PRESET_LABEL_KEYS[id],
  hintKey: MOCK_HTTP_PRESET_HINT_KEYS[id],
  defaultName: MOCK_HTTP_PRESET_NAMES[id],
}))

const MCP_OPTIONS: MockPresetOption[] = MOCK_MCP_PRESET_IDS.map((id) => ({
  id,
  labelKey: MOCK_MCP_PRESET_LABEL_KEYS[id],
  hintKey: MOCK_MCP_PRESET_HINT_KEYS[id],
  defaultName: MOCK_MCP_PRESET_NAMES[id],
}))

export function presetOptions(kind: MockKind): MockPresetOption[] {
  return kind === 'http' ? HTTP_OPTIONS : MCP_OPTIONS
}

export function presetOption(kind: MockKind, presetId: string): MockPresetOption {
  const list = presetOptions(kind)
  return list.find((o) => o.id === presetId) ?? list[0]
}

/** HTTP suggestions start at 3001, MCP at 3100; both skip every mock port in the project. */
export function suggestMockPort(kind: MockKind, takenPorts: Iterable<number>): number {
  return suggestPort(takenPorts, kind === 'http' ? HTTP_MOCK_PORT_START : MCP_MOCK_PORT_START)
}

export interface CreateMockInput {
  kind: MockKind
  presetId: string
  projectId: string
  name: string
  port: number
}

/**
 * Create the server through its kind's factory, refresh that kind's list and
 * open the new server's editor tab. Returns the error message, or null.
 */
export async function createMockServer(input: CreateMockInput): Promise<string | null> {
  const { kind, presetId, projectId, name, port } = input
  if (kind === 'http') {
    const preset = buildHttpPreset(presetOption('http', presetId).id as MockHttpPresetId)
    const r = await createFromHttpPreset(projectId, preset, name, port)
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
