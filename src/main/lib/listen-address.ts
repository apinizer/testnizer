/**
 * Binding a local mock listener — the ONE owner of two rules shared by the
 * HTTP mock (`mock/server.ts`) and the Mock MCP server (`mock-mcp/server.ts`):
 *
 *   1. The busy-port / no-permission text a failed `listen()` shows. Node's
 *      own ("listen EADDRINUSE: address already in use 127.0.0.1:3002") reads
 *      like a stack trace, and the two managers used to word it differently.
 *   2. `probeListen`: can this address be bound right now? A running server
 *      moved to a new port is tested here first, so a busy port is refused
 *      while the old listener is still up (tester finding 11 — the old
 *      listener used to be closed before the new `listen()` failed).
 *
 * The managers' own pre-bind check (another mock of the same manager on that
 * address) runs before this one and names the mock; this one covers whatever
 * that check cannot see: another application, the other mock manager.
 */

import net from 'node:net'

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', ''])

/**
 * Would listeners on `a` and `b` (same port) collide? Equal hosts do, and so
 * does a wildcard host with any other: Node binds with SO_REUSEADDR, so on
 * macOS `127.0.0.1:P` and `0.0.0.0:P` can BOTH be bound — no error at all,
 * and loopback traffic reaches only one of them. The managers' pre-bind check
 * uses this, because neither `listen()` nor `probeListen` would refuse.
 */
export function hostsOverlap(a: string, b: string): boolean {
  return a === b || WILDCARD_HOSTS.has(a) || WILDCARD_HOSTS.has(b)
}

/** Readable text for a failed `listen(port, host)`. */
export function listenErrorMessage(err: unknown, host: string, port: number): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'EADDRINUSE') {
    return (
      `Port ${port} is already in use on ${host}. Stop whatever is listening there ` +
      '(another mock server or app) or pick a different port.'
    )
  }
  if (code === 'EACCES') {
    return (
      `Permission denied binding ${host}:${port}. Ports below 1024 usually need elevated ` +
      'rights — pick a higher port.'
    )
  }
  if (code === 'EADDRNOTAVAIL') {
    return `Address ${host} is not available on this machine.`
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Bind `host:port` for a moment and release it. Resolves `null` when the
 * address is free, else the readable reason. Port 0 (any free port) is always
 * bindable. There is a short window between this probe and the real
 * `listen()`; callers still handle a failure there.
 */
export function probeListen(host: string, port: number): Promise<string | null> {
  if (port === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', (err) => resolve(listenErrorMessage(err, host, port)))
    try {
      probe.listen(port, host, () => probe.close(() => resolve(null)))
    } catch (err) {
      // `listen` throws synchronously on an out-of-range port / bad host.
      resolve(listenErrorMessage(err, host, port))
    }
  })
}
