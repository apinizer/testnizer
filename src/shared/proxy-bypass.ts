/**
 * The "Bypass for hosts" list of a proxy setting: a target on it goes out directly.
 * One rule for HTTP Send, Run and the realtime connections.
 *
 * Entries are separated by commas, semicolons or spaces; case does not matter.
 * `*` is everything, `host` is that host, `*.x` and `.x` are its subdomains, and
 * `host:port` limits an entry to that port. No CIDR.
 */
const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'mqtt:': '1883',
  'tcp:': '1883',
  'mqtts:': '8883',
  'ssl:': '8883',
  'tls:': '8883',
}

function entryMatches(entry: string, host: string, port: string): boolean {
  if (entry === '*') return true
  const portMatch = /^(.*):(\d+)$/.exec(entry)
  // `::1` ends in `:1` but is a host: an IPv6 entry takes its port only in brackets.
  const hasPort = !!portMatch && (!portMatch[1].includes(':') || portMatch[1].endsWith(']'))
  if (hasPort && portMatch[2] !== port) return false
  const name = (hasPort ? portMatch[1] : entry).replace(/^\[|\]$/g, '')
  if (name.startsWith('*.') || name.startsWith('.')) {
    return host.endsWith(name.startsWith('*') ? name.slice(1) : name)
  }
  return host === name
}

/**
 * A saved SOCKS proxy. The type was offered before anything implemented it, and the
 * connection then spoke HTTP to a SOCKS port. Never fall back to going out directly:
 * someone behind a proxy would leave their network without knowing.
 */
export const SOCKS_PROXY_UNSUPPORTED =
  'SOCKS proxies are not supported yet. Choose an HTTP proxy in the proxy settings.'

export function isSocksProxy(
  setting: { mode?: string; proxyType?: string } | null | undefined,
): boolean {
  return setting?.mode === 'custom' && setting.proxyType === 'socks'
}

export function isProxyBypassed(bypass: string | undefined, targetUrl: string): boolean {
  if (!bypass?.trim()) return false
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = target.port || DEFAULT_PORTS[target.protocol] || ''
  return bypass
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .some((entry) => entryMatches(entry, host, port))
}
