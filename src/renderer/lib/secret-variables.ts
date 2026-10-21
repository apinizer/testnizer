/**
 * Secret variables in generated code (canary scan, release 1.6.0).
 *
 * "Generate Code" and MCP "Copy as cURL / JSON-RPC" resolve `{{var}}` so the
 * snippet runs as is. A `secret` env / global variable is the exception: its
 * value is NOT substituted by default — the snippet keeps the `{{name}}`
 * placeholder (what a Postman user expects) — so a command pasted into a chat,
 * a ticket or a shell history does not carry the credential. The user can opt
 * in ("Include secret values") for a ready-to-run command. Non-secret
 * variables resolve as before.
 */
import type { Environment, GlobalVariable } from '../types'

interface VariableSources {
  globalVariables: Pick<GlobalVariable, 'key' | 'enabled' | 'secret'>[]
  environments: Pick<Environment, 'id' | 'variables'>[]
  activeEnvironmentId: string | null
}

/**
 * Names whose ACTIVE value is secret — the same precedence as
 * `getActiveVariables` (enabled globals first, the active environment wins).
 * A non-secret env variable overriding a secret global is not secret, and a
 * secret env variable overriding a plain global is.
 */
export function activeSecretVariableNames(s: VariableSources): Set<string> {
  const secret = new Map<string, boolean>()
  for (const gv of s.globalVariables) {
    if (gv.enabled) secret.set(gv.key, !!gv.secret)
  }
  const env = s.environments.find((e) => e.id === s.activeEnvironmentId)
  for (const ev of env?.variables ?? []) {
    if (ev.enabled) secret.set(ev.key, !!ev.secret)
  }
  return new Set([...secret].filter(([, isSecret]) => isSecret).map(([key]) => key))
}

/**
 * The variable map a snippet resolves with: secret names removed unless the
 * user opted in. A removed name is left as `{{name}}` by `resolveVariables`,
 * also when a plain variable's value refers to it.
 */
export function snippetVariables(
  vars: Record<string, string>,
  secretNames: ReadonlySet<string>,
  includeSecrets: boolean,
): Record<string, string> {
  if (includeSecrets || secretNames.size === 0) return vars
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (!secretNames.has(key)) out[key] = value
  }
  return out
}

/** `{{name}}` placeholders in `text`, trimmed and de-duplicated, in order. */
export function placeholdersIn(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) names.add(m[1])
  return [...names]
}
