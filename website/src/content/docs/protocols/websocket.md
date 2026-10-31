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
Insomnia collections.

## Connect panel

### URL

`ws://` and `wss://` are both supported. Variables resolve in real time:

```
wss://{{wsHost}}/chat?room={{roomId}}
```

### Headers

Add custom headers to the HTTP upgrade request. Common use cases:

- `Authorization: Bearer {{token}}`
- `Sec-WebSocket-Protocol: graphql-ws` (for GraphQL subscriptions that need it)
- Custom cookies (set the `Cookie` header directly)

Some WebSocket servers reject unknown headers during the upgrade. Testnizer
sends exactly the headers you define, nothing more.

### Connect / Disconnect

Hit **Connect** to perform the upgrade. The status indicator turns green and
shows the connection state (Connecting → Open → Closed). Hit **Disconnect** to
send a clean close frame.

If the server rejects the upgrade (non-101 HTTP response) the error message
and HTTP response headers are shown in the timeline so you can diagnose
auth failures or protocol mismatches.

## Sending messages

### Message composer

The composer at the bottom of the editor lets you type or paste a message
before sending. Choose the format:

- **Text** — sent as a UTF-8 text frame
- **JSON** — same as text, but Testnizer validates JSON syntax and
  auto-formats the composer area
- **Binary** — paste hex (`0xDEADBEEF`) or Base64 (`data:`) and Testnizer
  converts to binary frame

Hit **Send** or press `Ctrl+Enter` / `Cmd+Enter`.

### Saved messages

Frequently-used messages (ping frames, subscription payloads) can be saved
in the **Saved messages** panel on the right. Click a saved message to
pre-fill the composer, then tweak and send.

## Message timeline

Every sent and received message appears in the central timeline in
chronological order:

- Blue bubble, → arrow — message you sent
- Green bubble, ← arrow — message from server
- Grey line — connect / disconnect / error events

Click any timeline entry to see the full payload in the detail panel.
Large payloads are truncated in the timeline (first 256 bytes) but shown
in full in the detail view.

### Timeline controls

| Control | Action |
|---|---|
| **Clear** | Removes all timeline entries (does not disconnect) |
| **Pause** | Stops new entries from scrolling in while you inspect an existing one |
| **Filter** | Text search across all payloads |
| **Show sent / received** | Toggle visibility of each direction |

## Ping / Pong

Testnizer responds automatically to server ping frames with a pong frame.
You can also send a manual ping from the message composer (**Type → Ping**).

## Reconnect

If the connection drops, Testnizer shows a **Reconnect** button in the
timeline. The composer and saved messages are preserved so you can resume
without re-entering payloads.

Auto-reconnect is intentionally off — like the Socket.IO editor, the WebSocket
editor surfaces drops instead of silently re-establishing them, so you can
diagnose intermittent failures rather than have them papered over.

## Variables in messages

`{{variable}}` substitution works in the message composer at send time. The
variable is resolved from the active environment (and project variables) each
time you press Send, so you can change an environment value between sends
without editing the message itself.

## Connection lifetime

WebSocket connections are tied to the Testnizer tab, not the Electron window.
Switching to another tab does not disconnect. Closing the tab sends a clean
close frame.
