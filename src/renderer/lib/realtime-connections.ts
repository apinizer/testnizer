import type { StoreApi } from 'zustand'
import { useWorkspaceStore } from '../stores/workspace.store'

/**
 * Live connections of the realtime editors — WebSocket, Socket.IO and MQTT
 * (issues #282 / #283 / #284) — have ONE lifetime rule, owned here:
 *
 *   1. Closing a tab closes its connection (or cancels its pending handshake).
 *   2. Leaving a project — another project, Home, a workspace switch, the
 *      project deleted — closes every connection opened in it.
 *
 * Why rule 2 rather than keeping hidden projects' connections alive: a hidden
 * project's tab set is only a snapshot (`workspace.store` `tabsByProject`).
 * Closing that project's header tab, deleting the project or switching
 * workspace drops the snapshot without closing the tabs, so their
 * connections stayed open in main with no tab left to disconnect them —
 * still receiving, still holding the server session, and (WebSocket) still
 * logging every frame into the NEXT project's Console. Closing on leave
 * makes all of those paths safe at once: a project that is not active never
 * holds a connection.
 */
export interface LiveSlice {
  connectionId: string | null
  _pendingConnectId?: string
  /** The project the connection was opened in (stamped at Connect). */
  _projectId?: string | null
  /** Push subscriptions of the slice's connection. */
  _unsubscribe?: () => void
}

/** The protocol's `window.api` part this module calls. */
export interface ConnectionApi {
  disconnect(connectionId: string): Promise<unknown>
  cancelConnect(pendingId: string): Promise<unknown>
}

/**
 * Close a slice's connection — or cancel its pending handshake — and drop its
 * push subscriptions. Fire-and-forget: the tab / project is going away either
 * way. The caller resets the slice's state.
 */
export function releaseConnection(
  slice: LiveSlice | undefined,
  api: ConnectionApi | undefined,
): void {
  if (!slice) return
  if (slice.connectionId) {
    void api?.disconnect(slice.connectionId).catch(() => {})
  } else if (slice._pendingConnectId) {
    void api?.cancelConnect(slice._pendingConnectId).catch(() => {})
  }
  slice._unsubscribe?.()
}

interface TabbedState<S> {
  _tabStates: Map<string, S>
  _currentTabId: string | null
}

export interface ProjectScope<S extends LiveSlice, T extends S & TabbedState<S>> {
  store: StoreApi<T>
  /** The live (current tab's) slice out of the store state. */
  extract: (s: T) => S
  api: () => ConnectionApi | undefined
  /**
   * The slice after its connection was closed by leaving its project:
   * disconnected, with the protocol's timeline row when it was connected.
   */
  closed: (slice: S, wasConnected: boolean) => S
}

/** Rule 2 for one store: close what was opened outside `projectId`. */
export function closeConnectionsOutsideProject<S extends LiveSlice, T extends S & TabbedState<S>>(
  scope: ProjectScope<S, T>,
  projectId: string | null,
): void {
  const s = scope.store.getState()
  const outside = (sl: S): boolean =>
    !!(sl.connectionId || sl._pendingConnectId) && (sl._projectId ?? null) !== projectId
  let changed = false
  const close = (sl: S): S => {
    if (!outside(sl)) return sl
    changed = true
    releaseConnection(sl, scope.api())
    return scope.closed(
      { ...sl, connectionId: null, _pendingConnectId: undefined, _unsubscribe: undefined },
      !!sl.connectionId,
    )
  }
  const map = new Map<string, S>()
  for (const [id, sl] of s._tabStates) {
    // The current tab's cached copy may be stale; its live slice is handled below.
    map.set(id, id === s._currentTabId ? sl : close(sl))
  }
  const current = close(scope.extract(s))
  if (!changed) return
  // Only slice fields and the slice cache are written; T is the store type.
  scope.store.setState({ ...current, _tabStates: map } as unknown as Partial<T>)
}

/** Apply rule 2 to `scope` whenever the active project changes. */
export function bindConnectionsToProject<S extends LiveSlice, T extends S & TabbedState<S>>(
  scope: ProjectScope<S, T>,
): void {
  useWorkspaceStore.subscribe((next, prev) => {
    if (next.activeProjectId !== prev.activeProjectId)
      closeConnectionsOutsideProject(scope, next.activeProjectId ?? null)
  })
}
