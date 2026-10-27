/**
 * Insomnia environments → project variables and project environments (issue
 * #281 follow-up, issue #289).
 *
 * Insomnia has two levels:
 *  - the collection's BASE environment (v4: the `environment` resource whose
 *    parent is the workspace; v5: the collection's `environments.data`). Its
 *    variables are what `insomnia.baseEnvironment` / `insomnia.collectionVariables`
 *    read — in Testnizer the project variables ("Globals"), the scope
 *    `pm.collectionVariables` reads. They go through the SAME writer as
 *    Postman collection variables (`writeProjectVariables`): a key the
 *    project already has keeps its local value and the report names it;
 *  - SUB-environments (v4: an `environment` resource whose parent is another
 *    environment; v5: `environments.subEnvironments[]`, which used to be
 *    dropped) — the switchable environments. They become project
 *    environments through the Postman environment writer
 *    (`upsertProjectEnvironment`: same name → its variables are replaced,
 *    secrets this machine holds are kept; a new one is activated only when
 *    the project has none active).
 *
 * With no environment selected, `insomnia.environment` is the base
 * environment too — Insomnia's own rule (`activeEnvironment ||
 * baseEnvironment`), applied in `src/shared/script/aliases.ts`.
 *
 * The base environment used to become an ordinary environment, so after the
 * collection-variables change an imported script's
 * `insomnia.baseEnvironment.get('x')` answered `undefined`. Projects imported
 * before are not migrated automatically: the environment's "Move to Globals"
 * action does it, and the report says so.
 */
import type { Database } from 'better-sqlite3'
import {
  upsertProjectEnvironment,
  writeProjectVariables,
  type SourcedVariable,
  type VariableRow,
} from './postman/environment'

/**
 * An Insomnia environment's `data` → rows. Accepts the object map (current
 * exports; a non-string value — Insomnia allows nested JSON — is stored as
 * JSON text) and the legacy `[{ name, value }]` array.
 */
export function insomniaEnvRows(data: unknown): VariableRow[] {
  const rows: VariableRow[] = []
  const push = (key: string, value: unknown): void => {
    if (!key) return
    const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
    rows.push({ key, value: text, description: null, enabled: true, secret: false })
  }
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry && typeof entry === 'object') {
        const e = entry as { name?: unknown; value?: unknown }
        if (typeof e.name === 'string') push(e.name, e.value ?? '')
      }
    }
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) push(k, v)
  }
  return rows
}

/**
 * Write a collection's base environment to the project variables. Returns the
 * number of variables added. Adds the report note that names "Move to Globals"
 * for projects imported before this change.
 */
export function writeInsomniaBaseEnvironment(
  projectId: string,
  workspaceId: string,
  name: string,
  data: unknown,
  warnings: string[],
): number {
  const where = `Insomnia base environment "${name}"`
  const vars: SourcedVariable[] = insomniaEnvRows(data).map((row) => ({ row, where }))
  if (vars.length === 0) return 0
  const { added } = writeProjectVariables(projectId, workspaceId, vars, where, warnings)
  warnings.push(
    `${where}: its variables are in the project's Globals, where insomnia.baseEnvironment ` +
      `and pm.collectionVariables read them — and insomnia.environment while no environment ` +
      `is selected, as in Insomnia (they are no longer imported as an environment). ` +
      `A project imported from Insomnia earlier still has its base environment as an ` +
      `environment: use "Move to Globals" in Environments to move it.`,
  )
  return added
}

/**
 * Write one Insomnia sub-environment as a project environment (same name →
 * its variables are replaced). Runs inside the caller's transaction, if any.
 */
export function writeInsomniaSubEnvironment(
  db: Database,
  projectId: string,
  workspaceId: string,
  name: string,
  data: unknown,
  warnings: string[],
  now: number,
): { id: string; name: string } {
  const rows = insomniaEnvRows(data)
  const res = upsertProjectEnvironment(db, projectId, workspaceId, name, rows, now)
  if (rows.length === 0) {
    warnings.push(`Insomnia environment "${name}" had no variables.`)
  } else if (!res.active && res.activeOtherName) {
    warnings.push(
      `Insomnia environment "${name}" was imported but "${res.activeOtherName}" is the active environment; ` +
        `select "${name}" to use its variables.`,
    )
  }
  return { id: res.environmentId, name }
}
