---
title: Mock servers overview
description: Mock servers are real servers that run inside Testnizer on 127.0.0.1. Four kinds - HTTP, SSE, AI (LLM) and MCP - with presets, import, a live request log and secrets that stay on your computer.
order: 1
section: Mock servers
---

A **mock server** in Testnizer is a real server that runs inside the app and
answers with the responses you configure. It listens on a port on your computer,
so any client can call it: your browser, `curl`, a frontend under development,
an SDK, or another request tab in Testnizer.

Use one to:

- Stand in for a backend that does not exist yet
- Reproduce flaky upstream behaviour (latency, 5xx, auth failures, a stream that
  breaks half way) on demand
- Replay captured traffic offline
- Test a client's error handling against exact HTTP statuses
- Try an AI client or an MCP client without spending tokens or touching a real
  server

A server binds to **127.0.0.1 by default**, so only your computer can reach it.
You have to choose `0.0.0.0` on purpose to make it reachable from your network;
the editor warns you when you do.

You find mock servers in the left sidebar, under the **Mocks** icon.

![Mock Server editor - endpoints panel with full URL bar, condition / script editors, and live response preview](/testnizer-mock.png)

## The four kinds

| Kind | It serves | You open it with | Page |
|---|---|---|---|
| **HTTP** | REST-style endpoints with rule-based responses, scripts, auth, failure injection, a recording proxy | **Open in request tab** | [HTTP mock server](/docs/mock-server/http) |
| **SSE** | A Server-Sent Events stream with timed events, ids, heartbeat and reconnect behaviour | **Open in SSE tab** | [SSE mock server](/docs/mock-server/sse) |
| **AI** | An OpenAI-compatible and Anthropic-compatible chat API that streams canned replies | **Open in AI Chat tab** | [AI (LLM) mock server](/docs/mock-server/ai) |
| **MCP** | A Model Context Protocol server with tools, resources and prompts | **Open in MCP tab** | [MCP mock server](/docs/mock-server/mcp) |

HTTP, SSE and AI servers run on the same HTTP engine. The kind decides which
presets, body types and **Open in...** buttons the editor offers, and which
sidebar section the server is listed in; you can change it later in the server's
Settings tab (**Server type**) without losing endpoints or responses. A running
server keeps running. The MCP mock is a separate server type with its own
editor.

The sidebar groups servers by kind: **HTTP servers**, **MCP servers**, **SSE
servers** and **AI servers**.

## Creating a server

Click **+** at the top of the Mocks panel, or **New mock server** on an empty
Mocks page. One dialog creates every kind:

1. **Server type**: HTTP, MCP, SSE or AI. A line under the switch says what
   the type is for.
2. **Start from**: a preset for that type, or **Blank**. Each preset lists what
   it creates. See the page of the kind for its presets.
3. **Name**: prefilled with a unique name.
4. **Port**: prefilled with a free port. The suggestion starts at 3001 for HTTP,
   3100 for MCP, 3200 for SSE and 3300 for AI. The field is checked as you type:
   a port another mock server of this project already uses gives a warning, and
   ports below 1024 may need elevated permissions on your computer.

Press **Create** (or Enter). The server is created stopped; press **Start** in
its header to listen. Servers are independent: endpoints, in-memory state, logs
and rate-limit counters belong to one server. Run as many as you have free
ports.

### Import a file

For an HTTP mock, **Start from** also offers **Import a file**. Choose an
OpenAPI 3.x or Swagger 2.0 spec, or a Postman v1, v2.x or v3 collection, in
JSON or YAML. Testnizer recognises the format, shows what it found, and names
the server after the spec. A file that is not a spec, or has nothing to mock, is
refused before any server exists, so a failed import leaves no empty server
behind. Details are on the [HTTP mock server](/docs/mock-server/http#importing-existing-specs) page.

### Create from saved requests

In the APIs panel, right-click a folder, a project or a request and choose
**Create Mock Server from this folder** (or *project*, or *request*). Each HTTP
request becomes an endpoint that binds the request's path, and each saved
example becomes a response. A request without examples answers an empty `200`.
Requests of other protocols are skipped, and the message that ends the action
lists everything that could not be added. A mock created by an older build keeps
its old endpoints; create it again to get the path-based ones.

## Starting, stopping and the address

The header of every editor shows the server's name, a status (**running**,
**starting**, **error** or **stopped**), the base URL with a copy button, and
**Start** / **Stop**. In the Settings tab you set the host, the port and a base
path.

- Mock servers keep running when you switch to another project. A port that
  another server holds, even one that belongs to another project, is reported
  by name when you try to use it.
- If you change the host or port of a running server and the new address is
  taken, the server stays on its old address and tells you which port is busy and
  by whom. It does not show a new port with "Running".
- A server on `0.0.0.0` is reachable from other machines. The HTTP editor warns
  that this exposes the server on your network, and an MCP mock without a bearer
  token shows a second warning when it is bound to a non-local address.

## Opening a mock in a tab

Every kind has a button that points one of Testnizer's own editors at the mock:

- **HTTP**: **Open in request tab** on an endpoint opens an ordinary HTTP request
  with any method, headers, body and auth. You can Send and Save it. If the
  server is stopped the button reads **Start & open in request tab** and opens
  the tab only when the server started.
- **SSE**: **Open in SSE tab** / **Start & open in SSE tab**.
- **AI**: **Open in AI Chat tab**, and **Open in AI Chat (Anthropic)**. These
  tabs do not send your saved provider key to the mock (see
  [AI mock server](/docs/mock-server/ai)).
- **MCP**: **Open in MCP tab** / **Start & open in MCP tab**, pre-filled with the
  server's URL.

If a tab for that mock is already open, **Start & open** reuses it.

## The live request log

The **Logs** tab lists every request the server has answered: time, method,
path, status and latency. Click a row for the request and response headers and
bodies. Only the latest 500 entries are kept, in memory, and they are gone when
you quit the app. A stream (SSE or AI) is one row marked
**streaming...** until it closes, not one row per chunk.

The log is masked the same way as History and the Console: credential headers,
query and body fields, and the values of your secret variables are hidden before
they are stored.

## Secrets stay on your computer

- A **secret** variable is never expanded in a mock response. A template that
  uses `{{apiKey}}` for a secret variable sends the text `{{apiKey}}`, so a
  client that calls the mock cannot read it.
- The tokens, passwords and API keys in a mock's authentication, and the bearer
  token of an MCP mock, are encrypted with your operating system's key store in
  the local database. Where no key store is available (some Linux setups) they
  are stored unencrypted, and the app says so.
- They are written as empty values to every file that leaves the app: Git, project
  files and exports. A pull or an import never overwrites the value you have
  locally. After a pull from a teammate, type the secrets again on your own
  computer.
- Authentication fails closed. A mock whose credentials are empty (or could not
  be read) refuses requests instead of letting them through, and an MCP mock in
  bearer mode without a token does not start.
- A preset does not copy its generated token into the server's description.

## Related

- [HTTP mock server](/docs/mock-server/http)
- [SSE mock server](/docs/mock-server/sse)
- [AI (LLM) mock server](/docs/mock-server/ai)
- [MCP mock server](/docs/mock-server/mcp)
