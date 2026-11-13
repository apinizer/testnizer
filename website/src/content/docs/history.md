---
title: Request history
description: Browse, replay, and clear past requests from Testnizer's local history panel.
order: 4
section: Reference
---

## What's recorded

Every request you send is recorded automatically, for every protocol, with a
snapshot of the request and the response. History is stored in the local SQLite
database on your machine (`testnizer.db`), and nothing is transmitted over the
network.

Each history entry captures:

- **Method and URL**
- **Status, response time and size**
- **The request and the response**, as a snapshot you can reopen
- **The project** it belongs to; the list shows the active project's entries

### Credentials are masked before they are stored

Credentials never reach the History database in clear text. Before a row is
written, Testnizer masks:

- credential headers (`Authorization`, `Cookie`, API-key headers and similar)
- query and body fields that carry credentials, at any depth, including JSON, form
  and XML / SOAP bodies
- `user:pass@` in a URL
- the values of your **secret** variables, and token fields in responses
  (`access_token`, `refresh_token` and similar)
- the password of the app-level and project proxies

A credential you sent in a request body is masked wherever a server echoes it
back, even under another name. WebSocket, Socket.IO, SSE, GraphQL and gRPC tabs do
not write the messages they receive to disk; those live in memory for the
session. Rows written by older builds are masked once, the first time 1.6.0
starts.

History keeps the `{{variable}}` template of a request, so a request can be sent
again with the current values of your variables. When a credential was masked, the
reopened request shows a note ("Credentials were not stored in History — enter
them again") and leaves that field empty.

---

## Browsing history

![History panel listing today's requests with method, URL, status and time](/docs/screenshots/history-list.png)

Open the **History** tab in the left sidebar. It has two lists:

- **Requests** — the requests you sent, grouped by day (Today, Yesterday and
  earlier). Hover a row to see the full URL.
- **Commits** — the commit history of the active project's Git branch.

Type in the **Filter history** field to narrow the list by URL or method. For MCP
rows the tool, prompt or resource name is searched too.

---

## Replaying a request

Click a history entry. It opens in a request tab with the original method, URL,
headers and body filled in, in the editor of its own protocol: HTTP, SOAP, MCP,
WebSocket, Socket.IO, GraphQL, gRPC and SSE entries each reopen in their own
editor.

You can send it as-is or modify any field before sending. The replay behaves like a
manually constructed request — pre-request scripts run, tests execute, and the
result is saved as a new history entry.

Runner and test suite results are not listed here. They live on the **Tests**
page, under run history, where each run can be reopened and exported as HTML or
JSON. See [Collection runner & automation](/docs/cli-and-automation).

---

## Removing entries

- The trash button on a row deletes that entry.
- **Clear** in the History sidebar deletes the history of the **active project
  only**. It asks for confirmation first, says how many entries it will delete,
  and is disabled when the list is empty.
- **Settings → Data → Clear history** does the same for the project from the
  Settings dialog.

Neither action affects your saved endpoints, environments, or collection
structure.
