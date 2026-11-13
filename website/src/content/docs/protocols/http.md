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
[mock servers](/docs/mock-server/http).

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
`Host`, `Content-Length`, or `User-Agent`. In the auto-complete list, Tab or Enter
takes a suggestion only after you have picked it with the arrow keys; typing
`Authorization` and pressing Tab keeps what you typed.

Under your rows, **Auto-generated headers** lists the headers Testnizer will add
itself, and where each comes from: **Auth** (the Authorization header or API key of
the effective auth, inherited auth included), **Engine** (`Accept`, `User-Agent`,
`Host`, `Content-Type` implied by the body, `Content-Length`) and **Cookie** (cookies
from the cookie jar). Values only known at send time say "calculated at send", and
auth values are masked. A header you add with the same name, in any letter case,
overrides the automatic one, and the row is marked **Overridden**.

## Body tab

![Body tab with a raw JSON body that uses a {{customerId}} variable, and the 201 Created response](/docs/screenshots/http-request-body.png)

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
folder on this computer. A file outside that folder, an absolute path included, is read
only if you picked it yourself in the Body tab or turned on **Read files outside the
working directory** in the same settings page, so an imported project cannot upload
any file from your computer. If a request has a
relative path and no working directory is set, Send fails with a message that
names the setting. The working directory is a per-computer setting: it is not
saved with the project or pushed to Git, because a folder on one machine means
nothing on another. The other setting stays on this computer too. Both apply to Send, the Collection Runner, Test Suites and
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

![Post-response script with three pm.test checks and the Test Results panel showing all three passed](/docs/screenshots/http-tests-results.png)

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
- With **Include secret values** off, passwords, tokens and API keys you typed in
  headers, query parameters, form bodies and auth (inherited auth included) appear as
  `***` in the snippet; `{{variables}}` stay readable

Generate Code covers **HTTP, GraphQL and SOAP** tabs: a GraphQL tab produces the
POST with its JSON body, and a SOAP tab the POST with the envelope and the
`SOAPAction` or SOAP 1.2 `Content-Type`. For a WebSocket, Socket.IO, MQTT, MCP,
gRPC, SSE or AI Chat tab the pane says that code generation is not available,
rather than showing a stale HTTP request.

## Request settings

The **Settings** tab of the request holds **Request timeout**, **Follow redirects**,
**Max redirects**, **Enable SSL certificate verification** and **Critical request**.
They are saved with the request (Ctrl+S) and behave the same on Send and on Run.

Timeout, SSL verification and redirects **inherit**: request, then
**Project Settings**, then app **Settings**. A request that never changed a switch
follows the project; the tab shows where the current value comes from ("Inherited from
project settings: on") and offers **Use project settings** to go back. A value you set
explicitly on the request keeps your choice. An empty timeout inherits, and `0` means no
timeout. To inspect a redirect response, turn off **Follow redirects**.

**Critical request.** Tick it and a run (Runner, Test Suite, Scheduler) stops when that
request fails or cannot run, whatever "Stop run if an error occurs" says. The results,
run history and HTML / JSON reports name the critical request that stopped the run. You
can also toggle it from the run sequence while planning a run.

## Proxy

A custom proxy set in **Project Settings** or app **Settings → Network** applies to HTTP
requests; a project without its own proxy uses the app's. **Bypass for hosts** lists hosts
that go out directly. **Use system proxy** reads the `HTTP_PROXY`, `HTTPS_PROXY` and
`NO_PROXY` environment variables. SOCKS is not supported: a request set to use it fails
with a message instead of going out directly. See the
[FAQ](/docs/faq#does-testnizer-support-proxy-servers).

## Saving and tabs

Ctrl+S saves the open request in place and shows "Request saved"; a new request is named
after its URL when you first save it ("users", not "New Endpoint"). In the APIs tree a
single click opens a request in a preview tab and a double-click opens it in a pinned tab
(or pins the preview already showing it). Each open tab remembers its request sub-tab.
Passwords, tokens and credential headers you type are not kept in the app's browser
storage after a restart unless the request is saved; use a `{{variable}}` to keep them
without saving.

## TLS / mTLS

Client certificates are configured per-project in **Settings → Certificates**.
Testnizer picks the right certificate based on the hostname pattern you
specify. See the [Certificates guide](/docs/certificates).

To accept a self-signed CA without modifying your OS trust store, add the
CA certificate in the same panel.
