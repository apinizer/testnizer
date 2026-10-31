---
title: Protocols overview
description: Quick reference for HTTP, SOAP, WebSocket, GraphQL, gRPC, SSE, Socket.IO, MCP and AI Chat in Testnizer.
order: 1
section: Protocols
---

Testnizer treats every protocol as a first-class request type, not a plugin or
add-on. Each one has a dedicated editor, dedicated response panel, and
dedicated engine in the Node main process.

## At a glance

| Protocol | Editor | Engine | Notes |
|---|---|---|---|
| HTTP / REST | full | `axios` | Methods, body modes, mTLS, scripts, assertions |
| SOAP | full | `soap` library + `wsse` | WSDL import, manual envelope, WS-Security |
| WebSocket | full | `ws` | wss + custom headers + JSON composer |
| GraphQL | full | `graphql` + `graphql-ws` | Query + mutation + subscription |
| gRPC | full | `@grpc/grpc-js` + `@grpc/proto-loader` | All four streaming modes |
| SSE | full | `eventsource` | Long-lived streams, Last-Event-ID resume |
| Socket.IO | full | `socket.io-client` | Namespaces, auth, emit + subscribe, bidirectional timeline |
| MCP | full | `@modelcontextprotocol/sdk` | Streamable HTTP / SSE / stdio; list and invoke tools |
| AI Chat | full | provider-specific HTTP | 14 providers + custom URL, streaming |

## HTTP

The default. Pick a method, set the URL, optionally add headers / body / auth.
Hit Send.

Body modes:

- **none** — no body
- **raw** — text with content-type chooser (JSON, XML, plain, custom)
- **form-data** — `multipart/form-data`, supports text and file fields
- **x-www-form-urlencoded** — URL-encoded key/value pairs
- **binary** — file upload as the entire body, content-type from extension

Auth modes: Basic, Bearer, API Key (header / query / cookie), Digest, NTLM,
Hawk, AWS Signature v4, OAuth 1.0, OAuth 2.0 (full flow), Inherit auth from
parent collection.

[Full reference →](/docs/protocols/http)

## SOAP

Two starting points:

- **From WSDL** — paste a URL or pick a file. Testnizer parses services,
  ports, and operations, then generates an example envelope per operation
- **Manual** — write the envelope by hand. Useful for debugging or for
  services without a WSDL

WS-Security is built in (UsernameToken, Timestamp, XML Signature, XML
Encryption). [WS-Security guide →](/docs/ws-security)

## WebSocket

Connect to `ws://` or `wss://` with custom headers. Messages appear in a
timeline (sent + received with timestamps). Compose messages as JSON or text.

[Full reference →](/docs/protocols/websocket)

## GraphQL

Query, mutation, and subscription support. Testnizer detects whether your
endpoint speaks HTTP-only or supports `graphql-ws` (subscription transport)
and routes accordingly.

Schema introspection runs on demand and populates a searchable type browser
on the right of the request editor.

[Full reference →](/docs/protocols/graphql)

## gRPC

Pick a `.proto` file. Testnizer enumerates services and methods, generates
JSON skeletons for request messages, and lets you fill them in.

Streaming modes:

- **Unary** — single request, single response
- **Server-streaming** — single request, response stream
- **Client-streaming** — request stream, single response
- **Bidirectional** — both streaming

Metadata (request and response) is editable. TLS / mTLS uses your
project's certificate store.

[Full reference →](/docs/protocols/grpc)

## Server-Sent Events

Hit Send on an SSE endpoint and Testnizer holds the connection open, parsing
events as they arrive. The Last-Event-ID header is set automatically on
reconnect, so the server can resume from where it left off.

## Socket.IO

Connect to a Socket.IO server with a namespace and an optional bearer token.
The official `socket.io-client` runs in the main process — Testnizer negotiates
the WebSocket transport with HTTP long-polling fallback, the renderer just
displays events.

Workflow:

- Set the URL (e.g. `http://localhost:3000`), namespace (`/` or `/admin`), and
  optional bearer token
- Click **Connect** — Testnizer waits for the `connect` ack, surfaces
  `connect_error` if the handshake fails
- **Emit** any event with a JSON payload (event name + body)
- **Subscribe** to any event name; incoming events stream into the timeline
- Bidirectional timeline shows `↑` for outgoing emits and `↓` for incoming
  events, with timestamps

[Full reference →](/docs/protocols/socketio)

## MCP (Model Context Protocol)

Testnizer is an MCP **client**. It connects to MCP servers, discovers their
tools, and invokes them with arguments — the same role Claude Desktop plays
when it calls a tool. Built on the official `@modelcontextprotocol/sdk`.

Three transports:

- **Streamable HTTP** — for remote MCP servers exposing the modern HTTP
  transport (e.g. `https://mcp.example.com/mcp`)
- **SSE (legacy)** — for older HTTP+SSE-based MCP servers
- **stdio** — Testnizer launches the server as a local subprocess. Enter the
  full command (e.g. `npx @modelcontextprotocol/server-everything`)

After connecting, the **Tools** panel lists every tool the server advertises
along with its input schema. Pick a tool, fill in the JSON arguments, click
**Invoke**, and inspect the structured result.

[Full reference →](/docs/protocols/mcp)

## AI Chat

Pick a provider (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq,
Perplexity, Cerebras, Cohere, Fireworks, DeepInfra, Together, OpenRouter) or
choose **Custom URL** for self-hosted vLLM / LM Studio / Ollama / TGI.

Conversations are multi-turn with a system prompt. Responses stream by default.
Variables (`{{apiKey}}`) resolve in URL, headers, and body — useful for
keeping API keys in a project environment rather than the request itself.
