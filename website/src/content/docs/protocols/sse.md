---
title: SSE (Server-Sent Events)
description: Connect to a Server-Sent Events stream, watch events as they arrive, filter by event type, resume with Last-Event-ID, and test against the built-in SSE mock server.
order: 7
section: Protocols
---

Testnizer's SSE editor opens a long-lived `text/event-stream` connection from the
Node main process and shows each event in a log. The renderer receives parsed
events over IPC and never holds a socket itself.

Looking for the chat editor? AI Chat has its own page: [AI Chat](/docs/protocols/ai-chat).

## Opening an SSE tab

Click **+ New** → **SSE**. The editor has a connection bar (status, method, URL,
**Connect**), collapsible **Last-Event-ID**, **Body** and **Custom Headers**
sections, and the event log. A new tab starts with an empty URL.

## URL, method and headers

Enter the endpoint URL. `{{variables}}` resolve when you press Connect, in the
URL, the headers, the body and the Last-Event-ID field:

```
{{apiBaseUrl}}/events/stream?topic={{topicId}}
```

Add request headers under **Custom Headers**, for example
`Authorization: Bearer {{accessToken}}`. If you do not set `Accept`, Testnizer
sends `Accept: text/event-stream`.

The method list next to the status pill offers **GET**, **POST**, **PUT**,
**PATCH** and **DELETE**, because some servers open a stream in answer to a POST.
For anything other than GET the **Body** section opens up, with a **JSON** or
**Text** type; if you add a body and no `Content-Type` header, Testnizer sets
`application/json` or `text/plain` to match.

A GET without a body uses the browser-style `EventSource` behaviour, including
automatic reconnects. A request with another method, or with a body, is read as a
plain streaming response and **does not reconnect on its own**: when the stream
ends, the connection ends.

If a custom proxy is configured in Project Settings or Settings, the connection
goes through it (see **Bypass for hosts** there to skip it for some hosts).

## Connect, Cancel, Disconnect, Reconnect

- **Connect** opens the stream. The status pill goes **Connecting** → **Connected**.
  The handshake gives up after 15 seconds.
- While connecting, the button becomes **Cancel**. Once connected it becomes
  **Disconnect**, and the log stays so you can scroll through what arrived.
- **Reconnect** (shown while connected) disconnects and connects again with the
  settings currently in the editor, and starts a fresh log.

Ctrl/Cmd+Enter connects when you are in the SSE tab.

If the connection drops while it is open, the status pill reads
**Reconnecting…** until the next successful open. When the server ends the
stream for good, for example by answering HTTP 204 to the reconnect, the tab
shows **The server closed the stream** (with the HTTP status when there is one)
and goes to disconnected; a stream that simply ended is not logged as an error.
Connection failures say what went wrong and where (refused, timed out, DNS, TLS,
HTTP status), and tokens in the URL never appear in the message.

## Last-Event-ID and resume

Open the **Last-Event-ID** section and type an event id to resume from it.
Testnizer sends it as the `Last-Event-ID` request header on connect, so a
compliant server replays what you missed.

When the stream drops and the client reconnects by itself (GET without a body),
it sends the id of the last event it received. The field in the editor is not
filled in for you: it holds only the value you typed, and **Reconnect** reads
that value, not the last id seen.

## The event log

![SSE tab connected to a mock stream, with typed events in the log and one event expanded](/docs/screenshots/sse-event-log.png)

Each event is one row:

| Part | Shows |
|---|---|
| Type badge | The `event:` name, or `message` when the event has none |
| Preview | The `data:` text on one line, shortened to 80 characters |
| **JSON** badge | Shown when the data parses as JSON |
| `id:` | The event's `id:` field, when present |
| Time | When the event arrived (local clock, with milliseconds) |

Click a row to expand it. JSON data is pretty-printed; other data is shown as
received, with line breaks.

- **Filter.** Once the stream has produced more than one event type, a filter
  appears above the log with **All events** and one entry per type, plus a
  `shown of total` count. Filtering only hides rows; choose **All events** to
  see everything again.
- **Footer.** The footer shows the event count, the time connected, an
  **Auto-scroll** checkbox and **Clear**.
- **Comment lines** (those starting with `:`) are not shown. A `retry:` value is
  used for automatic reconnects and is not displayed.

Events are kept in memory for the session. They are not written to disk, and
what an older build saved is cleaned at start.

## Saving and History

Ctrl+S saves the tab with the request: URL, method, body, headers, Last-Event-ID
and the filter. A credential typed as a literal header value is not kept after a
restart unless it is a `{{variable}}`. Connections appear in History, with
credentials masked, and reopen in the SSE editor.

SSE requests are not run by the Collection Runner, Test Suites or the Scheduler;
they are listed as unsupported and skipped.

## Testing against a mock

You do not need a real backend to try the editor. The Mocks panel has an **SSE**
mock server that streams events you define, with an interval, heartbeats, loops,
`Last-Event-ID` resume and deliberate mid-stream errors. **Start & open in SSE
tab** points this editor at it. See [SSE mock server](/docs/mock-server/sse).
