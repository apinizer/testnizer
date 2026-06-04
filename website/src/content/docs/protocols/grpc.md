---
title: gRPC
description: Load proto files, invoke all four streaming modes, and inspect metadata with Testnizer's native gRPC engine.
order: 5
section: Protocols
---

Testnizer uses `@grpc/grpc-js` and `@grpc/proto-loader` in the main process —
no intermediary proxy, no port forwarding.

> **Multi-tab:** Each gRPC tab loads its own proto file independently. Tabs do not share loaded services.

## Opening a gRPC tab

Click **+ New** → **gRPC**. The editor opens with a proto source picker and an
empty service browser.

## Proto source

Testnizer supports three ways to load a service definition:

### 1. File

Click **Select .proto file** and pick the file from disk. Testnizer parses the
file (including any local imports from the same directory tree) and populates
the **Service** and **Method** dropdowns.

If your proto imports other proto files by relative path, Testnizer resolves
them from the same root directory — you don't need to flatten the file.

### 2. URL

Paste a URL pointing to a `.proto` file. Testnizer fetches the file at send
time and parses it exactly as if you had loaded it from disk. Useful for
proto files hosted on a schema registry or internal artifact server.

### 3. Server reflection

If the server has the gRPC reflection service enabled, Testnizer can enumerate
services without a proto file at all. Toggle **Use server reflection** in the
connection panel and click **Fetch services**. Testnizer queries the reflection
service using the `grpc.reflection.v1` protocol with an automatic fallback to
`grpc.reflection.v1alpha` for older servers. Reflection-loaded service
definitions are cached locally.

## Server address

Enter the target in `host:port` format:

```
api.internal:443
localhost:50051
```

Leading schemes are stripped automatically — `grpc://`, `grpcs://`, `http://`,
and `https://` all work. If no port is specified, Testnizer appends `:443` when
TLS is enabled and `:80` when it is not.

**TLS / mTLS** is configured in the **Connection** panel:

| Option | Description |
|---|---|
| **Plaintext** | Unencrypted gRPC (`grpc://`) |
| **Server TLS** | Verifies server certificate using the system trust store (or a custom CA you add) |
| **Mutual TLS** | Also sends a client certificate — pick from the project's certificate store |

For server TLS without a valid CA, you can add a self-signed CA certificate
in **Settings → Certificates** and Testnizer will trust it for that hostname.

## Service and method

After loading the proto, pick a service and a method from the dropdowns.
Testnizer generates a JSON skeleton for the request message type with all
fields present (populated with zero values). Fill in the fields you care about
and clear the ones you don't need — the serializer ignores null-valued optional
fields.

## Streaming modes

### Unary

Single request, single response. Testnizer sends the request message and
displays the response in the right pane.

### Server-streaming

Single request, stream of responses. Testnizer holds the call open and appends
each response message to the timeline as it arrives. A **Cancel** button
appears while the stream is active; clicking it half-closes the client stream.

### Client-streaming

Open a stream, send multiple request messages one by one (using the **Send**
button for each), then click **Finish sending** to half-close and wait for the
single response. A **Cancel** button appears during the call; clicking it
half-closes the client stream immediately.

### Bidirectional streaming

Both client and server stream simultaneously. Use the **Send** button to push
request messages; server messages appear in the shared timeline. A **Cancel**
button appears while streaming; clicking it half-closes the client stream. Click
**Close** to finish the client half of the stream normally.

## Metadata

The **Metadata** tab lets you add gRPC call metadata (equivalent to HTTP
headers) as key-value pairs. Both request and response metadata are shown.

Common uses:

- `authorization: Bearer {{token}}`
- `x-request-id: {{$randomUUID}}`
- `grpc-timeout: 30S`

## Request and response view

Request and response messages are shown as pretty-printed JSON (the
`protobufjs` JSON representation). Enum values are shown by name, not number.
`bytes` fields are shown as Base64.

For streaming calls, each message in the timeline is individually expandable.

## Deadlines

Set a call deadline in the request settings (gear icon). Testnizer sends the
`grpc-timeout` metadata header and cancels the call if the deadline is reached,
showing a `DEADLINE_EXCEEDED` status.

## Status codes

gRPC status codes (`OK`, `CANCELLED`, `NOT_FOUND`, `UNAUTHENTICATED`, etc.)
appear in the status indicator above the response pane, colour-coded by
severity:

- `OK (0)` → green
- `CANCELLED (1)`, `NOT_FOUND (5)` → yellow
- `INTERNAL (13)`, `UNAVAILABLE (14)`, `UNAUTHENTICATED (16)`, etc. → red

## Environment variables

`{{variable}}` substitution works in the server address, metadata values, and
JSON request body at send time.
