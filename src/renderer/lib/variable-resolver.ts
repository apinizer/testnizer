import { resolveDynamicValue } from './dynamic-values'
import type { AuthConfig } from '../types'

/**
 * Resolves {{variable}} placeholders in a template string.
 * Supports:
 *  - {{varName}} — from environment or global variables
 *  - {{$dynamicValue}} — built-in dynamic values like $randomInt, $timestamp, etc.
 */
export function resolveVariables(
  template: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {}
): string {
  if (!template) return template

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expression: string) => {
    const trimmed = expression.trim()

    // Dynamic values start with $
    if (trimmed.startsWith('$')) {
      return resolveDynamicValue(trimmed)
    }

    // Check environment variables first, then globals
    if (trimmed in envVars) {
      return envVars[trimmed]
    }

    if (trimmed in globalVars) {
      return globalVars[trimmed]
    }

    // Return original if not found
    return `{{${trimmed}}}`
  })
}

/**
 * Resolves variables in all string values of a key-value pair array.
 */
export function resolveKeyValuePairs(
  pairs: Array<{ key: string; value: string; enabled: boolean }>,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {}
): Array<{ key: string; value: string; enabled: boolean }> {
  return pairs.map((pair) => ({
    ...pair,
    key: resolveVariables(pair.key, envVars, globalVars),
    value: resolveVariables(pair.value, envVars, globalVars),
  }))
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
    resolved.basic = { username: r(auth.basic.username) ?? '', password: r(auth.basic.password) ?? '' }
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
    }
  }
  if (auth.digest) {
    resolved.digest = { username: r(auth.digest.username) ?? '', password: r(auth.digest.password) ?? '' }
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
