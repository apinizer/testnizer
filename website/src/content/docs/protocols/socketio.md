---
title: Socket.IO
description: Connect to Socket.IO servers, emit events with JSON payloads, subscribe to event names, and watch the bidirectional timeline.
order: 8
section: Protocols
---

Testnizer ships an embedded Socket.IO client backed by the official
`socket.io-client` library running in the Node main process. The renderer
receives events over IPC and never holds an open socket itself.

## When to use this

Socket.IO is **not** plain WebSocket. It runs its own protocol on top of
WebSocket (with an HTTP long-polling fallback) and adds named events,
namespaces, acknowledgements, and automatic reconnection. If your server uses
`socket.io` on the backend, the **WebSocket** editor will not work — use this
one.

## Opening a Socket.IO tab

Click **+ New** → **Socket.IO**. The editor opens with a connection bar at the
top, an emit / subscribe panel on the left, and an event timeline on the right.

## Connecting

| Field | Required | Notes |
|---|---|---|
| **URL** | yes | The server origin, e.g. `http://localhost:3000` or `https://api.example.com` |
| **Namespace** | no | Defaults to `/`. Set to `/admin`, `/chat`, etc. for namespaced servers |
| **Bearer token** | no | Sent inside the `auth` payload during the handshake (`auth: { token: '...' }`) |

Click **Connect**. Testnizer:

1. Establishes the Socket.IO connection (preferred transport: WebSocket, with
   HTTP polling as a fallback).
2. Waits up to 10 seconds for the server to ack the connection.
3. On `connect`, the status changes to **Connected** and the emit / subscribe
   panel becomes active.
4. On `connect_error`, the status changes to **Error** and the message from the
   server is shown beside the Connect button.

Auto-reconnection is **disabled** by default — testing tools should make
connection failures visible, not paper over them. Click **Connect** again
manually if the socket drops.

## Emitting events

The **Emit Event** panel takes:

- **Event name** — any string, e.g. `chat:message` or `subscribe`
- **Payload** — JSON; parsed and sent as the event data. If parsing fails,
  the raw string is sent as-is.

Click **Emit**. The event appears in the timeline immediately as an outgoing
event (`↑`). Variables (`{{userId}}`, `{{token}}`) resolve in both the event
name and the payload.

## Subscribing to events

Testnizer **captures every event** the server emits the moment the connection
opens — you do not need to subscribe before incoming events appear. The
**Subscribe** field is a **UI filter** on top of that captured stream:

- With no subscriptions, every received event streams into the timeline as
  an incoming event (`↓`).
- Type an event name into the **Subscribe** input and press Enter (or click
  `+`). Once at least one subscription is active, the timeline shows only
  events whose names match an active subscription. Earlier events that did
  not match are still recorded and become visible if you remove the filter.
- Click `×` next to a subscription to remove it. With all subscriptions
  cleared, the timeline returns to showing every event.

This means you never miss an early event because you hadn't subscribed yet —
useful for servers that emit a one-off `ready` or `welcome` event right after
the handshake. To stop receiving anything at all, click **Disconnect** at
the top.

## The event timeline

| Column | Description |
|---|---|
| Direction | `↑` for emits you sent; `↓` for events received from the server |
| Event | The event name |
| Timestamp | Local-clock time of the emit / receive |
| Payload | Pretty-printed JSON, or the raw string if not JSON |

Click any row to expand the full payload. Click **Clear** to wipe the
timeline without disconnecting.

## Headers and auth

Socket.IO authentication usually flows through the `auth` payload of the
handshake (preferred over headers because it survives long-polling fallback).
Testnizer's **Bearer token** field is sent as `auth: { token: '<value>' }` —
this is the format expected by the standard `socket.io` middleware patterns
(`io.use(...)`).

For servers that look at HTTP headers instead (e.g. `Authorization`), Testnizer
also supports custom headers on the WebSocket upgrade handshake — these are
provided via the `extraHeaders` option of `socket.io-client`. Note that
extra headers are not sent on long-polling fallback because the browser
WebSocket spec doesn't allow custom headers there in all environments.

## Multi-tab isolation

Each Socket.IO tab maintains its own connection, namespace, subscriptions, and
timeline. Open multiple tabs to test multiple servers, multiple namespaces on
the same server, or a single server under different auth tokens — none of the
state crosses tabs.

## What Testnizer does not do

- **No automatic reconnection.** Tooling for protocol testing should expose
  drops, not hide them.
- **No persistent storage of emitted events.** The timeline is in-memory per
  tab. Closing the tab clears it.
- **No binary payload editor.** Outgoing payloads are JSON or string; if you
  need to send `Buffer` or `ArrayBuffer`, use a script-driven flow instead.
