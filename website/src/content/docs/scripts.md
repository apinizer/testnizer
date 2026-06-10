---
title: Scripts and test assertions
description: Pre-request scripts, test scripts, the pm API, folder/project script cascade, and built-in OAuth 2.0 for Testnizer.
order: 4
section: Guides
---

Testnizer runs JavaScript before and after a request, with a Postman-compatible
`pm` API. Scripts power dynamic values, variable chaining, signing, and test
assertions.

Each request has two script slots:

- **Pre-request script** — runs *before* the request is sent. Use it to compute
  values, set variables, or add headers.
- **Tests** (post-response) — runs *after* the response arrives. Use it to
  assert on the response and capture values for the next request.

Folders and the project can carry scripts too — see
[Script cascade](#script-cascade) below.

## The script runtime

Scripts run in a small JavaScript sandbox. These globals are available **in both
Send and the Collection Runner** (they behave identically):

| Global | What it is |
|---|---|
| `pm` | The main API (everything below). |
| `t` | Testnizer-branded alias of `pm` — `t.environment.set(...)` works too. |
| `insomnia`, `bru` | Aliases of `pm`, so scripts imported from Insomnia/Bruno run unchanged. |
| `console` | `console.log/warn/error` — output shows in the **Console** tab. |
| `CryptoJS` | [crypto-js](https://github.com/brix/crypto-js) for HMAC / SHA / AES / Base64. |

> **There is no `require()` and no Node modules.** Scripts are sandboxed — you
> cannot `require('crypto')`, `require('fs')`, or import npm packages. For
> hashing and signing use the built-in **`CryptoJS`** global (examples below).

Scripts can be **async** — you may `await` inside them (e.g.
`await pm.sendRequest(...)`). Testnizer waits for all pending work before the
request is sent (pre-request) or the run finishes (tests).

## pm API reference

### pm.environment / pm.globals / pm.collectionVariables

Read and write variables. `environment` is the active environment, `globals` are
project-wide, `collectionVariables` share the project environment.

```js
pm.environment.get('baseUrl')          // → string | undefined
pm.environment.set('token', 'abc123')  // set (creates the variable if new)
pm.environment.has('token')            // → boolean
pm.environment.unset('token')          // delete
pm.environment.toObject()              // → { key: value, ... } snapshot
```

Writes from a **pre-request** script are visible to the request URL, headers,
and body. Writes from a **test** script are **persisted** to the active
environment (Postman's "Keep variable values"), so a token captured in one
request is available to the next request and shows up in the environment editor.

### pm.variables

Merged read view (local → environment → global) plus a request-local scratch
scope that is **not** persisted:

```js
const baseUrl = pm.variables.get('baseUrl')   // resolved from any scope
pm.variables.set('tempSig', sig)              // request-local only
pm.variables.toObject()                       // merged snapshot
```

### pm.request (pre-request only)

```js
pm.request.method                  // 'GET', 'POST', …
pm.request.url.toString()          // full URL string
pm.request.body.raw                // raw body string

// Add / replace a header on the outgoing request
pm.request.headers.add({ key: 'X-Nonce', value: nonce })
pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + token })
```

### pm.response (tests only)

```js
pm.response.code                   // 200, 404, … (number)
pm.response.status                 // 'OK', 'Not Found', … (status text)
pm.response.responseTime           // ms (number)
pm.response.text()                 // body as string
pm.response.json()                 // body parsed as JSON (null if not JSON)
pm.response.headers.get('Content-Type')

// Cookies the server set (Set-Cookie), case-insensitive:
pm.response.cookies.get('session')     // → value | undefined
pm.response.cookies.has('session')     // → boolean
pm.response.cookies.toObject()         // → { name: value, ... }
```

### pm.test / pm.expect

```js
pm.test('status is 200', function () {
  pm.response.to.have.status(200)
})

pm.test('user has id and email', function () {
  const body = pm.response.json()
  pm.expect(body).to.have.property('id').that.is.a('number')
  pm.expect(body.email).to.match(/@/)
})
```

Common assertions:

```js
pm.expect(value).to.equal(expected)
pm.expect(value).to.deep.equal({ key: 'val' })
pm.expect(value).to.include('substring')
pm.expect(value).to.be.above(0)
pm.expect(value).to.be.a('string')
pm.expect(arr).to.have.lengthOf(3)
pm.expect(obj).to.have.property('name')
```

Shorthand response assertions:

```js
pm.response.to.have.status(200)
pm.response.to.have.status('OK')
pm.response.to.have.header('Content-Type')
pm.response.to.have.jsonBody('id', 42)
pm.response.to.be.ok          // 2xx
```

### pm.sendRequest

Fire an auxiliary HTTP request mid-script — for fetching a token, polling, or
setup. Returns a Promise (so you can `await` it) and also supports a Node-style
callback. The host waits for it to finish before continuing.

```js
// await form
const res = await pm.sendRequest('https://api.example.com/health')
pm.expect(res.code).to.equal(200)

// full request object
const tokenRes = await pm.sendRequest({
  url: 'https://idp.example.com/oauth/token',
  method: 'POST',
  header: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: { mode: 'raw', raw: 'grant_type=client_credentials' },
})
pm.environment.set('accessToken', tokenRes.json().access_token)

// callback form
pm.sendRequest('https://api.example.com/ping', function (err, res) {
  if (!err) console.log('pong', res.code)
})
```

The response exposes `.code`, `.status`, `.json()`, `.text()`,
`.headers.get(name)`, and `.cookies.get(name)`.

### pm.execution

```js
pm.execution.skipRequest()                   // skip this request (pre-request only)
pm.execution.setNextRequest('Request name')  // jump to a named request (runner)
pm.execution.setNextRequest(null)            // stop the run after this request
```

### pm.iterationData (data-driven runs)

When the Collection Runner iterates over a CSV/JSON data file, each row is
exposed here:

```js
const userId = pm.iterationData.get('userId')
```

## Script cascade

Scripts don't only live on a request. They run top-down through the hierarchy:

```
project → outer folder → inner folder → request
```

- **Pre-request** scripts run in that order before each request.
- **Test** scripts run in that order after each response.

Configure them in:

- **Project Settings → Scripts** (project-level), and
- **right-click a folder → Settings → Scripts** (folder-level).

This is ideal for cross-cutting setup — e.g. a project pre-request script that
refreshes a token once, inherited by every request below it. The cascade applies
to both **Send** and **Run**.

## Auth inheritance

A request's **Auth** tab has an **Inherit from parent** option (the default for
new requests). The effective auth is resolved nearest-wins:

```
request → nearest folder → project
```

Set a `Bearer {{accessToken}}` (or any auth) once on a folder
(right-click → **Settings → Authorization**) or in **Project Settings →
Authorization**, leave the requests on **Inherit**, and they all pick it up. An
explicit **No Auth** on a request or folder stops the inheritance.

## OAuth 2.0 without a script

For the common "fetch a token, then call the API" flow you usually **don't need
a script at all**. On the **Auth** tab pick **OAuth 2.0**, choose
**Client Credentials** (or **Password**) grant, and fill in the token URL,
client id/secret, and scope. Testnizer fetches the token automatically before
the request and **caches it** until it nears expiry — refetching as needed.

Combine it with [auth inheritance](#auth-inheritance): set OAuth 2.0 on the
folder/project once, leave the requests on **Inherit**, and every request gets a
fresh token with zero scripting. Use **Get New Access Token** on the Auth tab to
fetch + inspect a token up front.

> Browser-redirect grants (Authorization Code, Implicit) aren't automated yet —
> paste a token, or use Client Credentials / Password for fully automatic
> tokens.

## Recipes

### HMAC signature (pre-request) — with CryptoJS

```js
const secret = pm.environment.get('signingSecret')
const ts     = String(Date.now())
const body   = pm.request.body.raw || ''
const sig    = CryptoJS.HmacSHA256(ts + '\n' + body, secret).toString()

pm.request.headers.upsert({ key: 'X-Timestamp', value: ts })
pm.request.headers.upsert({ key: 'X-Signature', value: 'sha256=' + sig })
```

### Capture a token from the response (tests)

```js
const json = pm.response.json()
pm.environment.set('accessToken', json.access_token)
pm.test('token captured', function () {
  pm.expect(json.access_token).to.be.a('string').and.not.empty
})
// Later requests use {{accessToken}} — or just use OAuth 2.0 auth (above).
```

### Read a cookie the server set

```js
const session = pm.response.cookies.get('session')
pm.environment.set('sessionId', session)
```

### Retry / repeat on 429 (runner)

```js
if (pm.response.code === 429) {
  pm.execution.setNextRequest(pm.info.requestName) // repeat this request
}
```

### Base64 / SHA with CryptoJS

```js
const b64  = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse('user:pass'))
const hash = CryptoJS.SHA256('payload').toString()
```

## Script errors

If a script throws, that script is aborted and the error appears in the
**Console** tab. Test cases that ran before the error are still recorded.
Because there is no `require()`, the most common error is reaching for a Node
module — use `CryptoJS` (or `pm.sendRequest`) instead.
