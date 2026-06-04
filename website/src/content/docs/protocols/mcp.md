---
title: MCP (Model Context Protocol)
description: Testnizer is an MCP client. Connect to MCP servers over Streamable HTTP, SSE, or stdio; list and invoke tools.
order: 9
section: Protocols
---

The **Model Context Protocol** is the open spec — published by Anthropic and
adopted by Claude Desktop, IDE extensions, and other AI hosts — that lets a
language-model host talk to external **tools** in a standard way. An MCP
server exposes a list of tools (with JSON schemas for their inputs); an MCP
client (Testnizer, in this case) discovers them and invokes them.

Testnizer is an MCP **client**. It connects to MCP servers, lists their tools,
and lets you invoke any tool with arguments. Use it to:

- Verify that a new MCP server you're building responds correctly to the
  protocol handshake and `tools/list`.
- Try out a third-party MCP server before wiring it into Claude Desktop.
- Smoke-test tool invocations during development without spinning up a host.

Testnizer is built on the official `@modelcontextprotocol/sdk`, so the wire
protocol is bit-for-bit identical to what other hosts speak.

## Opening an MCP tab

Click **+ New** → **MCP**. The editor opens with a transport selector, a URL
or command field, a Connect button, and an empty tools list.

## Choosing a transport

MCP defines three transports. Testnizer supports all of them.

### Streamable HTTP

The current MCP HTTP transport. Use this for remote MCP servers exposed at a
URL like `https://mcp.example.com/mcp`.

- **Transport**: `Streamable HTTP`
- **URL**: the full server URL (path included)
- **Connect** kicks off the handshake — Testnizer is identified as
  `Testnizer / 1.0.0` to the server.

### SSE (legacy)

The earlier HTTP+SSE-based transport, kept for compatibility with older
servers. Use this if the server documentation explicitly mentions SSE.

- **Transport**: `SSE (legacy)`
- **URL**: the SSE endpoint URL

### stdio (local subprocess)

For MCP servers distributed as command-line tools (e.g. on npm). Testnizer
**spawns the server as a child process** and speaks JSON-RPC over its
stdin/stdout — no network involved.

- **Transport**: `stdio (local)`
- **URL field**: the full command line, e.g.
  `npx @modelcontextprotocol/server-everything` or
  `node /path/to/my-mcp-server.js`

The first whitespace-separated token is treated as the executable; the rest
are passed as arguments. Environment variables are inherited from Testnizer's
process environment.

## Connecting

Click **Connect**. Testnizer:

1. Opens the chosen transport (HTTP request, SSE stream, or subprocess).
2. Performs the MCP initialize handshake.
3. On success, the server's reported name and version (`getServerVersion()`)
   appear next to the Connect button, which becomes a red **Disconnect**.
4. The tools list on the left auto-populates from `tools/list`.

Tools are **auto-listed** immediately after a successful connection — you
don't need to click a separate "List tools" button.

If the handshake fails, the error is shown beside the connection bar
(unreachable URL, command not found, version mismatch, etc.).

## The tools list

Every tool the server advertises appears in the left panel:

- **Name** — the tool identifier the model would reference
- **Description** — the human-readable description from the server, if
  provided
- **Input schema** — when you select a tool, its JSON Schema is rendered above
  the arguments textarea so you can see what the server expects

## Invoking a tool

1. Click a tool to select it.
2. Edit the **Arguments (JSON)** textarea. When you select a tool that has an
   input schema, Testnizer **automatically pre-fills the arguments** textarea
   with a skeleton JSON generated from the schema — strings become `""`,
   numbers become `0`, booleans become `false`, arrays become `[]`, and enums
   get the first value. Edit the values you need; the rest can stay at their
   zero values. Variables resolve here too
   (`{"path": "{{workspaceRoot}}/file.txt"}`).
3. Click **Invoke `<tool-name>`**.
4. The structured result from the server appears in the **Result** pane below.
   MCP results are returned as a typed payload (text, JSON, image references,
   etc.), all pretty-printed.
5. If the server returns an error (validation failure, runtime error, etc.),
   the error message is shown in red instead of the result.

## Disconnecting

Click **Disconnect** to close the transport. For stdio transports this also
terminates the subprocess. The tools list is cleared; the last result is
preserved on screen until the next invocation.

## Multi-tab isolation

Each MCP tab maintains its own connection, transport choice, tools list,
selected tool, and last result. Open multiple tabs to compare two MCP server
implementations side by side, or to keep a long-running stdio server connected
in one tab while iterating against an HTTP server in another.

## Security notes

- **stdio transport spawns processes.** Only invoke commands you trust —
  Testnizer cannot sandbox the child process beyond what the host OS provides.
- **Remote MCP servers** see Testnizer's IP address and any arguments you
  pass to a tool. Treat the same as any HTTP API call to an external service.
- **No secrets are sent automatically.** Authentication for HTTP MCP servers
  must be wired into the URL itself (e.g. with a token in a query parameter)
  if your server requires it; native MCP auth flows are evolving and will be
  added as the spec stabilises.
