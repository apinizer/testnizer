---
title: Socket.IO
description: Connect to Socket.IO servers (client v2, v3 or v4), emit events with several arguments and acknowledgements, choose the events to listen to, and watch the bidirectional timeline.
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

Click **+ New** → **Socket.IO**. The editor has a connection bar at the top,
request tabs under it (**Message**, **Params**, **Headers**, **Events**,
**Settings**) and the event timeline below.

## Connecting

| Field | Required | Notes |
|---|---|---|
| **URL** | yes | The server origin, e.g. `http://localhost:3000` or `https://api.example.com`. Query parameters stay in the query |
| **Namespace** | no | Defaults to `/`. Set to `/admin`, `/chat`, etc. for namespaced servers; it goes on the path, never inside the query |
| **Bearer token** | no | Sent inside the `auth` payload during the handshake (`auth: { token: '...' }`) |

**Params** add query parameters to the handshake and **Headers** are sent with it,
for servers that look at an `Authorization` header instead of the `auth` payload.

Click **Connect**. Testnizer:

1. Establishes the Socket.IO connection (preferred transport: WebSocket, with
   HTTP polling as a fallback — configurable in Settings).
2. Waits for the server to ack the connection (the **Handshake timeout** in
   Settings, 10 seconds by default).
3. On `connect`, the status changes to **Connected** and the Message tab becomes
   active.
4. On `connect_error`, the status changes to **Error** and the message from the
   server is shown beside the Connect button (for example the text from an
   `io.use(...)` middleware that refused the handshake).

**Cancel** during the handshake cancels it cleanly. If the **server** closes the
connection (for example it kicks the client), the tab goes to **Disconnected**,
keeps its configuration and the timeline, and an emit fails with "Not connected"
until you connect again.

## Settings and client version

| Setting | Default | Notes |
|---|---|---|
| **Client version** | v4 | **v4**, **v3** or **v2** — see below |
| **Handshake path** | `/socket.io` | The server's `path` option |
| **Transport** | WebSocket, then polling | Or **WebSocket only** / **Polling only** |
| **Enable server certificate verification** | On | Applies to `https://` servers, for both the polling and WebSocket transports |
| **Handshake timeout (ms)** | 10 000 | |
| **Reconnection attempts** | 0 | 0 means no reconnection |
| **Reconnection interval (ms)** | 1 000 | |

**Client version.** Socket.IO 3 and 4 servers speak one protocol, so **v3 and v4
use the same client**. Pick **v2** for a Socket.IO 2 server: Testnizer then uses a
2.x client. A Socket.IO 2 server has **no handshake `auth`**, so with v2 selected
the bearer token is sent as the **`token` query parameter**
(`socket.handshake.query.token`, where such servers read it). Server and proxy
logs may record query parameters, so a token sent this way can end up in those
logs. Settings is locked while connected and applies on the next Connect.

Auto-reconnection is **off** by default — testing tools should make connection
failures visible, not paper over them. Raise **Reconnection attempts** to have
Testnizer retry after an unexpected drop; each attempt appears as a connection row
in the timeline.

## Emitting events

The **Message** tab takes:

- **Event name** — any string, e.g. `chat:message` or `subscribe`
- **Arguments** — a Socket.IO event can carry several. Each argument has its own
  **format**: **Text**, **JSON**, **Base64** or **Hexadecimal**. Base64 and
  hexadecimal arguments are sent as binary. Use **Add argument** for more
- **Ack** — ask the server to acknowledge the event; its reply appears in the
  timeline as an "Ack" row
- **Save** — stores the event name, arguments and Ack setting as a **saved
  message** in the right-hand pane (click to load, double-click to rename)

Click **Emit** (or press Enter in the event name field while connected). The event
appears in the timeline immediately as an outgoing event. Variables (`{{userId}}`,
`{{token}}`) resolve in the event name and the arguments.

## Listening to events

The **Events** tab controls what the timeline shows:

- **Listen to all events** — every event the server sends is shown.
- Otherwise only the events you add and turn on are shown. Type an **event name**,
  click **Add event**, and use the toggle on its row to listen to it or not. This
  is how Postman's Socket.IO request works.

A request with no listener and **Listen to all events** off shows a notice that
nothing is being listened to, so a missing `welcome` event is not a mystery. A
request saved by an older Testnizer version has no listener setting and keeps
showing every event until you change it.

## The event timeline

| Column | Description |
|---|---|
| Direction | An up arrow for emits you sent; a down arrow for events received; a radio icon for connection events |
| Event | The event name |
| Timestamp | Local-clock time of the emit / receive |
| Payload | Pretty-printed JSON, or the raw string if not JSON |

Click a row to expand the full payload. The toolbar has **search**, a **filter**
(All, Sent, Received, Connection), **copy**, **save as a saved message**,
**compare the time between two rows**, a **Hexdump** view for binary arguments and
**Clear**. Received events are held in memory only; they are not written to disk.

## Headers and auth

Socket.IO authentication usually flows through the `auth` payload of the
handshake (preferred over headers because it survives long-polling fallback).
Testnizer's **Bearer token** field is sent as `auth: { token: '<value>' }` — this
is the format expected by the standard `socket.io` middleware patterns
(`io.use(...)`). For a Socket.IO 2 server it goes in the query instead, as
described above.

A typed token is not kept after a restart unless the request is saved; use a
`{{variable}}` (a secret one) to keep it in the environment instead.

## Multi-tab isolation and lifetime

Each Socket.IO tab maintains its own connection, namespace, listeners, and
timeline. Open multiple tabs to test multiple servers, multiple namespaces on
the same server, or a single server under different auth tokens — none of the
state crosses tabs.

A connection belongs to its tab: **closing the tab disconnects** (or cancels a
handshake in progress), and so does **leaving the project** (switching project or
going Home). The same rule applies to WebSocket and MQTT tabs.

## What Testnizer does not do

- **No automatic reconnection by default.** It is a setting, off unless you raise
  the attempts.
- **No persistent storage of received events.** The timeline is in memory per
  tab; saved messages hold what you compose, not what you receive.
