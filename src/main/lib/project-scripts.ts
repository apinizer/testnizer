/**
 * Every script a project holds, found in its export (`exportProjectData`) so a
 * new table is seen here as soon as it is exported. Pure: no DB, no electron.
 *
 * The keys are the ones the runtimes READ:
 *  - cascade: `shared_settings` preScript / testScript, folders + suite folders
 *    pre_script / post_script (`collectCascadeScripts`);
 *  - request: endpoint + suite item `request_schema` preScript / postScript,
 *    saved request pre_script / post_script (`savedRequestToEndpoint`);
 *  - run hooks: suite `run_config` runPreScript / runPostScript / runFailScript;
 *  - mock: `mock_responses.script` (`mock/server.ts`).
 * JSON columns are walked to any depth, so a script key nested under `metadata`
 * (where protocol settings live) counts too.
 *
 * Whitespace and comments alone are no script (`scriptHasCode`).
 * `tests/main/project-script-trust.test.ts` fails when an exported table gains a
 * script column or a JSON column this file has not classified.
 */
import { createHash } from 'node:crypto'
import { scriptHasCode } from '../../shared/script/has-code'

/** Script columns that hold the text itself, per table. */
export const SCRIPT_TEXT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  folders: ['pre_script', 'post_script'],
  test_suite_folders: ['pre_script', 'post_script'],
  saved_requests: ['pre_script', 'post_script'],
  mock_responses: ['script'],
}

/** JSON columns that can hold a script, per table; walked for `SCRIPT_JSON_KEYS`. */
export const SCRIPT_JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  projects: ['shared_settings'],
  endpoints: ['request_schema'],
  saved_requests: ['metadata'],
  test_suites: ['run_config'],
  test_suite_items: ['request_schema'],
}

const SCRIPT_JSON_KEYS: ReadonlySet<string> = new Set([
  'preScript',
  'postScript',
  'testScript',
  'runPreScript',
  'runPostScript',
  'runFailScript',
])

type Row = Record<string, unknown>

/** The parts of a project export scripts can live in (`ProjectExport` fits). */
export interface ProjectScriptSource {
  project?: Row
  folders?: Row[]
  endpoints?: Row[]
  savedRequests?: Row[]
  testSuites?: Row[]
  testSuiteItems?: Row[]
  testSuiteFolders?: Row[]
  mockResponses?: Row[]
}

export interface ProjectScript {
  /** `<table>:<row id>:<column or JSON path>` — stable while the row is. */
  location: string
  source: string
}

function walkJson(value: unknown, path: string, out: ProjectScript[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkJson(v, `${path}[${i}]`, out))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [k, v] of Object.entries(value as Row)) {
    const at = `${path}.${k}`
    if (SCRIPT_JSON_KEYS.has(k) && scriptHasCode(v)) out.push({ location: at, source: v })
    else walkJson(v, at, out)
  }
}

function readTable(table: string, rows: Row[] | undefined, out: ProjectScript[]): void {
  for (const row of rows ?? []) {
    const id = String(row.id ?? '')
    for (const col of SCRIPT_TEXT_COLUMNS[table] ?? []) {
      const v = row[col]
      if (scriptHasCode(v)) out.push({ location: `${table}:${id}:${col}`, source: v })
    }
    for (const col of SCRIPT_JSON_COLUMNS[table] ?? []) {
      const raw = row[col]
      if (typeof raw !== 'string' || !raw) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue // Unparsable: no runtime can read a script out of it either.
      }
      walkJson(parsed, `${table}:${id}:${col}`, out)
    }
  }
}

export function collectProjectScripts(data: ProjectScriptSource): ProjectScript[] {
  const out: ProjectScript[] = []
  readTable('projects', data.project ? [data.project] : [], out)
  readTable('folders', data.folders, out)
  readTable('endpoints', data.endpoints, out)
  readTable('saved_requests', data.savedRequests, out)
  readTable('test_suites', data.testSuites, out)
  readTable('test_suite_folders', data.testSuiteFolders, out)
  readTable('test_suite_items', data.testSuiteItems, out)
  readTable('mock_responses', data.mockResponses, out)
  return out
}

/** One entry per script: where it is + what it says. Nothing readable about the body. */
export function scriptFingerprints(scripts: readonly ProjectScript[]): string[] {
  return scripts.map((s) => `${s.location}|${createHash('sha256').update(s.source).digest('hex')}`)
}
