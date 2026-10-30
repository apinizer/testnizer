---
title: WebSocket
description: Connect, send, and receive WebSocket messages with Testnizer's full-featured WS editor.
order: 3
section: Protocols
---

Testnizer's WebSocket editor keeps a persistent connection alive for as long as
you need it. Messages flow in both directions in a single timeline, and the
connection survives tab switches.

## Opening a WebSocket tab

Click **+ New** → **WebSocket** (or pick WebSocket from the project sidebar).
You can also import an existing `ws://` or `wss://` request from Postman or
Insomnia collections; a Postman v3 WebSocket request imports and exports with
its URL, params, headers, settings and saved messages.

The editor has a connection bar at the top, request tabs under it (**Message**,
**Params**, **Headers**, **Settings**) and the message log below.

## Connection bar

`ws://` and `wss://` are both supported. Variables resolve in real time:

```
wss://{{wsHost}}/chat?room={{roomId}}
```

Hit **Connect** to perform the upgrade. The status indicator shows the connection
state (connecting, connected, disconnected); **Cancel** appears while the
handshake is running, and **Disconnect** sends a clean close frame.

If the server rejects the upgrade (non-101 HTTP response) the error message
and HTTP response headers are shown in the log so you can diagnose
auth failures or protocol mismatches.

## Params and Headers

**Params** are query parameters of the handshake URL; the table and the URL stay
in sync, and a row can be disabled without deleting it.

**Headers** are added to the HTTP upgrade request. Common use cases:

- `Authorization: Bearer {{token}}`
- `Sec-WebSocket-Protocol: graphql-ws` (for GraphQL subscriptions that need it)
- Custom cookies (set the `Cookie` header directly)

Some WebSocket servers reject unknown headers during the upgrade. Testnizer
sends exactly the headers you define, nothing more.

## Sending messages

### Message tab

The **Message** tab is the composer. Choose the **Message format**:

- **Text** — sent as a UTF-8 text frame
- **JSON**, **XML**, **HTML** — sent as a text frame; **Beautify** pretty-prints
  the content (and reports why it cannot, for example invalid JSON)
- **Binary** — **Base64** or **Hexadecimal**. Base64 content is decoded, and
  hexadecimal bytes (for example `48 65 6c 6c 6f`) are parsed, and each message
  goes out as **one real binary frame**

Click **Send Message**. `{{variable}}` substitution works in the composer at send
time, resolved from the active environment and the project's Globals each time,
so you can change a value between sends without editing the message.

### Saved messages

Frequently used messages (subscription payloads, heartbeats) can be kept in the
**Saved messages** pane on the right. **Save** stores the composer (it updates the
saved message that is loaded); click a saved message to load it into the composer,
double-click to rename it, or use the button on any logged message to save it.
Saved messages belong to the request: they are written with it (Ctrl+S) and travel
in a Postman v3 export.

## Settings

| Setting | Default |
|---|---|
| **Enable server certificate verification** | On. Turn off to connect to a `wss://` server with a self-signed certificate |
| **Handshake timeout (ms)** | 15 000 |
| **Reconnection attempts** | 0 (no reconnection) |
| **Reconnection interval (ms)** | 5 000 |
| **Maximum message size (MB, 0 = unlimited)** | 100 |

Settings are locked while connected and apply on the next Connect. A dot on the
**Settings** tab shows that something differs from the defaults.

Reconnection is **off by default**: like the Socket.IO editor, the WebSocket
editor surfaces drops instead of silently re-establishing them, so you can
diagnose intermittent failures rather than have them papered over. Raise
**Reconnection attempts** to have Testnizer retry after an unexpected drop; each
attempt and a successful reconnection appear as connection rows in the log.

## Message log

Every sent and received message appears in the log in chronological order. An
up arrow marks a message you sent, a down arrow one from the server, and a radio
icon a connection event (connected, disconnected, error, reconnecting,
reconnected). Click a row to see the full payload; large payloads are shortened in
the row but complete in the detail view, which also shows the message's size, time
and type.

| Control | Action |
|---|---|
| **Search messages** | Text search across all payloads |
| **Filter messages** | **All**, **Sent**, **Received** or **Connection** |
| **Select to compare times** | Select two rows to see "N ms between selected" |
| **Copy message** | Copies the payload |
| **Save as a saved message** | Adds the payload to the saved messages |
| **Hexdump** | For a received binary frame, shows a hex dump instead of text |
| **Wrap lines** | Wraps long payloads |
| **Auto-scroll** / **Clear** | Follow new messages; remove all entries (does not disconnect) |

Received messages are held in memory only; they are not written to disk.

## Ping / Pong

Testnizer responds automatically to server ping frames with a pong frame.

## Connection lifetime

A WebSocket connection belongs to its Testnizer tab, not to the Electron window.
Switching to another tab does not disconnect. **Closing the tab closes the
connection**, and so does **leaving the project** (switching to another project or
going Home): a connection must not keep receiving into a project you cannot see.
The same rule applies to Socket.IO and MQTT tabs. Reconnect when you come back; the
composer, headers and saved messages are preserved.
