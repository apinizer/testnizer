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

GET · POST · PUT · PATCH · DELETE · HEAD · OPTIONS · CONNECT · TRACE, plus any
custom method string you type in the method picker.

## URL bar

Variables resolve in real time. Type `{{baseUrl}}/users` and Testnizer shows
the resolved URL in a tooltip beneath the bar. If a variable is undefined, the
field highlights in orange.

Query parameters can be entered:

- Directly in the URL string (`?limit=10&offset=0`)
- In the **Params** tab as a key-value table (toggling a row disables that
  parameter without deleting it)

Encoded characters in the URL are decoded in the Params table automatically.

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

### x-www-form-urlencoded

URL-encoded key-value table. Values are percent-encoded before sending.

### binary

The entire request body is a single file from disk. Testnizer sets
`Content-Type` based on the file extension (override it in the Headers tab
if needed).

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
| **Body** | Monaco editor — JSON auto-formatted, XML pretty-printed, images previewed inline |
| **Headers** | Response header table with search |
| **Cookies** | Cookies set by the response, with domain/path/flags |
| **Console** | Raw request + raw response (useful when debugging redirects or unexpected headers) |
| **Actual Request** | Final resolved URL, headers, and body after variable substitution and pre-request script execution |

The status line above the tabs shows HTTP status code (colored by class),
response time (ms), and response size.

## Code snippet generation

Click the `</>` icon in the request toolbar to generate a ready-to-paste
snippet:

- **cURL**
- **JavaScript (fetch)**
- **JavaScript (axios)**
- **Python (requests)**
- **Go (net/http)**
- **Java (OkHttp)**

Snippets include the current headers, auth, and body — variables resolved
to their current values at generation time.

## Follow redirects

Enabled by default. To inspect a redirect response, turn off **Follow
redirects** in the request settings panel (gear icon in the URL bar).

## TLS / mTLS

Client certificates are configured per-project in **Settings → Certificates**.
Testnizer picks the right certificate based on the hostname pattern you
specify. See the [Certificates guide](/docs/certificates).

To accept a self-signed CA without modifying your OS trust store, add the
CA certificate in the same panel.
