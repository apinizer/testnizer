/**
 * Naming / port helpers shared by the "New mock server" dialog for BOTH mock
 * kinds (HTTP and MCP, issue #140). One implementation, so a suggested port
 * never collides with a mock of the other kind in the same project.
 */

/** First port suggested for a new HTTP mock server. */
export const HTTP_MOCK_PORT_START = 3001
/** First port suggested for a new Mock MCP server. */
export const MCP_MOCK_PORT_START = 3100

/** A name not already taken in the list: "Echo MCP", "Echo MCP 2", … */
export function uniqueName(base: string, taken: Iterable<string>, sep = ' '): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  let n = 2
  while (set.has(`${base}${sep}${n}`)) n += 1
  return `${base}${sep}${n}`
}

/** First port from `from` upward that is not in `taken` (the ports of every mock in the project). */
export function suggestPort(taken: Iterable<number>, from = MCP_MOCK_PORT_START): number {
  const set = new Set(taken)
  let port = from
  while (set.has(port) && port < 65535) port += 1
  return port
}
