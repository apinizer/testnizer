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
  locals: Record<string, string>
}

export function emptyScriptWrites(): SendScriptWrites {
  return { env: {}, globals: {}, locals: {} }
}

/** Current Value, falling back to Initial Value (environment.store `v()`). */
function effective(ev: { value?: string; initialValue?: string }): string {
  return ev.value && ev.value.length > 0 ? ev.value : ev.initialValue || ''
}

/** The environment-only, globals-only and request-local stores for the next script. */
export function sendScriptScopes(writes: SendScriptWrites): {
  envMap: Map<string, string>
  globalMap: Map<string, string>
  localVars: Record<string, string>
} {
  const state = useEnvironmentStore.getState()
  const envMap = new Map<string, string>()
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
  for (const ev of env?.variables ?? []) {
    if (ev.enabled) envMap.set(ev.key, effective(ev))
  }
  for (const [k, v] of Object.entries(writes.env)) envMap.set(k, v)
  const globalMap = new Map<string, string>()
  for (const gv of state.globalVariables || []) {
    if (gv.enabled) globalMap.set(gv.key, effective(gv))
  }
  for (const [k, v] of Object.entries(writes.globals)) globalMap.set(k, v)
  return { envMap, globalMap, localVars: { ...writes.locals } }
}

/** Fold one script's writes into the cascade's per-scope record. */
export function absorbScriptWrites(writes: SendScriptWrites, r: ScriptRunResult): void {
  Object.assign(writes.env, r.envUpdates)
  Object.assign(writes.globals, r.globalUpdates)
  // varUpdates is the script's whole local map (seeded from `writes.locals`).
  writes.locals = { ...r.varUpdates }
}
