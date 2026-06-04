/**
 * Authentication gate for mock endpoints.
 *
 * Resolves the effective auth config (per-endpoint override > server default),
 * extracts credentials from the incoming request, and returns either `ok` or
 * a 401 response with an appropriate `WWW-Authenticate` challenge.
 *
 * Comparisons are timing-safe-ish (constant-time) for token / password matches
 * to avoid trivial timing oracles, though this is a local mock so the threat
 * model is light.
 */

import type { AuthConfig } from './types'

export interface AuthFailure {
  status: 401
  headers: Record<string, string>
  body: string
}

export interface AuthCheckInput {
  config: AuthConfig
  headers: Record<string, string>
  query: Record<string, string>
}

export type AuthCheckResult = { ok: true } | { ok: false; failure: AuthFailure }

export function checkAuth(input: AuthCheckInput): AuthCheckResult {
  const { config, headers, query } = input

  if (config.type === 'none') return { ok: true }

  if (config.type === 'bearer') {
    const auth = headers['authorization'] ?? ''
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
    const token = m ? m[1] : ''
    if (!token) return failure('Bearer realm="mock"', 'Missing bearer token')
    if (!config.tokens.some((t) => safeEqual(t, token))) {
      return failure('Bearer realm="mock", error="invalid_token"', 'Invalid bearer token')
    }
    return { ok: true }
  }

  if (config.type === 'basic') {
    const auth = headers['authorization'] ?? ''
    const m = /^Basic\s+(.+)$/i.exec(auth.trim())
    const b64 = m ? m[1] : ''
    if (!b64) return failure('Basic realm="mock"', 'Missing basic credentials')
    let decoded = ''
    try {
      decoded = Buffer.from(b64, 'base64').toString('utf8')
    } catch {
      return failure('Basic realm="mock"', 'Invalid base64 credentials')
    }
    const colonIdx = decoded.indexOf(':')
    if (colonIdx < 0) {
      return failure('Basic realm="mock"', 'Malformed basic credentials')
    }
    const u = decoded.slice(0, colonIdx)
    const p = decoded.slice(colonIdx + 1)
    const matched = config.users.some(
      (user) => safeEqual(user.username, u) && safeEqual(user.password, p),
    )
    if (!matched) return failure('Basic realm="mock"', 'Invalid basic credentials')
    return { ok: true }
  }

  if (config.type === 'apiKey') {
    const value =
      config.in === 'header'
        ? (headers[config.name.toLowerCase()] ?? '')
        : (query[config.name] ?? '')
    if (!value) return failure(`ApiKey name="${config.name}"`, 'Missing API key')
    if (!config.keys.some((k) => safeEqual(k, value))) {
      return failure(`ApiKey name="${config.name}"`, 'Invalid API key')
    }
    return { ok: true }
  }

  return { ok: true }
}

function failure(challenge: string, message: string): AuthCheckResult {
  return {
    ok: false,
    failure: {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': challenge,
      },
      body: JSON.stringify({ error: 'unauthorized', message }),
    },
  }
}

/** Constant-time string equality (avoids timing leaks for short tokens). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Resolve which auth config applies for a given endpoint:
 *  endpoint override (if non-null) > server default. */
export function resolveAuthConfig(
  serverAuth: AuthConfig,
  endpointOverride: AuthConfig | null,
): AuthConfig {
  return endpointOverride ?? serverAuth
}
