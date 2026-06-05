---
title: Features
description: A complete reference of everything Testnizer does — protocols, auth, variables, testing, runner, mocking, import/export, code generation, and the built-in tools.
order: 3
section: Getting started
---

The full capability surface of Testnizer, grouped by area. Everything below runs
**100% locally** — no account, no cloud, no telemetry. For deeper pages, follow
the links in each section.

## Protocols

Every protocol is a first-class request type with its own editor, response
panel, and Node-side engine — not a plugin. See [Protocols overview](/docs/protocols).

| Protocol | Highlights |
|---|---|
| HTTP / REST | Methods, body modes, redirects, timeout, mTLS, scripts, assertions |
| SOAP / WSDL | WSDL import, manual envelope, operation picker |
| WS-Security | UsernameToken, Timestamp, RSA-SHA256 signing, encryption — see [WS-Security](/docs/ws-security) |
| GraphQL | Query, mutation, subscription, schema introspection |
| gRPC | Proto load + **server reflection**, all four streaming modes |
| WebSocket | `wss`, custom headers, JSON composer, bidirectional timeline |
| Socket.IO | Namespaces, `auth.token`, emit + subscribe, event timeline |
| SSE | Long-lived streams, named events, `Last-Event-ID` resume |
| MCP | Streamable HTTP / SSE / stdio; list + invoke tools |
| AI Chat | Multiple LLM providers + custom URL, streaming, tools bridge |

## Building requests

- Method + URL bar with live **query-param ↔ URL** sync
- **Headers** with bulk edit
- **Body** modes: raw / JSON / XML / HTML / text, **form-data** (file upload),
  **x-www-form-urlencoded**, **binary**
- Per-request timeout, redirect following (max redirects), SSL verification toggle
- Pre-request and post-response **script** tabs

## Authentication

Basic · Bearer Token · API Key (header or query) · OAuth2 · Digest · NTLM ·
Hawk · AWS Signature.

## Variables & environments

See [Environments & variables](/docs/environments).

- **Environments** scoped per project, with a dual **Initial / Current Value** model
- **Global variables** at workspace and project scope
- `{{variable}}` substitution with chained references
- **Dynamic values**: `{{$randomInt}}`, `{{$guid}}`, `{{$timestamp}}` and more
- Inline variable autocomplete

## Testing & assertions

Code-free assertions: status equals, status in range, body contains, header
exists / equals / contains, response time under, response size under. Assertion
values themselves resolve `{{variables}}`. See [Scripts & test assertions](/docs/scripts).

## Scripting

Postman / Insomnia-compatible `pm.*` API in a sandboxed runtime:

- `pm.environment` / `pm.globals` / `pm.variables` / `pm.collectionVariables` get & set
- `pm.test()`, `pm.expect()` (chai-BDD chain), `pm.response`
- `pm.iterationData`, `pm.execution.skipRequest()` / `setNextRequest()`

## Running collections

See [Collection runner & automation](/docs/cli-and-automation).

- Sequential multi-request runs, **iterations** + **data-driven** rows (CSV / JSON)
- Delay between requests, stop-on-error, environment selection
- **HTML & JSON** reports, run history + statistics
- **Scheduler** for recurring runs
- Right-click **Run** on any folder or collection
- **Test Suites** — sets built from multiple collections, each item a full request snapshot

## Mock server

Local rule-based HTTP mock server with `{{variable}}` templating, conditional
rules, scripted responses, auth, rate limiting, failure injection, and schema
validation. See [Mock Server](/docs/mock-server).

## Import & export

See [Import & export](/docs/import-formats).

- Import: **OpenAPI / Swagger**, **Postman**, **Insomnia**, **HAR**, **cURL**,
  **WSDL**, **RAML**, **SoapUI**, **Testnizer Native** — with auto format detection
- Export: full project or folder subtree, lossless round-trip

## Code generation

Generate a ready-to-paste request snippet in **cURL**, **JavaScript** (fetch /
axios), **Python** (requests), **Java** (OkHttp), **C#**, **Go**, **PHP**,
**Ruby**, **Kotlin**, and **Swift**.

## Built-in tools

Offline, browser-safe utilities — see [Built-in tools](/docs/built-in-tools) and
the [JWT Debugger](/docs/jwt-debugger):

JWT · JSONPath · XPath · XSLT · Hash · HMAC · Encoders (Base64 / URL) ·
Base converter · Regex tester · Diff · Epoch / timestamp · UUID generator ·
JSON ↔ XML · YAML ↔ JSON · Jolt transform · JSON Schema · JSON / XML formatter ·
HTTP status reference · WS-Security helper.

## Organization & version control

- **Workspaces → Projects → Branches** hierarchy
- **Git integration** (per-project branches, conflict handling) — see [Git integration](/docs/git-branches)
- Endpoint / folder tree with drag-and-drop ordering

## Request history

Local request history with full request/response snapshots, "Today" grouping,
and a detail panel. See [Request history](/docs/history).

## Response viewing

- Status / timing / size metadata, Monaco JSON syntax highlighting
- Response · Cookies · Headers · Console · **Actual Request** tabs
- Timing breakdown (DNS / TCP / TLS / TTFB / download)

## Certificates & TLS

mTLS / client certificates, TLS presets, **Legacy TLS** routing for old servers,
custom truststore, and encrypted passphrase storage. See [Certificates](/docs/certificates).

## Security & privacy

- Optional **password** protection for local data
- EULA / privacy consent on first run
- `contextIsolation` on, `nodeIntegration` off, strict CSP — the UI never touches
  the network directly; all traffic goes through the Node main process
- URL credential scrubbing in history. See [Why offline?](/docs/why-offline).

## Platform

- **Windows, macOS, Linux** (x64 + arm64)
- **Standalone & 100% offline** — zero external dependencies
- Local **SQLite** storage, encrypted config
- **Auto-update** built in
- Native open / save / message dialogs
