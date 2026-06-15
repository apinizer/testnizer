---
title: Scripts and test assertions
description: Pre-request scripts, test scripts, the full pm API, built-in require() libraries, the legacy Postman interface, Insomnia/Bruno aliases, and built-in OAuth 2.0 for Testnizer.
order: 4
section: Guides
---

Testnizer runs JavaScript before and after a request, with a **complete
Postman-compatible `pm` API** backed by a shared runtime. The same runtime also
powers the **Insomnia** (`insomnia.*`), **Bruno** (`bru`/`req`/`res`), and
**legacy Postman** (`postman`, `responseBody`, `tests[...]`) interfaces — so
imported scripts run **without modification**.

Each request has two script slots:

- **Pre-request script** — runs *before* the request is sent. Use it to compute
  values, set variables, or add headers.
- **Tests** (post-response) — runs *after* the response arrives. Use it to
  assert on the response and capture values for the next request.

Folders and the project can carry scripts too — see
[Script cascade](#script-cascade) below.

## The script runtime

Scripts run in a JavaScript sandbox. These globals are available **in both Send
and the Collection Runner** (they behave identically):

| Global | What it is |
|---|---|
| `pm` | The main API (everything below). |
| `t` | Testnizer-branded alias of `pm` — `t.environment.set(...)` works too. |
| `insomnia` | Alias of `pm` with two Insomnia-specific differences — see [Insomnia & Bruno](#insomnia--bruno). |
| `bru`, `req`, `res` | Bruno's getter-based API — see [Insomnia & Bruno](#insomnia--bruno). |
| `postman` | The [legacy Postman interface](#legacy-postman-interface) (`setEnvironmentVariable`, `setNextRequest`, …). |
| `pm.expect` / `expect` | The real **Chai BDD** assertion library — the bare `expect(...)` global works too (Insomnia/Bruno style). |
| `console` | `console.log/warn/error` — output shows in the **Console** tab. |
| `CryptoJS`, `_` | [crypto-js](https://github.com/brix/crypto-js) and [Lodash](https://lodash.com) as globals. |
| `atob`, `btoa` | Base64 decode / encode. |

Scripts can be **async** — you may `await` inside them (e.g.
`await pm.sendRequest(...)`). Testnizer waits for all pending work before the
request is sent (pre-request) or the run finishes (tests).

### Built-in require() libraries

`require()` is available with a curated set of bundled libraries (there is no
arbitrary npm or Node-builtin access — these are the modules Postman ships):

```js
const _          = require('lodash')             // utility belt (also the _ global)
const moment     = require('moment')             // date parsing / formatting
const uuid       = require('uuid')               // uuid.v4(), …
const CryptoJS   = require('crypto-js')           // HMAC / SHA / AES / Base64 (also the CryptoJS global)
const cheerio    = require('cheerio')            // jQuery-style HTML/XML parsing
const Ajv        = require('ajv')                // JSON Schema validation (draft-07+)
const tv4        = require('tv4')                // legacy JSON Schema validation
const xml2js     = require('xml2js')             // XML → JS object
const parse      = require('csv-parse/lib/sync') // synchronous CSV parsing
const parseSync  = require('csv-parse/sync')      // same, newer entrypoint
const sdk        = require('postman-collection') // Postman Collection SDK types
const chai       = require('chai')               // the Chai assertion library
```

## pm API reference

### pm scopes — environment / globals / collectionVariables / variables

Each scope exposes the same setter/getter surface. `environment` is the active
environment, `globals` are project-wide, `collectionVariables` share the project
environment, and `pm.variables` is a merged read view plus a **request-local**
scratch scope that is **not** persisted.

```js
pm.environment.get('baseUrl')          // → string | undefined
pm.environment.set('token', 'abc123')  // set (creates the variable if new)
pm.environment.has('token')            // → boolean
pm.environment.unset('token')          // delete one
pm.environment.clear()                 // delete all in this scope
pm.environment.toObject()              // → { key: value, ... } snapshot
pm.environment.replaceIn('{{baseUrl}}/v1')  // resolve {{...}} against this scope
```

The same methods exist on `pm.globals`, `pm.collectionVariables`, and
`pm.variables`:

```js
pm.globals.set('apiVersion', 'v2')
pm.collectionVariables.set('nextPageToken', body.nextPage)

const baseUrl = pm.variables.get('baseUrl')   // resolved local → environment → global
pm.variables.set('tempSig', sig)              // request-local only, not persisted
pm.variables.toObject()                       // merged snapshot
```

Writes from a **pre-request** script are visible to the request URL, headers,
and body. Writes from a **test** script are **persisted** to the matching scope
(Postman's "Keep variable values"), so a token captured in one request is
available to the next request and shows up in the environment editor.

### pm.iterationData (data-driven runs)

When the Collection Runner iterates over a CSV/JSON data file, each row is
exposed here:

```js
pm.iterationData.get('userId')   // current row's column
pm.iterationData.has('userId')   // → boolean
pm.iterationData.toObject()      // → the full current row
```

### pm.info

```js
pm.info.eventName        // 'prerequest' | 'test'
pm.info.iteration        // current iteration index (0-based)
pm.info.iterationCount   // total iterations
pm.info.requestName      // the request's name
pm.info.requestId        // the request's id
```

### pm.cookies

The cookie jar shared with the request:

```js
pm.cookies.get('session')   // → value | undefined
pm.cookies.has('session')   // → boolean
pm.cookies.toObject()       // → { name: value, ... }
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

The full Postman/Newman response surface:

```js
pm.response.code                   // 200, 404, … (number)
pm.response.status                 // 'OK', 'Not Found', … (status TEXT, not the number)
pm.response.reason()               // reason phrase, e.g. 'Not Found'
pm.response.responseTime           // ms (number)
pm.response.responseSize           // bytes (number)
pm.response.size()                 // → { body, header, total } in bytes

pm.response.text()                 // body as string
pm.response.body                   // raw body string
pm.response.json()                 // body parsed as JSON — THROWS on invalid JSON (Postman-compatible)
pm.response.json(reviver)          // optional JSON.parse reviver
pm.response.jsonp()                // strip a JSONP wrapper, then parse
pm.response.dataURI()              // body as a data: URI

// Headers — case-insensitive
pm.response.headers.get('Content-Type')
pm.response.headers.has('Content-Type')
pm.response.headers.all()          // → [{ key, value }, ...]
pm.response.headers.toObject()     // → { name: value, ... }

// Cookies the server set (Set-Cookie), case-insensitive
pm.response.cookies.get('session')     // → value | undefined
pm.response.cookies.has('session')     // → boolean
pm.response.cookies.toObject()         // → { name: value, ... }
```

:::caution[code vs status, and json() throws]
This matches Postman/Newman: **`pm.response.code` is the numeric status (200)**,
while **`pm.response.status` is the status _text_ (`'OK'`)**. Compare numbers
against `code` (`pm.response.code === 200`), never against `status`.
`pm.response.body` and `pm.response.text()` both return the raw body **string**.
`pm.response.json()` **throws** on a non-JSON body (Postman-compatible) — wrap it
in a try/catch or a `pm.test` if the body might not be JSON.
:::

### pm.test / pm.expect

`pm.expect` (and the bare `expect`) is the **real [Chai BDD](https://www.chaijs.com/api/bdd/)
library** — the full assertion API is available with no Testnizer-specific
limitations.

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

The **complete Chai BDD API** ([chaijs.com/api/bdd](https://www.chaijs.com/api/bdd/))
is available, including:

- **Language chains** (read as English, no-op): `to`, `be`, `been`, `is`, `that`,
  `which`, `and`, `has`, `have`, `with`, `at`, `of`, `same`, `but`.
- **Flags**: `not`, `deep`, `nested`, `own`, `ordered`, `any`, `all`.
- **Matchers**: `a` / `an`, `include` / `contain`, `ok`, `true`, `false`, `null`,
  `undefined`, `NaN`, `exist`, `empty`, `equal` / `eql`, `above` / `gt` /
  `least` / `gte`, `below` / `lt` / `most` / `lte`, `within`, `closeTo` /
  `approximately`, `instanceof`, `property` (+ `nested` / `own`),
  `ownPropertyDescriptor`, `lengthOf` / `length`, `match`, `string`, `keys`,
  `throw`, `respondTo`, `satisfy`, `members`, `oneOf`, `change` / `increase` /
  `decrease` / `by`, `extensible`, `sealed`, `frozen`, `finite`.
- `expect.fail(...)` to fail explicitly.

```js
pm.expect(value).to.equal(expected)
pm.expect(value).to.deep.equal({ key: 'val' })
pm.expect(value).to.include('substring')
pm.expect(value).to.be.closeTo(100, 5)
pm.expect(obj).to.have.nested.property('user.profile.id')
pm.expect(fn).to.throw(TypeError)
pm.expect([1, 2, 3]).to.have.members([3, 2, 1])
pm.expect(x).to.not.be.empty            // any matcher negates with .not
```

### Response assertions — pm.response.to.\*

The full Postman response-assertion set, all negatable via `to.not.*`:

```js
// status / headers / body
pm.response.to.have.status(200)                  // by code
pm.response.to.have.status('OK')                 // by reason text
pm.response.to.have.statusCode(200)
pm.response.to.have.statusReason('OK')
pm.response.to.have.statusCodeClass(2)           // 2 → 2xx, 4 → 4xx, …
pm.response.to.have.header('Content-Type')
pm.response.to.have.header('Content-Type', 'application/json; charset=utf-8')
pm.response.to.have.body()                       // non-empty body
pm.response.to.have.body('exact text')
pm.response.to.have.body(/regex/)

// JSON body
pm.response.to.have.jsonBody()                   // body is valid JSON
pm.response.to.have.jsonBody('id')               // path exists
pm.response.to.have.jsonBody('id', 42)           // path equals value
pm.response.to.have.jsonBody({ id: 42 })         // deep-equals the object

// schema, timing, size
pm.response.to.have.jsonSchema(schema)
pm.response.to.have.responseTime.below(300)
pm.response.to.have.responseSize.below(50000)

// status-class helpers
pm.response.to.be.info                           // 1xx
pm.response.to.be.success                        // 2xx
pm.response.to.be.redirection                    // 3xx
pm.response.to.be.clientError                    // 4xx
pm.response.to.be.serverError                    // 5xx
pm.response.to.be.error                          // 4xx or 5xx

// named status helpers
pm.response.to.be.ok                             // 200
pm.response.to.be.accepted                       // 202
pm.response.to.be.withoutContent                 // 204
pm.response.to.be.badRequest                     // 400
pm.response.to.be.unauthorized                   // 401 (unauthorised also works)
pm.response.to.be.forbidden                      // 403
pm.response.to.be.notFound                       // 404
pm.response.to.be.notAcceptable                  // 406
pm.response.to.be.rateLimited                    // 429
pm.response.to.be.withBody                       // has a body
pm.response.to.be.json                           // body is JSON

// negate any of them
pm.response.to.not.be.error
pm.response.to.not.have.jsonBody('error')
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

The response exposes the same surface as `pm.response` — `.code`, `.status`,
`.json()`, `.text()`, `.headers.get(name)`, `.cookies.get(name)`, and so on.

### pm.execution

```js
pm.execution.skipRequest()                   // skip this request (pre-request only)
pm.execution.setNextRequest('Request name')  // jump to a named request (runner)
pm.execution.setNextRequest(null)            // stop the run after this request
```

## Legacy Postman interface

Many older Postman exports use the **deprecated** pre-`pm` interface. Testnizer
supports all of it for compatibility (prefer the `pm` API for new scripts):

```js
// response globals (tests only)
responseBody                 // raw body string
responseCode                 // → { code, name, details }
responseHeaders              // → { name: value, ... }
responseTime                 // ms

// legacy test results — an object of name → boolean
tests['status is 200'] = responseCode.code === 200

// the postman.* helpers
postman.setEnvironmentVariable('token', 'abc')
postman.getEnvironmentVariable('token')
postman.clearEnvironmentVariable('token')
postman.setGlobalVariable('apiVersion', 'v2')
postman.getGlobalVariable('apiVersion')
postman.clearGlobalVariable('apiVersion')
postman.setNextRequest('Next request')

// helpers + scope objects
const obj = xml2Json('<a><b>1</b></a>')   // parse XML to a JS object
environment['token']                       // read/write the environment object
globals['apiVersion']                      // read/write globals
data['userId']                             // current iteration data row
```

## Insomnia & Bruno

Scripts exported from **Insomnia** and **Bruno** run unchanged. Their globals are
wired into the same runtime.

### insomnia.\*

`insomnia` is an alias of `pm` with **two differences**:

- **`insomnia.response.status` is the NUMERIC status code** (e.g. `200`), not the
  reason text — the reverse of `pm.response.status`.
- **`insomnia.baseEnvironment` and `insomnia.collectionVariables`** map to
  Postman **collection** variables.

```js
insomnia.environment.set('token', 'abc')
insomnia.baseEnvironment.get('apiKey')        // → collection variable
if (insomnia.response.status === 200) { … }   // numeric code
```

### bru / req / res

Bruno's API is **getter-based**, not a `pm` alias:

```js
// bru — variables + flow
bru.getEnvVar('baseUrl')
bru.setEnvVar('token', 'abc')
bru.getVar('temp')                  // request-scoped var
bru.setVar('temp', 1)
bru.getCollectionVar('apiVersion')
bru.setNextRequest('Next request')
await bru.sendRequest({ url, method })
bru.interpolate('{{baseUrl}}/v1')   // resolve {{...}}

// req — the outgoing request (pre-request)
req.getUrl()
req.getMethod()
req.getHeaders()
req.getHeader('Authorization')

// res — the response (tests)
res.getStatus()        // numeric code
res.getStatusText()    // reason text
res.getBody()          // parsed body
res.getHeader('Content-Type')
res.getResponseTime()
res.getSize()
res.status             // property form of getStatus()
res.body               // property form of getBody()
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

### Validate the body against a JSON Schema

```js
const Ajv = require('ajv')
const schema = {
  type: 'object',
  required: ['id', 'email'],
  properties: { id: { type: 'number' }, email: { type: 'string' } },
}
pm.test('matches schema', function () {
  pm.response.to.have.jsonSchema(schema)        // or: new Ajv().validate(schema, body)
})
```

### Read a cookie the server set

```js
const session = pm.response.cookies.get('session')
pm.environment.set('sessionId', session)
```

### Parse an XML response

```js
const xml2js = require('xml2js')
xml2js.parseString(pm.response.text(), (err, data) => {
  pm.test('order id present', function () {
    pm.expect(data.Order.Id[0]).to.be.a('string')
  })
})
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
// or the atob / btoa globals: btoa('user:pass'), atob(b64)
```

## Script errors

If a script throws, that script is aborted and the error appears in the
**Console** tab. Test cases that ran before the error are still recorded. Because
`pm.response.json()` throws on a non-JSON body, guard it with try/catch or a
`pm.test` when the response might not be JSON.
