/**
 * Environment / globals export in the Postman format (issues #15, #277) —
 * shared by the Environments modal's export button. Pure: no store / DOM.
 */
import type { Environment, EnvironmentVariable, GlobalVariable } from '../types'
/**
 * The Postman export of an environment (`env` set) or of the project globals
 * (`env` null). Values marked secret stay on this computer (issue #177): the
 * file keeps the key and the `secret` type, never the value. The CONTENT is
 * Postman-schema (round-trips through the Postman importers, which key off
 * `_postman_variable_scope`); only the default file name is Testnizer-native
 * (issue #7). `_postman_exported_at` added with issue #277.
 */
export function buildVariablesExport(
  env: Environment | null | undefined,
  globals: GlobalVariable[],
  now: Date = new Date(),
): { doc: Record<string, unknown>; fileName: string } | null {
  const values = (rows: Array<EnvironmentVariable | GlobalVariable>) =>
    rows.map((v) => ({
      key: v.key,
      value: v.secret ? '' : v.value || v.initialValue || '',
      enabled: v.enabled,
      type: v.secret ? 'secret' : 'default',
    }))
  if (env) {
    return {
      doc: {
        id: env.id,
        name: env.name,
        values: values(env.variables),
        _postman_variable_scope: 'environment',
        _postman_exported_at: now.toISOString(),
        _postman_exported_using: 'Testnizer',
      },
      fileName: `${env.name || 'environment'}.testnizer_environment.json`,
    }
  }
  if (env === null) {
    return {
      doc: {
        name: 'Globals',
        values: values(globals),
        _postman_variable_scope: 'globals',
        _postman_exported_at: now.toISOString(),
        _postman_exported_using: 'Testnizer',
      },
      fileName: 'globals.testnizer_globals.json',
    }
  }
  return null
}
