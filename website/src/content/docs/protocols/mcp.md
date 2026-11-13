---
title: MCP (Model Context Protocol)
description: Testnizer is an MCP client. Connect over Streamable HTTP, SSE or stdio, call tools, read resources, fetch prompts, sign in with OAuth 2.1, run saved calls in the Runner, and run a graded security scan.
order: 10
section: Protocols
---

The **Model Context Protocol** is the open spec — published by Anthropic and
adopted by Claude Desktop, IDE extensions, and other AI hosts — that lets a
language-model host talk to external servers in a standard way. An MCP server
exposes **tools** (with JSON schemas for their inputs), **resources** (data
addressed by URI) and **prompts** (reusable message templates); an MCP client
(Testnizer, in this case) discovers them and uses them.

Testnizer is an MCP **client**. Use it to:

- Verify that a new MCP server you're building answers the protocol handshake
  and the list calls correctly.
- Try out a third-party MCP server before wiring it into Claude Desktop.
- Smoke-test tool calls during development without spinning up a host, and
  re-run saved calls in the Runner, Test Suites and the Scheduler.
- Build a server of your own to test against: the Mocks panel can run a local
  [MCP mock server](/docs/mock-server/mcp).

It is built on the official MCP TypeScript SDK (v2), so the wire protocol is
the same one other hosts speak.

## Opening an MCP tab

Click **+ New** → **MCP**. The editor has a connection bar (status, transport,
protocol, URL or command, **Connect**), a request config strip
(**Authorization**, **Headers**, **Environment**, **Scripts**, **Tests**,
**Settings**), a capability list on the left, the **Explorer** on the right and
a **Messages** pane at the bottom. The divider between the list and the
Explorer is draggable and remembered.

## Choosing a transport

- **Streamable HTTP** — the current MCP HTTP transport, for remote servers at a
  URL like `https://mcp.example.com/mcp`.
- **SSE (legacy)** — the earlier HTTP+SSE transport, for older servers whose
  documentation mentions SSE.
- **stdio (local)** — Testnizer **spawns the server as a child process** and
  speaks JSON-RPC over its stdin/stdout; no network involved. Put the full
  command line in the URL field, e.g. `npx -y @modelcontextprotocol/server-everything`.
  The first token is the executable, the rest are arguments. The server inherits
  Testnizer's environment (PATH, HOME, …); add more in the **Environment** tab.

The URL, headers and environment values accept `{{variables}}`, resolved when
you press Connect.

## Choosing a protocol version

The **Protocol** selector applies to the next Connect:

- **Auto (recommended)** — tries MCP 2026-07-28 first (`server/discover`) and
  falls back to MCP 2025 (`initialize`). A gateway that answers the discover
  probe with an error such as 403 or a 5xx also leads to that fallback.
- **MCP 2025 (classic)** — the `initialize` handshake only.
- **MCP 2026-07-28** — the new stateless protocol only.
- **Exact MCP 2025 version** — pin one dated version.

Once connected, the server's name, version and the negotiated `MCP <version>`
appear under the bar; hover the badge for the supported versions, capabilities
and the server's instructions.

## Connecting

Click **Connect** (it becomes **Cancel** while connecting and **Disconnect**
when connected). On success the **Tools**, **Resources** and **Prompts** lists
fill automatically. If the server sends a `list_changed` notification, the
matching list is re-fetched. If the handshake fails, the error is shown under
the connection bar; a `401` offers to run the OAuth flow.

If the server redirects the endpoint to another origin, Testnizer follows the
redirect but does not replay your credential headers (Authorization, API keys,
cookies) to the new origin.

**Paste config…** (the menu next to Connect) imports a server from a Claude
Desktop, VS Code (`.vscode/mcp.json`) or Cursor (`.cursor/mcp.json`) config, or
a single server object. **Export config** writes the current server in the same
formats; the output may contain secrets, so Testnizer says so.

## The capability list

The left panel has **Tools**, **Resources** and **Prompts** tabs with counts and
a search box (name, description, URI). Resource **templates** are listed under
Resources. Selecting an entry opens it in the **Explorer**.

## Calling a tool

![MCP tab connected over Streamable HTTP, with the search_orders tool, its JSON arguments and the result](/docs/screenshots/mcp-tool-call.png)

1. Select a tool. Its description, the server's hints (**read-only**,
   **destructive**, **idempotent**, **open world**) and its **Input schema** and
   **Output schema** are shown.
2. Fill the **Arguments**. The **Form** view is generated from the input schema
   (strings, numbers, booleans, enums, arrays, nested objects, defaults);
   switch to **JSON** to edit the raw object. Schemas the form cannot express
   (`oneOf` / `anyOf` / `allOf`, `$ref`, `patternProperties`, lists of objects,
   untyped fields) fall back to JSON. Values may use `{{variables}}`
   (`{"path": "{{workspaceRoot}}/file.txt"}`); a string such as `"{{n}}"` is
   converted to a number where the schema asks for one.
3. Click **Run** (or press Ctrl/Cmd+Enter). If the arguments do not match the schema, Testnizer lists the
   problems and offers **Invoke anyway**.
4. The result appears below as **JSON** or **Preview** (text, images, audio,
   embedded resources, structured content). A tool that reports `isError` is
   shown as **Tool error**. A running call can be cancelled; the connection
   stays open. If a server sends an image that ends before its end marker, the
   result says **The server sent incomplete image data** with the size and type,
   and **Download as received** saves the bytes as they came.

**Copy as…** puts the call on the clipboard as a JSON-RPC request or, for
Streamable HTTP, as cURL.

## Reading resources and fetching prompts

- **Resources** — select a resource and press **Read**. For a **template**,
  replace the `{placeholders}` in the URI first. The contents (text, JSON,
  binary with a download button) appear under **Contents**.
- **Prompts** — select a prompt, fill its **Arguments** (required ones are
  checked) and press **Get prompt**. The returned **Messages** are shown with
  their `user` / `assistant` role.

## When the server asks for input

A server can pause a call to ask you something (elicitation, or a multi-step
`input_required` round on MCP 2026-07-28). An input card appears with a form
built from the server's request: **Accept** / **Submit**, **Decline** or
**Cancel**, with a preview of what will be sent and the raw request. Your answer
is sent back and the call continues.

## Messages: notifications and frames

The **Messages** pane (drag its top edge to resize) has two tabs:

- **Notifications** — notifications the server sends, such as `list_changed`.
  On MCP 2026-07-28 a chip shows the `subscriptions/listen` stream and which
  notifications the server agreed to send.
- **Frames** — the raw JSON-RPC messages of this connection, both directions.

Both support a filter, **Copy** for the selected entry, **Export** (the entries
shown, as JSON), **Clear** and **Auto-scroll**. They are kept in memory only and
are gone when you quit the app.

## Authorization, headers, scripts and settings

- **Authorization** — No Auth, Basic, Bearer, API Key (header or query) or
  **OAuth 2.1**, which opens the step-by-step debugger described
  [below](#oauth-21-debugger). Not used for stdio.
- **Headers** — custom headers for Streamable HTTP and SSE, sent on connect and
  with every call. They accept `{{variables}}`. An explicit row here wins over a
  header the Authorization tab would add.
- **Environment** — environment variables for the stdio server process.
- **Scripts / Tests** — the same pre-request and post-response scripts and
  assertions as an HTTP request. The result is available as `pm.response`
  (200 for a result, 500 for a tool error) and `pm.mcp`.
- **Settings** — request timeout in ms (empty = default 120 s, `0` = no limit).
  It bounds each tool call, resource read and prompt get, and progress
  notifications from the server restart it. It is saved with the request and used
  by both Send and Run.

Calls are saved with the request (Ctrl+S) and recorded in History with
credentials masked.

## OAuth 2.1 debugger

Choose **OAuth 2.1** on the Authorization tab (or follow the prompt when Connect
gets a `401`) to walk the authorization handshake one step at a time, with the
request and response of every step visible:

1. **Unauthenticated probe** — the server's `401` and its `WWW-Authenticate`
   challenge. If the server accepts an unauthenticated request, the debugger says
   it does not require authorization.
2. **Protected Resource Metadata** (RFC 9728)
3. **Authorization Server Metadata** (RFC 8414)
4. **Client registration** (RFC 7591) — leave **Client ID** empty to register
   dynamically, or enter a client ID and an optional **client secret**.
5. **PKCE + authorization URL**
6. **Browser sign-in + loopback redirect**
7. **Token exchange**

Set **Scope** or leave it empty to request what the server advertises. When the
flow ends, a summary shows the issuer, client ID, token type, expiry, scope and
whether a refresh token came back, and **Connect with token** connects with it.
**Forget token** discards it.

Tokens, the PKCE verifier and the client secret stay in Testnizer's main process
memory. They never reach the screen layer, and nothing OAuth is saved with the
request.

- **Client secret destination.** If the authorization server, or its token
  endpoint, is on a different host than the MCP server, the debugger stops before
  opening the browser and asks **Send your client secret to this authorization
  server?** It lists the MCP server, authorization server and token endpoint
  origins. Your secret is sent only after **Confirm and continue**; the answer is
  remembered for that combination of hosts until Testnizer closes, and a token
  refresh never asks.
- **Plain-HTTP authorization servers.** An authorization server on `http://` is
  refused. For an intranet server you trust, tick **Allow plain-HTTP authorization
  server (intranet)** for that request. The permission is limited to the
  authorization server host the MCP server itself advertises; any other host or
  port still needs HTTPS. The warning on the switch says what travels unencrypted:
  the authorization code, PKCE verifier, client secret and tokens.

## Running MCP requests in the Runner, Test Suites and the Scheduler

A saved MCP call runs in a collection, a test suite or a schedule like any other
request. It uses the same pass or fail rules as Send, and the same `pm.*`
scripting and **Tests** tab (with `pm.response` and `pm.mcp`). The request's own
timeout is used.

A run cannot answer a question. If a call needs a sign-in, or the server asks for
input mid-call (`input_required`, elicitation), that row fails with a plain message
instead of waiting.

A **stdio** request is a command line, so a run starts it only if you connected
to that exact command, with the same environment variables, from the MCP tab on
this computer. A project pulled from Git cannot make your next run start an
unknown program; the row fails with a message that explains why.

## Security scan

The **Security** tab next to the Explorer grades an MCP server from A to F. You can
also reach it from the **Security** page in the left panel, where **MCP Security
Scan** opens the Security tab of an MCP request (a new one if none is open).
**Scan only servers you are authorized to test.**

The scan runs from your computer and sends requests only to the server you point
it at; nothing goes to Testnizer or to a third party, and no AI model is involved.
It works on **Streamable HTTP and SSE** servers. For a stdio server the tab says
the scan does not apply.

### Running a scan

The scan targets the URL in the connection bar. It authenticates the way Connect
does, with this tab's Authorization settings, headers and OAuth token ("Uses this
tab's OAuth token" is shown when a token is in use), and it also sends some
requests **without** credentials to see what an anonymous caller gets. You do not
need to be connected first.

![MCP Security tab after a scan: grade A, score 97/100, and the transport security checks](/docs/screenshots/mcp-security-scan.png)

Press **Scan**. A progress bar shows `done / total checks` and the check that is
running; **Cancel** stops it, and checks that did not run are marked skipped.

**Include active probes** is off by default. It adds two things that send more
traffic and call the server: a rate-limit burst of about 30 quick requests, and,
on a 2026-07-28 server, calls to tools that take no arguments and are annotated
read-only (or are unannotated and do not look like a write, never ones marked
destructive) to test the integrity of `requestState`. Turn it on only for servers
you are authorized to test.

### What is checked

The scan has 30 checks in eight categories (28 that always run, plus the two
rate-limit entries when active probes are on), and six more for servers that
speak protocol 2026-07-28. On a 2025-era server those six are listed as skipped.

| Category | What it looks at |
|---|---|
| **Transport security** | HTTPS (plain HTTP on a loopback address is only noted); TLS version and certificate (obsolete protocol, expired or not-yet-valid certificate, hostname mismatch, untrusted chain); whether plain HTTP on port 80 of the same host is refused (tested for servers on the default HTTPS port); whether the endpoint redirects to another origin |
| **Authentication & authorization** | Whether an unauthenticated handshake is rejected; the `WWW-Authenticate` challenge; Protected Resource Metadata (RFC 9728); authorization server metadata (RFC 8414) and whether its endpoints use HTTPS; access tokens in the query string |
| **Protocol conformance** | The handshake result; `tools/list` returning the same list twice; well-formed tool schemas; an unknown method answered with JSON-RPC `-32601`; JSON-RPC batches rejected |
| **Prompt injection & tool poisoning** | Heuristics on the text the model reads (tool, prompt and resource descriptions): instruction-override phrasing, hidden Unicode (zero-width, bidirectional and tag characters), URLs and IP addresses, oversized descriptions, look-alike tool names, and secret-like parameters |
| **Information disclosure** | Stack traces or file paths in error replies; `Server` and `X-Powered-By` headers; how much `serverInfo` and instructions reveal |
| **CORS** | A cross-origin preflight and request from a made-up origin: `*`, a reflected `Origin`, and credentials allowed to such an origin |
| **Security headers** | `Strict-Transport-Security`, `X-Content-Type-Options`, the response `Content-Type`, and `Cache-Control: no-store` |
| **Rate limiting** | Whether the server pushes back under a burst of requests (HTTP `429`, `Retry-After` or `RateLimit` headers). Active probes only; otherwise one entry says the probe was not run |

For 2026-07-28 servers the extra checks cover `server/discover`, validation of the
`Mcp-Method` header against the request body, cache hints (`ttlMs`, `cacheScope`)
on list results, authenticated results marked cacheable by shared caches, whether
the 2025 `initialize` still works next to the new protocol, and `requestState`
tampering (an active probe).

### Reading the result

The report shows the **grade**, the **score** out of 100, how many checks
**passed**, raised **warnings**, **failed**, are **info** or were **skipped**, and
the protocol era of the session (**MCP 2025** or **2026-07-28 (modern)**). Findings
are grouped by category, each with its own score. Open a finding to see its
detail, the request and response that produced it, the texts a content heuristic
matched, a **Recommendation** and **References** to the relevant specifications.

How the grade is computed: the score starts at 100. Every failed check subtracts a
weight set by its severity (critical 25, high 15, medium 8, low 3, info 0), and a
warning subtracts half of it. Passed, info and skipped checks subtract nothing.
The score maps to a grade: **A** from 90, **B** from 80, **C** from 65, **D** from
50, otherwise **F**. If the server never answers at all, nothing can be verified,
so the grade is F with a score of 0 and the report says it could not reach the
server. A scan that was cancelled, or whose lists were cut at the scan limit, is
marked as a partial result.

Credentials never appear in a finding. Credential headers are replaced by name,
and every credential value seen on the wire (your Authorization header, API keys,
the OAuth token) is scrubbed from the evidence, the live findings and the report.

**Save HTML report…** writes the report as one self-contained HTML file. It repeats
the "authorized servers only" warning and states that the result comes from
automated, heuristic checks of one server at one moment, and is not a penetration
test or a certification. The scan result lives in the tab; it is not saved with the
request.

## Disconnecting

Click **Disconnect** to close the transport. For stdio this also terminates the
subprocess. The lists are cleared.

## Multi-tab isolation

Each MCP tab keeps its own connection, transport, lists, selection, result and
messages. Open several tabs to compare two server implementations side by side,
or to keep a long-running stdio server connected while iterating against an HTTP
one. Closing the tab disconnects it.

## Security notes

- **stdio transport spawns processes.** Only invoke commands you trust —
  Testnizer cannot sandbox the child process beyond what the host OS provides.
  The Runner, Test Suites and the Scheduler start a stdio server only if you
  have connected to that exact command (including its environment) from the MCP
  tab on this computer; a project pulled from git cannot run commands on its
  own.
- **Remote MCP servers** see Testnizer's IP address and any arguments you
  pass to a tool. Treat the same as any HTTP API call to an external service.
- **No secrets are sent automatically.** Credentials go out only for the
  authentication you set on the **Authorization** tab (No Auth, Basic, Bearer,
  API Key or OAuth 2.1) or in the headers you add.
- **Your OAuth client secret is not sent to a host you did not expect.** The
  debugger asks first when the authorization server is on another host; see
  [OAuth 2.1 debugger](#oauth-21-debugger).
