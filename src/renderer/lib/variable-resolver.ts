import { resolveTemplate } from '../../shared/dynamic-variables'
import type { AuthConfig, RequestBody } from '../types'

/**
 * Resolves {{variable}} placeholders in a template string.
 * Supports:
 *  - {{varName}} — from environment or global variables
 *  - {{$dynamicValue}} — built-in dynamic values like $guid, $timestamp, etc.
 *
 * The substitution loop and the dynamic-variable table are shared with Run and
 * Mock (`src/shared/dynamic-variables.ts`): chained references resolve up to
 * MAX_RESOLVE_DEPTH passes, circular ones stop at the cap, unknown variables
 * stay `{{name}}` and unknown dynamic variables stay exactly as written.
 */
export function resolveVariables(
  template: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): string {
  return resolveTemplate(template, (name) =>
    name in envVars ? envVars[name] : name in globalVars ? globalVars[name] : undefined,
  )
}

/**
 * Resolves variables in all string values of a key-value pair array.
 */
export function resolveKeyValuePairs(
  pairs: Array<{ key: string; value: string; enabled: boolean }>,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): Array<{ key: string; value: string; enabled: boolean }> {
  return pairs.map((pair) => ({
    ...pair,
    key: resolveVariables(pair.key, envVars, globalVars),
    value: resolveVariables(pair.value, envVars, globalVars),
  }))
}

/**
 * Resolve {{var}} in every substitutable field of a RequestBody:
 * `content` (raw/json/xml/text/etc.), `formData` rows, `urlEncoded` rows,
 * and `binaryPath` (so users can `{{fixturesDir}}/foo.bin`).
 * `formData` rows of `{ type: 'file', filePath }` get their `filePath` resolved
 * via the generic key-walker — KeyValuePair is structurally permissive enough.
 */
export function resolveRequestBody(
  body: RequestBody | undefined,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): RequestBody | undefined {
  if (!body) return body
  const r = (s: string | undefined) =>
    s === undefined ? s : resolveVariables(s, envVars, globalVars)
  const result: RequestBody = { ...body }
  if (body.content !== undefined) {
    result.content = r(body.content)
  }
  if (body.formData) {
    result.formData = body.formData.map((row) => {
      const next: typeof row = { ...row }
      if (typeof next.key === 'string') next.key = r(next.key) ?? ''
      if (typeof next.value === 'string') next.value = r(next.value) ?? ''
      const filePath = (next as { filePath?: string }).filePath
      if (typeof filePath === 'string') {
        ;(next as { filePath?: string }).filePath = r(filePath)
      }
      return next
    })
  }
  if (body.urlEncoded) {
    result.urlEncoded = body.urlEncoded.map((row) => ({
      ...row,
      key: r(row.key) ?? '',
      value: r(row.value) ?? '',
    }))
  }
  if (body.binaryPath !== undefined) {
    result.binaryPath = r(body.binaryPath)
  }
  return result
}

/**
 * Resolves {{var}} placeholders in every string field of an AuthConfig.
 * Returns a structurally equivalent AuthConfig with values substituted.
 * Used by every protocol store before invoking IPC.
 */
export function resolveAuth(
  auth: AuthConfig | undefined,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): AuthConfig | undefined {
  if (!auth) return auth
  const r = (s: string | undefined) =>
    s === undefined ? s : resolveVariables(s, envVars, globalVars)

  const resolved: AuthConfig = { type: auth.type }
  if (auth.basic) {
    resolved.basic = {
      username: r(auth.basic.username) ?? '',
      password: r(auth.basic.password) ?? '',
    }
  }
  if (auth.bearer) {
    resolved.bearer = { token: r(auth.bearer.token) ?? '', prefix: r(auth.bearer.prefix) }
  }
  if (auth.apiKey) {
    resolved.apiKey = {
      key: r(auth.apiKey.key) ?? '',
      value: r(auth.apiKey.value) ?? '',
      in: auth.apiKey.in,
    }
  }
  if (auth.oauth2) {
    resolved.oauth2 = {
      ...auth.oauth2,
      tokenUrl: r(auth.oauth2.tokenUrl) ?? '',
      authUrl: r(auth.oauth2.authUrl),
      clientId: r(auth.oauth2.clientId) ?? '',
      clientSecret: r(auth.oauth2.clientSecret),
      scope: r(auth.oauth2.scope),
      token: r(auth.oauth2.token),
      refreshToken: r(auth.oauth2.refreshToken),
      // Resource-owner creds (password grant) may also reference {{vars}}.
      username: r(auth.oauth2.username),
      password: r(auth.oauth2.password),
    }
  }
  if (auth.digest) {
    resolved.digest = {
      username: r(auth.digest.username) ?? '',
      password: r(auth.digest.password) ?? '',
    }
  }
  if (auth.ntlm) {
    resolved.ntlm = {
      username: r(auth.ntlm.username) ?? '',
      password: r(auth.ntlm.password) ?? '',
      domain: r(auth.ntlm.domain),
      workstation: r(auth.ntlm.workstation),
    }
  }
  if (auth.hawk) {
    resolved.hawk = {
      authId: r(auth.hawk.authId) ?? '',
      authKey: r(auth.hawk.authKey) ?? '',
      algorithm: auth.hawk.algorithm,
    }
  }
  if (auth.awsSignature) {
    resolved.awsSignature = {
      accessKey: r(auth.awsSignature.accessKey) ?? '',
      secretKey: r(auth.awsSignature.secretKey) ?? '',
      region: r(auth.awsSignature.region) ?? '',
      service: r(auth.awsSignature.service) ?? '',
    }
  }
  if (auth.wsse) {
    resolved.wsse = {
      username: r(auth.wsse.username) ?? '',
      password: r(auth.wsse.password) ?? '',
      passwordType: auth.wsse.passwordType,
      addTimestamp: auth.wsse.addTimestamp,
    }
  }
  return resolved
}
