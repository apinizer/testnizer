/**
 * Mock MCP editor: which list tabs hold unsaved changes, and which added items
 * are still untouched defaults (issue #210). Pure — no React, no IPC.
 *
 * The editor keeps ONE draft and ONE Save (product decision on #210); these
 * helpers only make the draft legible: a dot on the Tools / Resources /
 * Prompts tab whose section differs from the saved server, and a warning
 * before Save when an "Add" default was never filled in.
 *
 * Sections are compared in the shape Save sends (`draftToTool`,
 * `cleanResource`, `cleanPrompt`), not as raw drafts: drafts carry random
 * React keys (`toolToDraft` makes new ones on every call) and keep cleared
 * optional fields as `''`, neither of which is a change the user made.
 */
import type {
  MockMcpPrompt,
  MockMcpResource,
  MockMcpServer,
  MockMcpServerDraft,
  MockMcpToolDraft,
} from '../../types/mock-mcp'
import {
  blankPrompt,
  blankToolDraft,
  cleanPrompt,
  cleanResource,
  draftToTool,
  parseSchemaText,
} from './mock-mcp-draft'

export type MockMcpListSection = 'tools' | 'resources' | 'prompts'

export type MockMcpSectionDirty = Record<MockMcpListSection, boolean>

export const CLEAN_SECTIONS: MockMcpSectionDirty = {
  tools: false,
  resources: false,
  prompts: false,
}

/** JSON with object keys sorted, so key order never reads as a change. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** A tool as Save would send it; an unparseable schema stays raw text (always "changed"). */
function wireTool(d: MockMcpToolDraft): unknown {
  const parsed = parseSchemaText(d.schemaText)
  return parsed.schema ? draftToTool(d, parsed.schema) : { name: d.name, schemaText: d.schemaText }
}

function sameList<T>(a: readonly T[], b: readonly T[], norm: (x: T) => unknown): boolean {
  return a.length === b.length && stableStringify(a.map(norm)) === stableStringify(b.map(norm))
}

/** Which list sections of `draft` differ from `saved` (the server as stored). */
export function sectionDirty(
  draft: MockMcpServerDraft,
  saved: MockMcpServerDraft,
): MockMcpSectionDirty {
  return {
    tools: !sameList(draft.tools, saved.tools, wireTool),
    resources: !sameList(draft.resources, saved.resources, cleanResource),
    prompts: !sameList(draft.prompts, saved.prompts, cleanPrompt),
  }
}

export interface MockMcpBlankItem {
  kind: 'tool' | 'resource' | 'prompt'
  /** What the list shows for the item (tool / prompt name, resource URI). */
  label: string
}

const DEFAULT_TOOL_NAME = /^new_tool(_\d+)?$/
const DEFAULT_PROMPT_NAME = /^new_prompt(_\d+)?$/
const DEFAULT_RESOURCE_URI = /^mock:\/\/resource-\d+$/

function isBlankTool(d: MockMcpToolDraft): boolean {
  if (!DEFAULT_TOOL_NAME.test(d.name)) return false
  return stableStringify(wireTool(d)) === stableStringify(wireTool(blankToolDraft(d.name)))
}

function isBlankResource(r: MockMcpResource): boolean {
  const uri = r.uri ?? r.uriTemplate ?? ''
  return DEFAULT_RESOURCE_URI.test(uri) && !r.text && !r.blob
}

function isBlankPrompt(p: MockMcpPrompt): boolean {
  if (!DEFAULT_PROMPT_NAME.test(p.name)) return false
  return stableStringify(cleanPrompt(p)) === stableStringify(cleanPrompt(blankPrompt(p.name)))
}

/**
 * Items added in this draft that are still exactly what "Add" inserted. Items
 * already in the saved server are skipped: the user saved them once on
 * purpose ("Save anyway"), so later saves do not ask again.
 */
export function blankDefaultItems(
  draft: MockMcpServerDraft,
  saved: Pick<MockMcpServer, 'tools' | 'resources' | 'prompts'>,
): MockMcpBlankItem[] {
  const savedTools = new Set(saved.tools.map((x) => x.name))
  const savedPrompts = new Set(saved.prompts.map((x) => x.name))
  const savedUris = new Set(saved.resources.map((x) => x.uri ?? x.uriTemplate ?? ''))
  const out: MockMcpBlankItem[] = []
  for (const d of draft.tools) {
    if (!savedTools.has(d.name) && isBlankTool(d)) out.push({ kind: 'tool', label: d.name })
  }
  for (const r of draft.resources) {
    const uri = r.uri ?? r.uriTemplate ?? ''
    if (!savedUris.has(uri) && isBlankResource(r)) out.push({ kind: 'resource', label: uri })
  }
  for (const p of draft.prompts) {
    if (!savedPrompts.has(p.name) && isBlankPrompt(p)) out.push({ kind: 'prompt', label: p.name })
  }
  return out
}
