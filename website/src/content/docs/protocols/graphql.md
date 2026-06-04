---
title: GraphQL
description: Run queries, mutations, and subscriptions with schema introspection and type-safe variable editors.
order: 4
section: Protocols
---

Testnizer's GraphQL editor understands the difference between HTTP-only
endpoints and servers that support the `graphql-ws` subscription transport,
and routes each operation type accordingly.

> **Multi-tab:** URL, query, variables, headers, and response are stored per-tab. The introspected schema is **shared** across all tabs pointing at the same endpoint — introspect once, use everywhere.

## Creating a GraphQL request

Click **+ New** → **GraphQL**. The editor opens with an empty operation pane
on the left, a variable editor below it, and a schema browser on the right.

## Endpoint URL

Paste the GraphQL endpoint URL. Variables are supported:

```
{{apiBaseUrl}}/graphql
```

## Headers

Add HTTP headers for the request, including authentication:

```
Authorization: Bearer {{accessToken}}
Content-Type: application/json   ← added automatically, override if needed
```

## Operation editor

A Monaco instance with GraphQL syntax highlighting, bracket matching, and
auto-complete powered by the introspected schema.

Write a query, mutation, or subscription:

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    email
    createdAt
    roles {
      name
    }
  }
}
```

Hit **Send** (or `Ctrl+Enter`). Testnizer detects the operation type:

- `query` / `mutation` → sent as HTTP POST (standard JSON body)
- `subscription` → connection upgraded to `graphql-ws` WebSocket transport

You can have multiple operations in the editor. Use the operation name dropdown
in the toolbar to pick which one runs.

## Variables tab

Edit JSON variables for the current operation:

```json
{
  "id": "usr_01HXYZ"
}
```

The variable editor validates the JSON and highlights type mismatches against
the schema when introspection is available.

`{{environment}}` variables resolve inside the JSON values:

```json
{
  "id": "{{currentUserId}}"
}
```

## Schema introspection

Click **Introspect** in the schema browser header. Testnizer sends the
standard introspection query to the endpoint (using the current headers, so
auth is automatically included) and builds the type browser from the result.

The type browser is searchable. Click any type to see its fields, arguments,
and descriptions. Clicking a field in the type browser inserts it into the
operation editor at the cursor position.

Introspection results are cached per endpoint + header combination and persist
across app restarts. Hit **Re-introspect** to refresh.

If the server disables introspection (common in production), you can paste a
schema SDL file directly:

1. Click **Load schema from file** in the schema browser
2. Pick a `.graphql` or `.sdl` file
3. Testnizer uses the file for auto-complete and type checking

## Subscriptions

Testnizer automatically upgrades to a WebSocket connection when the operation
is a `subscription`. The connection uses the `graphql-ws` protocol
(`Sec-WebSocket-Protocol: graphql-ws`).

The subscription timeline behaves the same as the WebSocket editor — events
appear as they arrive, you can pause, filter, and inspect individual payloads.

A **Stop** button appears while the subscription is active. Clicking it sends a
`complete` message and closes the WebSocket. The connection also closes when you
close the tab.

For servers that use the older `subscriptions-transport-ws` protocol, toggle
the **Legacy WS** option in the request settings (gear icon).

## HTTP details

For queries and mutations, the request is a POST with:

```json
{
  "query": "...",
  "variables": { ... },
  "operationName": "GetUser"
}
```

The **Console** tab shows the raw HTTP request and response so you can verify
exactly what was sent.

## Persisted queries (APQ)

Turn on **Automatic Persisted Queries** in the request settings to send the
query hash first and fall back to the full query on a `PersistedQueryNotFound`
error. Testnizer handles the two-step exchange automatically.

## Response

The response body is formatted JSON shown in Monaco. GraphQL `errors[]` in the
response body are **highlighted** in the response pane — each entry shows the
`message` and `path` (if present). This is separate from HTTP-level errors; a
`200 OK` response can still contain GraphQL errors.

The **Headers** and **Console** tabs are available for debugging network-level
issues.

## Cancelling in-flight requests

For queries and mutations, a **Cancel** button appears while the request is in
flight. Clicking it sends a cancel signal to the engine; the tab returns to idle
state immediately.
