/**
 * Is a Mock MCP server reachable from other machines with no auth at all?
 * (issue #154 D)
 *
 * Pure and import-free on purpose: shared by the main process (the running
 * server's start-time log warning; `src/main/mock-mcp/config.ts` re-exports
 * it) and the renderer's editor warning, which cannot import `config.ts`
 * (it pulls the MCP SDK + ajv).
 */

/**
 * Loopback = only this machine can connect: `localhost`, `::1` (also the
 * long `0:0:0:0:0:0:0:1` form), any `127.0.0.0/8` address and its
 * IPv4-mapped IPv6 form (`::ffff:127.x.y.z`). Brackets, case and
 * surrounding whitespace are ignored. Wildcards (`0.0.0.0`, `::`) and
 * LAN / public addresses are NOT loopback.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  let h = (host ?? '').trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h.endsWith('.')) h = h.slice(0, -1) // `localhost.` (FQDN form)
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  const v4 = h.startsWith('::ffff:') ? h.slice('::ffff:'.length) : h
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
  return !!m && m.slice(1).every((o) => Number(o) <= 255)
}

/**
 * True when the server binds a non-loopback address (`0.0.0.0`, `::`, a LAN
 * IP, a hostname) AND auth mode is `none` — anyone on the network can call
 * its tools. The UI shows a warning; the server logs one when it starts.
 */
export function isExposedWithoutAuth(cfg: {
  host: string | null | undefined
  authMode: string | null | undefined
}): boolean {
  return !isLoopbackHost(cfg.host) && (cfg.authMode ?? 'none') === 'none'
}
