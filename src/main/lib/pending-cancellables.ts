/**
 * Shared registry for user-cancellable in-flight operations.
 *
 * Every protocol handler (HTTP, SOAP, GraphQL, gRPC unary, WS connect, SSE
 * connect, Socket.IO connect, MCP connect) historically maintained its own
 * `Map<id, AbortController>` for in-flight cancellation. This module
 * collapses that pattern into one registry parameterised by a free-form
 * "cancel handle" — anything callable returning void.
 *
 * Why not just AbortController everywhere? Some engines (the `ws` library,
 * grpc-js Call, Socket.IO Manager) don't accept an AbortSignal and need a
 * library-specific terminate / cancel / close call. The registry takes a
 * `cancel: () => void` so each protocol picks its own teardown.
 *
 * Concurrency: protocol handlers are single-threaded inside Node's event
 * loop, so a plain Map is sufficient. No locking.
 */

export interface PendingRegistry {
  /** Register a cancel handle for `id`. Overwrites any previous handle. */
  register(id: string, cancel: () => void): void
  /**
   * Invoke and remove the cancel handle for `id`. Returns true if a handle
   * was registered, false otherwise (already completed or never registered).
   * Cancel errors are swallowed — the caller has already moved on.
   */
  cancel(id: string): boolean
  /** Remove the handle for `id` without invoking it (call after success). */
  dispose(id: string): void
  /** Test-only — clear all handles. */
  _clear(): void
  /** Test-only — number of pending entries. */
  _size(): number
}

export function createPendingRegistry(): PendingRegistry {
  const handles = new Map<string, () => void>()
  return {
    register(id, cancel) {
      handles.set(id, cancel)
    },
    cancel(id) {
      const fn = handles.get(id)
      if (!fn) return false
      handles.delete(id)
      try {
        fn()
      } catch {
        // Swallow: the caller has moved on; cancel errors are not actionable.
      }
      return true
    },
    dispose(id) {
      handles.delete(id)
    },
    _clear() {
      handles.clear()
    },
    _size() {
      return handles.size
    },
  }
}
