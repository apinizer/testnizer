/**
 * SOAP editor WS-Security — the `{{var}}` rule shared by Send and Run.
 *
 * Send resolves the config in the renderer with the active variables
 * (`soap.store.sendSoap`); Run resolves the saved `metadata.soap.wsSecurity`
 * in main with the run's variables (`runner.handler`). Both call THIS function
 * with their own resolver, so the two paths resolve exactly the same fields.
 * The resolved config then goes to the single main-side applier
 * (`src/main/lib/soap-wsse.ts`), after the envelope itself is resolved — the
 * signature is computed over the final bytes.
 *
 * Only the UsernameToken credentials (and the legacy single-mode copies) are
 * templated. Key material is never resolved here: it is either pasted PEM or
 * an opaque `keySource` that main resolves through the keystore bridge.
 */

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

function resolveString(v: unknown, resolve: (s: string) => string): unknown {
  return typeof v === 'string' && v ? resolve(v) : v
}

/**
 * A copy of `config` with `{{var}}` resolved in the UsernameToken username /
 * password and the legacy `username` / `password`. Non-objects come back
 * unchanged; nothing else in the config is touched.
 */
export function resolveWsSecurityVariables<T>(config: T, resolve: (s: string) => string): T {
  if (!isRecord(config)) return config
  const out: Json = { ...config }
  if (isRecord(config.usernameToken)) {
    out.usernameToken = {
      ...config.usernameToken,
      username: resolveString(config.usernameToken.username, resolve),
      password: resolveString(config.usernameToken.password, resolve),
    }
  }
  if ('username' in config) out.username = resolveString(config.username, resolve)
  if ('password' in config) out.password = resolveString(config.password, resolve)
  return out as T
}

/** Is WS-Security switched on in this (saved or live) config? */
export function isWsSecurityEnabled(config: unknown): boolean {
  return isRecord(config) && config.enabled === true
}
