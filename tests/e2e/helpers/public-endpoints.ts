/**
 * Resolve public test endpoint URLs. Allows env overrides for self-hosted
 * mirrors when the public service is rate-limited or down.
 */

export const HTTPBIN = process.env.HTTPBIN_URL ?? 'https://httpbin.org'
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
