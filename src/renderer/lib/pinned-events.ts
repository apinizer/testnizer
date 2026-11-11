/**
 * An engine event listener pinned to ONE connection (or stream) id.
 *
 * Main broadcasts every connection's events on one IPC channel per protocol
 * (`ws:event`, `sse:event`, `grpc:streamEvent`); each tab subscribes and must
 * keep only its own. The old filter read the expected id from the tab's live
 * slice and let everything through while that id was empty:
 *
 *   if (expected && evt.connectionId !== expected) return
 *
 * The id is empty while the connect is in flight and again after the server
 * closes the connection, so a closed tab took every later connection's events
 * (tester finding 13: tab A's log filled with tab B's messages).
 *
 * The rule here: the id is captured once (`pin`, when connect / start answers)
 * and never read back from the slice. Until then events wait, in arrival
 * order; `pin` delivers only those with that id. An event without the id, or
 * with another one, is never delivered. Reconnects keep the id (the engines
 * reuse it), so they keep working. Pure (no store or DOM imports), like
 * `tab-slice.ts`. Socket.IO and MQTT hand-roll the same rule in their stores.
 */

/** Events held before the id is known; past this the oldest are dropped. */
export const PINNED_EARLY_LIMIT = 1000

export interface PinnedEvents<E> {
  /** The channel handler: hold (unpinned) or deliver (own id) or ignore. */
  receive: (evt: E) => void
  /** Fix the id and deliver the held events that carry it, in order. */
  pin: (id: string) => void
  /** Nothing is delivered any more; held events are discarded. */
  drop: () => void
  /** The pinned id, `null` before `pin`. */
  readonly id: string | null
}

export function pinnedEvents<E>(
  idOf: (evt: E) => unknown,
  deliver: (evt: E) => void,
): PinnedEvents<E> {
  let pinned: string | null = null
  let dropped = false
  let early: E[] = []
  return {
    receive(evt) {
      if (dropped) return
      if (pinned === null) {
        early.push(evt)
        if (early.length > PINNED_EARLY_LIMIT) early.shift()
        return
      }
      if (idOf(evt) === pinned) deliver(evt)
    },
    pin(id) {
      if (dropped || pinned !== null) return
      pinned = id
      const held = early
      early = []
      for (const evt of held) {
        // A held terminal event may drop the listener mid-drain.
        if (dropped) return
        if (idOf(evt) === id) deliver(evt)
      }
    },
    drop() {
      dropped = true
      early = []
    },
    get id() {
      return pinned
    },
  }
}
