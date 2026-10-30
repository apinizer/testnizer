---
title: HTTP / REST
description: Complete reference for HTTP requests in Testnizer — methods, auth, body modes, scripts, and assertions.
order: 2
section: Protocols
---

The HTTP editor covers every HTTP method, every body type, every auth scheme in
common use, and a scripting layer that runs on the Node main process — not in
your browser sandbox.

## Methods

GET · POST · PUT · PATCH · DELETE · HEAD · OPTIONS · QUERY · CONNECT · TRACE,
plus any custom method string you type in the method picker.

**QUERY** is the safe, idempotent method that carries a request body — the
standard answer to "GET with a body, or POST?" for reads whose parameters do
not fit in a URL. It has its own badge and is also selectable in
[mock servers](/docs/mock-server).

## URL bar

Variables resolve in real time. Type `{{baseUrl}}/users` and Testnizer shows
the resolved URL in a tooltip beneath the bar. If a variable is undefined, the
field highlights in orange.

Query parameters can be entered:

- Directly in the URL string (`?limit=10&offset=0`)
- In the **Params** tab as a key-value table (toggling a row disables that
  parameter without deleting it)

Encoded characters in the URL are decoded in the Params table automatically.

**Path variables.** A `:name` segment in the URL path (`/users/:id`) adds a row
to the **Path Variables** table under Params. Fill in the value and Send, Run,
Generate Code and the cURL export all substitute it, after the pre-request
script and before `{{variables}}` resolve. A `:name` with no value is sent
literally, as before. A Postman export writes them back as `url.variable[]`.

**Paste a cURL command.** Paste a `curl` command (bash, Windows CMD or
PowerShell) straight into the URL bar and Testnizer fills the whole request —
method, URL, params, headers, body, auth and settings. A toast shows the shell it
detected, lists anything it could not carry over, and offers **Undo**. A plain
URL pastes as text. See [cURL](/docs/import-formats#curl) for what the parser
understands.

## Auth tab

| Scheme | What Testnizer does |
|---|---|
| **No Auth** | Sends no Authorization header |
| **Inherit from parent** | Walks up the collection tree to the nearest ancestor that has auth configured |
| **Basic** | Base64-encodes `user:pass`, sets `Authorization: Basic ...` |
| **Bearer** | Sets `Authorization: Bearer <token>` |
| **API Key** | Adds the key/value to header, query string, or cookie — configurable |
| **Digest** | Full MD5/SHA-256 digest challenge-response, 401-retry included |
| **NTLM** | NTLM handshake for Windows domain / IIS endpoints |
| **Hawk** | HMAC signature per request (Hapi-style) |
| **AWS Signature v4** | Signs requests for any AWS service — access key, secret, region, service name |
| **OAuth 1.0** | HMAC-SHA1 / RSA-SHA1 signatures, nonce + timestamp |
| **OAuth 2.0** | Full authorization-code flow with a built-in redirect handler, plus client-credentials and password grant |

Variables work in every auth field. Store tokens in an environment and
reference them as `{{accessToken}}`.

## Headers tab

Key-value table with auto-complete on common header names. Rows can be
disabled individually. Testnizer never strips headers you add, including
`Host`, `Content-Length`, or `User-Agent`.

## Body tab

### none

No body. Content-Type header is not added automatically.

### raw

A Monaco editor with a content-type chooser in the toolbar:

- `application/json` — syntax highlighting, bracket matching, auto-format
- `application/xml` — XML tree coloring
- `text/plain` — plain text
- `application/javascript` — JS syntax
- `text/html` — HTML syntax
- `custom` — type any content-type string, editor stays in text mode

### form-data

`multipart/form-data` encoding. Each row can be `Text` or `File`.
File rows open the native OS file picker; the file name and MIME type are
sent in the part headers.

A file path that is **relative** (for example `data/upload.json`, as in an
imported Postman collection) is read from the project's **Working directory**:
set it in **Project Settings → General → Working directory** to an absolute
folder on this computer. An absolute path is used as it is. If a request has a
relative path and no working directory is set, Send fails with a message that
names the setting. The working directory is a per-computer setting: it is not
saved with the project or pushed to Git, because a folder on one machine means
nothing on another. It applies to Send, the Collection Runner, Test Suites and
scheduled runs alike.

### x-www-form-urlencoded

URL-encoded key-value table. Values are percent-encoded before sending.

### binary

The entire request body is a single file from disk. Testnizer sets
`Content-Type` based on the file extension (override it in the Headers tab
if needed). A relative path resolves against the project's
[Working directory](#form-data) as described above.

## Pre-request script

Runs before the request is sent. Use it to:

- Set or update environment variables (`pm.environment.set(...)`)
- Generate dynamic values (`pm.variables.set('ts', Date.now())`)
- Build a signature or HMAC from other variables
- Skip the request conditionally (`pm.execution.skipRequest()`)

```js
// Example: compute an HMAC before each send
const crypto = require('crypto')
const secret = pm.environment.get('signingSecret')
const body    = pm.request.body.raw
const sig     = crypto.createHmac('sha256', secret).update(body).digest('hex')
pm.request.headers.add({ key: 'X-Signature', value: sig })
```

Pre-request scripts run in the main process with access to `require()`.
See the [Scripts guide](/docs/scripts) for the full `pm` API.

## Tests tab

Runs after the response arrives. The `pm.test` / `pm.expect` API mirrors
Postman's so existing Postman test suites can be pasted in with minimal
changes.

```js
pm.test('status is 200', () => {
  pm.response.to.have.status(200)
})

pm.test('response is JSON', () => {
  const body = pm.response.json()
  pm.expect(body).to.have.property('id')
  pm.expect(body.id).to.be.a('number')
})

// Write a value to environment for use in the next request
pm.environment.set('userId', pm.response.json().id)
```

Pass/fail results appear in the **Tests** column of the response pane and
are persisted to history.

## Response pane

| Tab | Contents |
|---|---|
| **Body** | Monaco editor — JSON auto-formatted, XML pretty-printed, images previewed inline; PDF, audio and video play in an inline frame |
| **Headers** | Response header table with search |
| **Cookies** | Cookies set by the response, with domain/path/flags |
| **Console** | Raw request + raw response (useful when debugging redirects or unexpected headers) |
| **Actual Request** | Final resolved URL, headers, and body after variable substitution and pre-request script execution |

The status line above the tabs shows HTTP status code (colored by class),
response time (ms), and response size.

## Cookies

Testnizer keeps an automatic, **project-scoped cookie jar**. When a response
carries `Set-Cookie`, the cookie is stored and sent automatically — as a
`Cookie` header — on subsequent requests in the same project that match the
cookie's domain and path. A login request followed by an authenticated request
works with zero configuration, the way it does in a browser.

One jar per project, on every path:

- **Send**, the **Collection Runner**, **test suites**, **scheduled runs** and
  script-driven `pm.sendRequest(...)` calls all share the same jar — a login
  done via Send is visible to a Run, and a `pm.sendRequest` login benefits the
  requests that follow it.
- Different projects are **isolated** from each other: a session cookie stored
  in one project is never sent from another, even for the same host.
- **Quick Test** uses a separate, unscoped jar by design.

The jar lives in memory — restarting Testnizer clears it. Cookies set by the
current response are listed in the **Cookies** tab of the response pane with
their domain, path and flags; long values (JWT-sized tokens) wrap inside their
own column and stay selectable for copying.

## Code snippet generation

Click **Code** in the response bar (or open the **Code** pane of the right panel)
to generate a ready-to-paste snippet for the request in the active tab.

Pick a **Language**, then one of its **Variants**, and open **Options** for the
settings that variant honours. There are 20 languages and 36 variants:

| Language | Variants |
|---|---|
| cURL | bash, CMD, PowerShell |
| C | libcurl |
| C# | HttpClient, RestSharp |
| Dart | http, dio |
| Go | net/http |
| HTTP | HTTP/1.1 |
| Java | OkHttp, Unirest |
| JavaScript | Fetch, XHR, jQuery |
| Kotlin | OkHttp |
| NodeJS | Axios, Native, Request, Unirest |
| Objective-C | NSURLSession |
| OCaml | Cohttp |
| PHP | cURL, Guzzle, HTTP_Request2, pecl_http |
| PowerShell | Invoke-RestMethod |
| Python | Requests, http.client |
| R | httr, RCurl |
| Ruby | Net::HTTP |
| Rust | reqwest |
| Shell | wget, HTTPie |
| Swift | URLSession |

**Options** vary by variant and can include indent size and type, **Trim request
body**, **Follow redirects**, **Request timeout**, **Use async/await** and
**Include boilerplate**. The cURL variants have **Multi-line**, **Long option
names** (`--header`) and **Silent mode** (`-s`). A request that turns redirects
off, or has its own timeout, carries that into the snippet. **Reset to defaults**
restores the options. The selection lasts for the session.

What the snippet contains:

- The current headers, query parameters (merged into the URL before any
  `#fragment`), path variables and body, including form-data text and file
  parts, binary bodies and a GraphQL `{query, variables}` JSON body
- The auth that would actually be sent, including **auth inherited** from a
  folder or the project, as a header or the language's own API
- The `Content-Type` the body implies, unless you set one
- `{{variables}}` resolved to their current values. A **secret** variable stays
  as a `{{name}}` placeholder; tick **Include secret values** only for a
  ready-to-run command, because the copied text then holds the real values. The
  panel lists variables that could not be resolved

Generate Code covers **HTTP, GraphQL and SOAP** tabs: a GraphQL tab produces the
POST with its JSON body, and a SOAP tab the POST with the envelope and the
`SOAPAction` or SOAP 1.2 `Content-Type`. For a WebSocket, Socket.IO, MQTT, MCP,
gRPC, SSE or AI Chat tab the pane says that code generation is not available,
rather than showing a stale HTTP request.

## Follow redirects

Enabled by default. To inspect a redirect response, turn off **Follow
redirects** in the request settings panel (gear icon in the URL bar).

## TLS / mTLS

Client certificates are configured per-project in **Settings → Certificates**.
Testnizer picks the right certificate based on the hostname pattern you
specify. See the [Certificates guide](/docs/certificates).

To accept a self-signed CA without modifying your OS trust store, add the
CA certificate in the same panel.
