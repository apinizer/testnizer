/**
 * The variable scopes one Send-path script sees (HTTP and MCP Send).
 *
 * `pm.environment`, `pm.globals` and `pm.variables` are separate scopes
 * (issue #281). The Send path used to seed `pm.environment` with
 * `getActiveVariables()` — globals AND environment merged — plus every write
 * of an earlier script of the cascade, `pm.variables.set` ones included, so
 * `pm.environment.get('aGlobal')` answered on Send. Run had the same merge in
 * its single variable map. Both now keep the scopes apart.
 */
import { useEnvironmentStore } from '../stores/environment.store'
import type { ScriptRunResult } from './test-runner'

/** Writes made by the earlier scripts of one send's cascade, per scope. */
export interface SendScriptWrites {
  env: Record<string, string>
  globals: Record<string, string>
  /** `pm.vault` writes (value = secret, null = deleted) — they also sit in `globals`. */
  vault: Record<string, string | null>
  locals: Record<string, string>
}

export function emptyScriptWrites(): SendScriptWrites {
  return { env: {}, globals: {}, vault: {}, locals: {} }
}

/** Current Value, falling back to Initial Value (environment.store `v()`). */
function effective(ev: { value?: string; initialValue?: string }): string {
  return ev.value && ev.value.length > 0 ? ev.value : ev.initialValue || ''
}

/**
 * The environment-only, project-variable (globals) and request-local stores for
 * the next script, plus the keys of the secret project variables (`pm.vault`).
 */
export function sendScriptScopes(writes: SendScriptWrites): {
  envMap: Map<string, string>
  globalMap: Map<string, string>
  localVars: Record<string, string>
  vaultKeys: Set<string>
} {
  const state = useEnvironmentStore.getState()
  const envMap = new Map<string, string>()
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
  for (const ev of env?.variables ?? []) {
    if (ev.enabled) envMap.set(ev.key, effective(ev))
  }
  for (const [k, v] of Object.entries(writes.env)) envMap.set(k, v)
  const globalMap = new Map<string, string>()
  const vaultKeys = new Set<string>()
  for (const gv of state.globalVariables || []) {
    if (!gv.enabled) continue
    globalMap.set(gv.key, effective(gv))
    if (gv.secret) vaultKeys.add(gv.key)
  }
  for (const [k, v] of Object.entries(writes.globals)) globalMap.set(k, v)
  for (const [k, v] of Object.entries(writes.vault)) {
    if (v === null) vaultKeys.delete(k)
    else vaultKeys.add(k)
  }
  return { envMap, globalMap, localVars: { ...writes.locals }, vaultKeys }
}

/**
 * True when the script wrote a SECRET value: a `pm.vault` write, or a write to
 * a variable whose row is secret in its scope — the active environment's for
 * `pm.environment.set`, the project variables' for `pm.globals.set` /
 * `pm.collectionVariables.set`.
 */
function writesSecret(r: ScriptRunResult): boolean {
  if (Object.keys(r.vaultUpdates).length > 0) return true
  const state = useEnvironmentStore.getState()
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
  const envSecret = new Set((env?.variables ?? []).filter((v) => v.secret).map((v) => v.key))
  if (Object.keys(r.envUpdates).some((k) => envSecret.has(k))) return true
  const globalSecret = new Set(
    (state.globalVariables || []).filter((v) => v.secret).map((v) => v.key),
  )
  return Object.keys(r.globalUpdates).some((k) => globalSecret.has(k))
}

/**
 * Persist one Send-path script's environment / project-variable / vault writes
 * (`environment.store.applyScriptUpdates`) — the one place the Send hosts
 * (HTTP and MCP) hand them over.
 *
 * Resolves at once, persisting in the background as before, EXCEPT when the
 * script wrote a secret value (`pm.vault`, issue #281, or any write to a
 * variable marked secret — security follow-up): then it resolves once the
 * value is in the DB, because History and the Console mask from the DB's
 * secrets — a token set by a pre-request script would otherwise reach History
 * in clear text before it was stored.
 */
export async function persistScriptWrites(r: ScriptRunResult): Promise<void> {
  if (
    Object.keys(r.vaultUpdates).length === 0 &&
    Object.keys(r.envUpdates).length === 0 &&
    Object.keys(r.globalUpdates).length === 0
  )
    return
  // Decided BEFORE applying: the store's optimistic update changes the rows.
  const secret = writesSecret(r)
  const done = useEnvironmentStore
    .getState()
    .applyScriptUpdates(r.envUpdates, r.globalUpdates, r.vaultUpdates)
  if (secret) await done
  else void done
}

/** Fold one script's writes into the cascade's per-scope record. */
export function absorbScriptWrites(writes: SendScriptWrites, r: ScriptRunResult): void {
  Object.assign(writes.env, r.envUpdates)
  Object.assign(writes.globals, r.globalUpdates)
  // A plain project-variable write after a vault one is the last word.
  for (const k of Object.keys(r.globalUpdates)) {
    if (!(k in r.vaultUpdates)) delete writes.vault[k]
  }
  Object.assign(writes.vault, r.vaultUpdates)
  // varUpdates is the script's whole local map (seeded from `writes.locals`).
  writes.locals = { ...r.varUpdates }
}
