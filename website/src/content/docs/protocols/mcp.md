---
title: MCP (Model Context Protocol)
description: Testnizer is an MCP client. Connect to MCP servers over Streamable HTTP, SSE, or stdio; call tools, read resources, fetch prompts, watch notifications and scan the server.
order: 9
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
  falls back to MCP 2025 (`initialize`).
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

**Paste config…** (the menu next to Connect) imports a server from a Claude
Desktop, VS Code (`.vscode/mcp.json`) or Cursor (`.cursor/mcp.json`) config, or
a single server object. **Export config** writes the current server in the same
formats; the output may contain secrets, so Testnizer says so.

## The capability list

The left panel has **Tools**, **Resources** and **Prompts** tabs with counts and
a search box (name, description, URI). Resource **templates** are listed under
Resources. Selecting an entry opens it in the **Explorer**.

## Calling a tool

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
3. Click **Run**. If the arguments do not match the schema, Testnizer lists the
   problems and offers **Invoke anyway**.
4. The result appears below as **JSON** or **Preview** (text, images, audio,
   embedded resources, structured content). A tool that reports `isError` is
   shown as **Tool error**. A running call can be cancelled; the connection
   stays open.

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
  **OAuth 2.1**. The OAuth 2.1 option walks the whole flow step by step —
  discovery, client registration, PKCE, browser sign-in and token exchange —
  shows where it breaks, and then **Connect with token**. The token stays in
  Testnizer's main process memory: it is never shown or saved. Not used for
  stdio.
- **Headers** — custom headers for Streamable HTTP and SSE.
- **Environment** — environment variables for the stdio server process.
- **Scripts / Tests** — the same pre-request and post-response scripts and
  assertions as an HTTP request. The result is available as `pm.response`
  (200 for a result, 500 for a tool error) and `pm.mcp`.
- **Settings** — request timeout in ms (empty = default 120 s, `0` = no limit).

Calls are saved with the request (Ctrl+S) and recorded in History with
credentials masked.

## Security scan

The **Security** tab next to the Explorer runs an offline A–F scan of the server
(Streamable HTTP and SSE only): transport security, authorization, protocol
conformance, prompt-injection and tool-poisoning heuristics, information
disclosure, CORS, security headers and rate limiting. It uses this tab's headers
and OAuth token, shows findings by category with a recommendation each, and can
save an **HTML report**. **Scan only servers you are authorized to test.**

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
- **Your OAuth client secret is not sent to a host you did not expect.** In the
  OAuth debugger, a manual client with a **client secret** talks to the
  authorization server the MCP server itself advertises. If that server, or its
  token endpoint, is on a **different host** than the MCP server, the debugger
  stops before opening the browser and asks: **Send your client secret to this
  authorization server?** It shows the **MCP server**, **Authorization server**
  and **Token endpoint** origins, and your secret goes there only after
  **Confirm and continue**; **Cancel** ends the flow with a clear step error.
  The answer is remembered for that combination of hosts until Testnizer closes —
  any other host asks again — and a token refresh never asks. Same-host
  authorization servers, public clients and dynamic client registration do not
  prompt. The secret itself never reaches the screen layer.
