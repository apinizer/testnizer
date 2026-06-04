---
title: Scripts and test assertions
description: Pre-request scripts, test scripts, and the full pm API reference for Testnizer.
order: 4
section: Guides
---

Testnizer runs scripts in the Node main process, not in a sandboxed iframe.
That means `require()` works — you can import crypto, path, or any package
installed in the app without workarounds.

Scripts are attached to HTTP requests (and collection folders). Each request
has two script slots:

- **Pre-request script** — runs before the request is sent
- **Tests** — runs after the response arrives

## pm API reference

### pm.environment

Read and write variables in the active environment.

```js
pm.environment.get('baseUrl')            // → string | undefined
pm.environment.set('token', 'abc123')   // sets (or creates) the variable
pm.environment.unset('token')           // deletes the variable
pm.environment.has('token')             // → boolean
pm.environment.toObject()               // → { key: value, ... } snapshot
```

Changes made in a pre-request script are visible to the request URL, headers,
and body. Changes made in a test script persist to the next request in a
collection runner sequence.

### pm.collectionVariables

Same API as `pm.environment`, but scoped to the collection (project) rather
than the environment. Useful for passing data between requests without
polluting the shared environment.

```js
pm.collectionVariables.set('nextPageToken', body.nextPage)
```

### pm.variables

Read-only merged view of all variable scopes (collection → environment →
global). Use this when you want the resolved value regardless of which scope
it came from:

```js
const baseUrl = pm.variables.get('baseUrl')
```

You can also write to a temporary "local" scope that is visible only for the
current request execution (not persisted):

```js
pm.variables.set('tempSig', computeSignature())
```

### pm.request (pre-request script only)

Inspect and modify the outgoing request before it is sent.

```js
pm.request.url.toString()          // full URL string
pm.request.method                  // 'GET', 'POST', …
pm.request.body.raw                // raw body string

// Add or update a header
pm.request.headers.add({ key: 'X-Nonce', value: nonce })
pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + token })

// Update the URL
pm.request.url = 'https://example.com/v2/users'
```

### pm.response (test script only)

```js
pm.response.status          // 'OK', 'Not Found', …
pm.response.code            // 200, 404, …
pm.response.responseTime    // ms (number)
pm.response.text()          // response body as string
pm.response.json()          // response body parsed as JSON
pm.response.headers.get('Content-Type')
pm.response.cookies.get('session')
```

### pm.test

Declare a named test case. The callback runs immediately; pass or fail is
recorded in the Tests panel.

```js
pm.test('status is 200', function () {
  pm.response.to.have.status(200)
})
```

Multiple `pm.test` calls per script are fine — each produces an independent
pass/fail row.

### pm.expect

Chai-style assertion. Use it inside `pm.test` callbacks for cleaner failure
messages:

```js
pm.test('user has id and email', function () {
  const body = pm.response.json()
  pm.expect(body).to.be.an('object')
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
pm.expect(str).to.match(/regex/)
```

### pm.response.to.have (shorthand assertions)

```js
pm.response.to.have.status(200)
pm.response.to.have.status('OK')
pm.response.to.have.header('Content-Type')
pm.response.to.have.header('Content-Type', 'application/json; charset=utf-8')
pm.response.to.have.jsonBody()
pm.response.to.have.jsonBody('id')               // has property
pm.response.to.have.jsonBody('id', 42)            // has property with value
pm.response.to.be.ok                             // 2xx
pm.response.to.not.be.ok                         // not 2xx
```

### pm.execution

Control collection-runner execution flow.

```js
pm.execution.skipRequest()   // skip the current request (pre-request script only)
pm.execution.setNextRequest('Request name')  // jump to a named request
pm.execution.setNextRequest(null)            // stop the run after this request
```

## require()

Any module available to Electron's Node environment can be required:

```js
const crypto  = require('crypto')
const path    = require('path')
const fs      = require('fs')
const assert  = require('assert')
```

Because scripts run in the main process, not in a browser context, there is no
`window` or `document`. DOM APIs are not available.

## Common recipes

### HMAC signature in pre-request

```js
const crypto  = require('crypto')
const secret  = pm.environment.get('signingSecret')
const ts      = String(Date.now())
const body    = pm.request.body.raw || ''
const payload = ts + '\n' + body
const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex')

pm.request.headers.upsert({ key: 'X-Timestamp', value: ts })
pm.request.headers.upsert({ key: 'X-Signature', value: 'sha256=' + sig })
```

### Chain requests — pass ID to next request

```js
// In the test script of "Create user":
const userId = pm.response.json().id
pm.environment.set('createdUserId', String(userId))

// In the URL of "Get user":
// GET {{baseUrl}}/users/{{createdUserId}}
```

### Retry on 429

```js
// In the test script:
if (pm.response.code === 429) {
  pm.execution.setNextRequest(pm.info.requestName) // repeat this request
}
```

### Assert response time

```js
pm.test('response under 300 ms', function () {
  pm.expect(pm.response.responseTime).to.be.below(300)
})
```

### Parse an XML response

```js
const { XMLParser } = require('fast-xml-parser')
const parser = new XMLParser()
const data   = parser.parse(pm.response.text())

pm.test('order id exists', function () {
  pm.expect(data.Order.Id).to.be.a('string')
})
```

## Script errors

If a script throws an uncaught exception, the entire script is aborted and
the error is shown in the **Console** tab. Other test cases that ran before
the error are still recorded.
