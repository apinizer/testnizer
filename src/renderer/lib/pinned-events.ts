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
 *
 * Held events, before `pin` (review P2 of the first cut, which trimmed one
 * shared queue at 1000 events of any kind and any id — `open` + 1000 messages
 * lost the `open` and the tab stayed on Connecting):
 * - they wait per id, so another connection's traffic never pushes this
 *   connection's events out (the id is unknown until `pin`, but each event
 *   carries its own: one bucket per id is the plainest exact split);
 * - control events (`isControl`: open / close / error / end …) are never
 *   dropped; only data events count against `limit`, per id;
 * - past the limit the oldest data events go, and `onDropped(count)` fires
 *   during the drain where they were — a drop is never silent.
 * Events without an id are never deliverable and are not held at all.
 */

/** Data events held per connection before the id is known. */
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

export interface PinnedEventsOptions<E> {
  /** Lifecycle events (never dropped). Without it every event counts as data. */
  isControl?: (evt: E) => boolean
  /** Data events dropped before `pin`, reported once during the drain. */
  onDropped?: (count: number) => void
  /** Data events held per id (default `PINNED_EARLY_LIMIT`). */
  limit?: number
}

/** Where the dropped data events were, in a bucket. */
const DROPPED = Symbol('dropped')

interface Bucket<E> {
  items: Array<E | typeof DROPPED>
  data: number
  dropped: number
}

export function pinnedEvents<E>(
  idOf: (evt: E) => unknown,
  deliver: (evt: E) => void,
  options: PinnedEventsOptions<E> = {},
): PinnedEvents<E> {
  const isControl = options.isControl ?? (() => false)
  const limit = options.limit ?? PINNED_EARLY_LIMIT
  let pinned: string | null = null
  let dropped = false
  let held = new Map<unknown, Bucket<E>>()

  const hold = (key: unknown, evt: E): void => {
    let bucket = held.get(key)
    if (!bucket) {
      bucket = { items: [], data: 0, dropped: 0 }
      held.set(key, bucket)
    }
    bucket.items.push(evt)
    if (isControl(evt)) return
    bucket.data += 1
    if (bucket.data <= limit) return
    // The oldest data event goes; the marker moves to its place, which is
    // just before the oldest data event still held.
    const items = bucket.items
    const marker = items.indexOf(DROPPED)
    if (marker >= 0) items.splice(marker, 1)
    const oldest = items.findIndex((it) => it !== DROPPED && !isControl(it))
    items[oldest] = DROPPED
    bucket.data -= 1
    bucket.dropped += 1
  }

  return {
    receive(evt) {
      if (dropped) return
      const key = idOf(evt)
      if (key === undefined || key === null || key === '') return
      if (pinned === null) hold(key, evt)
      else if (key === pinned) deliver(evt)
    },
    pin(id) {
      if (dropped || pinned !== null) return
      pinned = id
      const bucket = held.get(id)
      held = new Map()
      if (!bucket) return
      for (const item of bucket.items) {
        // A held terminal event may drop the listener mid-drain.
        if (dropped) return
        if (item === DROPPED) options.onDropped?.(bucket.dropped)
        else deliver(item)
      }
    },
    drop() {
      dropped = true
      held = new Map()
    },
    get id() {
      return pinned
    },
  }
}
