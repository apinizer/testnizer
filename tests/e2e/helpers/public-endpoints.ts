/**
 * Resolve test endpoint URLs.
 * Prefers local echo server (E2E_HTTP_BASE / globalSetup) for offline E2E.
 * Falls back to httpbin.org when no local server is configured.
 */

function resolveHttpBin(): string {
  if (process.env.E2E_HTTP_BASE) return process.env.E2E_HTTP_BASE
  if (process.env.HTTPBIN_URL) return process.env.HTTPBIN_URL
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    const state = path.join(__dirname, '../servers/.test-servers.json')
    if (fs.existsSync(state)) {
      const raw = JSON.parse(fs.readFileSync(state, 'utf8')) as { urls?: { http?: string } }
      if (raw.urls?.http) return raw.urls.http
    }
  } catch {
    // ignore — use public fallback
  }
  return 'https://httpbin.org'
}

export const HTTPBIN = resolveHttpBin()
export const BADSSL = process.env.BADSSL_BASE ?? 'https://badssl.com'

/** badssl.com sub-host helpers */
export const BADSSL_HOSTS = {
  expired: 'https://expired.badssl.com',
  wrongHost: 'https://wrong.host.badssl.com',
  selfSigned: 'https://self-signed.badssl.com',
  untrustedRoot: 'https://untrusted-root.badssl.com',
  revoked: 'https://revoked.badssl.com',
  tls12: 'https://tls-v1-2.badssl.com:1012',
  tls13: 'https://tls-v1-3.badssl.com:1013',
  client: 'https://client.badssl.com',
}

/** Quick reachability check — used by tests to skip when offline. */
export async function isReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    clearTimeout(t)
    return res.ok || res.status < 500
  } catch {
    return false
  }
}
