/**
 * Postman v3 export (issue #277): a project or a test suite as
 *  - one v3 JSON file (the monolith the public JSON Schema validates), or
 *  - a Native Git folder (`folder-writer.ts`).
 *
 * Secrets: variable rows and the project's shared settings go through
 * `stripLocalSecrets` — the same filter as the project file and git (issue
 * #177): values of `secret` variables become '', and any `enc:v1:`
 * ciphertext left in a non-secret row is blanked too (issue #239); project
 * auth keeps only `{{variable}}` references.
 */
import { getDb } from '../../db/database'
import { stripLocalSecrets } from '../../lib/local-secrets'
import { projectAuthToAuthConfig } from '../../lib/auth-inheritance'
import type { StoredProjectAuth } from '../../lib/project-settings'
import type { ExportSkippedItem } from '../../../shared/collection-export'
import { buildV3Document } from './build'
import { loadExamples, loadProjectTree, loadSuiteTree, parseJson, type Json } from './rows'
import type { V3EnvironmentOut, V3FolderBundle } from './folder-writer'

export interface V3ExportResult {
  collection: Json
  environments: V3EnvironmentOut[]
  globals: V3EnvironmentOut | null
  skipped: ExportSkippedItem[]
  notes: string[]
  name: string
}

type Row = Record<string, unknown>

const flag = (v: unknown): boolean => v === 1 || v === true || v === '1'

/** Project shared settings (auth + scripts), secrets stripped. */
function projectCollectionSettings(projectId: string): {
  auth: unknown
  scripts: { preScript?: string; testScript?: string }
} {
  const db = getDb()
  const row = db.prepare('SELECT id, shared_settings FROM projects WHERE id = ?').get(projectId) as
    | Row
    | undefined
  if (!row) return { auth: null, scripts: {} }
  const stripped = stripLocalSecrets({ project: row }).project as Row
  const settings = parseJson<Row>(stripped?.shared_settings, {})
  const pick = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v : undefined
  return {
    auth: projectAuthToAuthConfig(settings.auth as StoredProjectAuth | undefined),
    scripts: { preScript: pick(settings.preScript), testScript: pick(settings.testScript) },
  }
}

/** Every environment of the project (+ project globals), secrets stripped. */
function projectVariables(projectId: string): {
  environments: Array<V3EnvironmentOut & { active: boolean }>
  globals: V3EnvironmentOut | null
} {
  const db = getDb()
  const envs = db
    .prepare(
      'SELECT id, name, is_active FROM environments WHERE project_id = ? ORDER BY created_at ASC',
    )
    .all(projectId) as Array<{ id: string; name: string; is_active: number }>
  const vars = envs.length
    ? (db
        .prepare(
          `SELECT * FROM environment_variables WHERE environment_id IN (${envs.map(() => '?').join(',')}) ORDER BY rowid ASC`,
        )
        .all(...envs.map((e) => e.id)) as Row[])
    : []
  const globals = db
    .prepare('SELECT * FROM global_variables WHERE project_id = ? ORDER BY rowid ASC')
    .all(projectId) as Row[]
  const stripped = stripLocalSecrets({ environmentVariables: vars, globalVariables: globals })
  const toValues = (list: Row[]): V3EnvironmentOut['values'] =>
    list.map((v) => ({
      key: String(v.key ?? ''),
      // The value Send uses: current value, else the initial value.
      value: String((v.value as string) || (v.initial_value as string) || ''),
      enabled: v.enabled === undefined ? true : flag(v.enabled),
      secret: flag(v.secret),
    }))
  return {
    environments: envs.map((e) => ({
      name: e.name,
      active: e.is_active === 1,
      values: toValues(
        (stripped.environmentVariables ?? []).filter((v) => v.environment_id === e.id),
      ),
    })),
    globals:
      (stripped.globalVariables ?? []).length > 0
        ? { name: 'Globals', values: toValues(stripped.globalVariables ?? []) }
        : null,
  }
}

/** The variables a single v3 JSON carries: the active environment (else the first), like the v2.1 export. */
function collectionVariables(
  envs: Array<V3EnvironmentOut & { active: boolean }>,
): V3EnvironmentOut['values'] | undefined {
  const env = envs.find((e) => e.active) ?? envs[0]
  return env && env.values.length > 0 ? env.values : undefined
}

export function buildPostmanV3ProjectExport(projectId: string): V3ExportResult {
  const db = getDb()
  const tree = loadProjectTree(db, projectId)
  const settings = projectCollectionSettings(projectId)
  const vars = projectVariables(projectId)
  const { doc, skipped, notes } = buildV3Document(tree, {
    examplesOf: (r) => loadExamples(db, r.ownerType, r.id),
    collectionAuth: settings.auth,
    collectionScripts: settings.scripts,
    variables: collectionVariables(vars.environments),
  })
  return {
    collection: doc,
    environments: vars.environments.map(({ name, values }) => ({ name, values })),
    globals: vars.globals,
    skipped,
    notes,
    name: tree.name,
  }
}

export function buildPostmanV3SuiteExport(suiteId: string): V3ExportResult {
  const db = getDb()
  const tree = loadSuiteTree(db, suiteId)
  const settings = projectCollectionSettings(tree.projectId)
  const vars = projectVariables(tree.projectId)
  const { doc, skipped, notes } = buildV3Document(tree, {
    examplesOf: (r) => loadExamples(db, r.ownerType, r.id),
    // A suite Run cascades its project's scripts (not the project auth — a
    // suite item stores its own).
    collectionScripts: settings.scripts,
    variables: collectionVariables(vars.environments),
  })
  return {
    collection: doc,
    environments: vars.environments.map(({ name, values }) => ({ name, values })),
    globals: vars.globals,
    skipped,
    notes,
    name: tree.name,
  }
}

/** The single-file form: the collection only, environments as collection variables. */
export function v3JsonText(r: V3ExportResult): string {
  return JSON.stringify(r.collection, null, 2)
}

/**
 * The folder form: environments go to `*.environment.yaml` files, so the
 * collection carries no variables (re-importing would otherwise create the
 * active environment twice).
 */
export function v3FolderBundle(r: V3ExportResult): V3FolderBundle {
  const { variables: _v, ...collection } = r.collection
  void _v
  return { rootName: r.name, collection, environments: r.environments, globals: r.globals }
}

export { writeV3Folder } from './folder-writer'
