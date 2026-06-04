/**
 * In-memory state store for mock servers. Each server gets its own object
 * shared across all of its endpoints; scripts and templates can read/write
 * arbitrary keys to simulate stateful APIs (POST /users → state.users[id] = ...,
 * then GET /users/:id → state.users[id]).
 *
 * State is reset whenever a server stops or starts; persistence-to-disk is a
 * future tour-3 follow-up.
 */

const states = new Map<string, Record<string, unknown>>()

/** Get (or initialise) the state object for a server. The returned reference
 *  is shared — callers can mutate it directly. */
export function getState(serverId: string): Record<string, unknown> {
  let s = states.get(serverId)
  if (!s) {
    s = {}
    states.set(serverId, s)
  }
  return s
}

/** Drop a server's state — typically called on stop. */
export function clearState(serverId: string): void {
  states.delete(serverId)
}

/** Drop all state — used by tests and on app shutdown. */
export function clearAllState(): void {
  states.clear()
}
