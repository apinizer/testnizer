/**
 * What would a commit change? (issue #207)
 *
 * Pure: compares two parsed project files — the one at HEAD and the one a
 * commit would write (the DB export, stripped of secrets and JSON-round-
 * tripped by the caller) — ROW by row, and names each difference the way the
 * user knows it. No git, no DB.
 *
 * The normalisation is the SAME one `sameExport` uses for the switch / merge
 * no-op check (it lives here so the two cannot drift): the export timestamp,
 * the per-machine parts of the `project` header (id, workspace, local_path,
 * save_mode…), each row's `project_id` / `workspace_id` and row ORDER are not
 * content. So an empty change list means `git:commit` has nothing to commit,
 * and the Commit button can be disabled on it.
 */
import { canonical } from './project-merge'
import type { GitChangeItem, GitChangeKind } from '../../shared/git-changes'

type Row = Record<string, unknown>
type Doc = Record<string, unknown>

/** Fields the importer rewrites to the local project on every machine. */
const MACHINE_LOCAL_FIELDS = new Set(['project_id', 'workspace_id'])

/** The project header fields that travel with the file. */
const HEADER_FIELDS = ['name', 'display_name', 'description'] as const

function comparableRow(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const out: Row = {}
  for (const [k, v] of Object.entries(row as Row)) if (!MACHINE_LOCAL_FIELDS.has(k)) out[k] = v
  return out
}

function headerOf(doc: Doc): Row {
  const header = (doc.project ?? {}) as Row
  const out: Row = {}
  for (const f of HEADER_FIELDS) out[f] = header[f] ?? null
  return out
}

/**
 * Canonical text of a project file for equality: same content ⇔ same string.
 * Shared by `sameExport` (git.handler) and `diffProjectDocs` below.
 */
export function normaliseExportDoc(doc: Doc): string {
  const out: Doc = { ...doc, exportedAt: 0, project: headerOf(doc) }
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = v.map((row) => canonical(comparableRow(row))).sort()
  }
  return canonical(out)
}

/** Exported section → change kind. Parents before children (display order). */
const SECTION_KINDS: readonly (readonly [string, GitChangeKind])[] = [
  ['folders', 'folder'],
  ['endpoints', 'endpoint'],
  ['endpointCases', 'endpointCase'],
  ['savedRequests', 'savedRequest'],
  ['savedResponses', 'savedResponse'],
  ['environments', 'environment'],
  ['environmentVariables', 'variable'],
  ['globalVariables', 'globalVariable'],
  ['testSuites', 'testSuite'],
  ['testSuiteFolders', 'testSuiteFolder'],
  ['testSuiteItems', 'testSuiteItem'],
  ['mockServers', 'mockServer'],
  ['mockEndpoints', 'mockEndpoint'],
  ['mockResponses', 'mockResponse'],
  ['mockMcpServers', 'mockMcpServer'],
  ['certificates', 'certificate'],
]

function rowsOf(doc: Doc | null, section: string): Row[] {
  const v = doc?.[section]
  return Array.isArray(v)
    ? (v as unknown[]).filter((r): r is Row => !!r && typeof r === 'object')
    : []
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** Row identity: its `id`, or its whole content when a row has none. */
function keyOf(row: Row): string {
  return typeof row.id === 'string' ? `id:${row.id}` : `c:${canonical(comparableRow(row))}`
}

/** environment id → name, from both sides (a deleted variable's env may be gone live). */
function environmentNames(head: Doc | null, live: Doc): Map<string, string> {
  const m = new Map<string, string>()
  for (const doc of [head, live]) {
    for (const env of rowsOf(doc, 'environments')) {
      if (typeof env.id === 'string') m.set(env.id, text(env.name) || env.id)
    }
  }
  return m
}

function nameOf(kind: GitChangeKind, row: Row, envNames: Map<string, string>): string {
  const id = typeof row.id === 'string' ? row.id : ''
  switch (kind) {
    case 'variable': {
      const env = typeof row.environment_id === 'string' ? envNames.get(row.environment_id) : ''
      const key = text(row.key) || id
      return env ? `${env} › ${key}` : key
    }
    case 'globalVariable':
      return text(row.key) || id
    case 'mockEndpoint':
      return [text(row.method), text(row.path)].filter(Boolean).join(' ') || id
    case 'certificate':
      return text(row.name) || text(row.host) || id
    default:
      return text(row.name) || text(row.path) || text(row.url) || id
  }
}

/**
 * Rows a commit would add / modify / delete, in section order. `head` null =
 * HEAD has no project file yet: the project file itself is added (a commit
 * writes it even for an empty project), and so is every row.
 */
export function diffProjectDocs(head: Doc | null, live: Doc): GitChangeItem[] {
  const items: GitChangeItem[] = []
  const liveHeader = headerOf(live)
  const project = (live.project ?? {}) as Row
  const projectName = text(liveHeader.display_name) || text(liveHeader.name) || 'project'
  const projectId = typeof project.id === 'string' ? project.id : ''
  if (!head) {
    items.push({ kind: 'project', id: projectId, name: projectName, change: 'added' })
  } else if (canonical(headerOf(head)) !== canonical(liveHeader)) {
    items.push({ kind: 'project', id: projectId, name: projectName, change: 'modified' })
  }

  const envNames = environmentNames(head, live)
  for (const [section, kind] of SECTION_KINDS) {
    const before = new Map(rowsOf(head, section).map((r) => [keyOf(r), r]))
    const after = new Map(rowsOf(live, section).map((r) => [keyOf(r), r]))
    const out: GitChangeItem[] = []
    for (const [key, row] of after) {
      const old = before.get(key)
      const id = typeof row.id === 'string' ? row.id : key
      if (!old) out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'added' })
      else if (canonical(comparableRow(old)) !== canonical(comparableRow(row)))
        out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'modified' })
    }
    for (const [key, row] of before) {
      if (after.has(key)) continue
      const id = typeof row.id === 'string' ? row.id : key
      out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'deleted' })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    items.push(...out)
  }
  return items
}
