---
title: Variables reference
description: Complete reference for variable types, scope hierarchy, and dynamic value functions in Testnizer.
order: 6
section: Guides
---

Variables let you parameterize requests so the same collection works across
environments, users, and test runs without manual edits.

---

## Variable scope hierarchy

Testnizer resolves variables using four scopes. When the same key exists in
multiple scopes, the more specific scope wins. From lowest to highest priority:

1. **Global variables** — apply across the entire workspace and every project
   inside it. Set and read at runtime with `pm.globals.set()` /
   `pm.globals.get()`. Useful for values that never differ between environments,
   such as a shared API version string.

2. **Collection variables** — scoped to a single project (Testnizer uses
   "collection" as the script-API term for the project scope). Set with
   `pm.collectionVariables.set()`. Good for base paths and shared test data
   that belong to the project but should not vary per environment.

3. **Environment variables** — pulled from the currently active environment.
   See [Environments & variables](/docs/environments) for how to create and
   manage environments. These are the most common place to put values that
   differ between staging and production.

4. **Local variables** — live only for the duration of a single request
   execution. Set with `pm.variables.set()` in a pre-request or test script.
   Cleared automatically once the response is received.

**Resolution example.** Suppose `baseUrl` is defined in three places:

| Scope | Value |
|---|---|
| Global | `https://prod.api.example.com` |
| Collection | `https://staging.api.example.com` |
| Environment (active: Staging) | `https://staging-v2.api.example.com` |

When a request uses `{{baseUrl}}`, Testnizer resolves it to
`https://staging-v2.api.example.com` because the environment scope has the
highest priority among the three.

---

## `{{variable}}` syntax

Double curly braces work in every request field:

- **URL** — `https://{{baseUrl}}/{{version}}/users`
- **Query parameters** — value column of any query param row
- **Headers** — both name and value columns
- **Request body** — raw JSON, form fields, GraphQL variables, and XML body
- **Pre-request and test scripts** — use the `pm.*` API instead (see below)

Testnizer resolves all placeholders before the request is sent. If a variable
is not defined in any scope, the placeholder is left as-is — the literal text
`{{variableName}}` is sent. Undefined variables are highlighted in orange in
the URL bar so you can spot them before clicking Send.

Nested substitution works. A URL such as:

```
https://{{baseUrl}}/{{version}}/users
```

resolves both `baseUrl` and `version` independently. Variables cannot reference
each other (circular or chained resolution is not supported).

### Managing variables in scripts

Pre-request and test scripts use the `pm` API to read and write variables at
runtime:

```js
// Read a value from the active environment
const token = pm.environment.get('accessToken')

// Write a value extracted from the response
const body = pm.response.json()
pm.environment.set('userId', body.data.id)

// Write a local variable that lasts only for this execution
pm.variables.set('requestId', '12345')

// Collection-level (project-level) read/write
pm.collectionVariables.set('sharedCounter', 1)
```

---

## Dynamic values

Dynamic value functions generate a fresh value each time the request is sent.
Use them with the `{{$functionName}}` syntax directly in URLs, headers, or body
fields.

| Function | Returns | Example output |
|---|---|---|
| `{{$randomInt}}` | Random integer 0–1000 | `742` |
| `{{$randomInt(1,100)}}` | Random integer in given range | `37` |
| `{{$randomFloat}}` | Random float 0.0–1.0 | `0.4821` |
| `{{$randomBoolean}}` | `true` or `false` | `true` |
| `{{$randomUUID}}` | Version 4 UUID | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `{{$timestamp}}` | Unix epoch in seconds | `1715000000` |
| `{{$isoTimestamp}}` | ISO 8601 date-time | `2024-05-06T14:30:00.000Z` |
| `{{$randomEmail}}` | Synthetic email address | `alice.smith@example.com` |
| `{{$randomFirstName}}` | First name | `Marcus` |
| `{{$randomLastName}}` | Last name | `Chen` |
| `{{$randomFullName}}` | Full name | `Sarah Okafor` |
| `{{$randomPhoneNumber}}` | Phone number | `+1-555-0147` |
| `{{$randomAlphaNumeric}}` | 8-character alphanumeric string | `x4Kp9mQr` |
| `{{$randomHexColor}}` | Hex color code | `#a3c4e8` |
| `{{$randomIP}}` | IPv4 address | `192.168.14.23` |
| `{{$randomLoremWord}}` | Single lorem ipsum word | `pariatur` |
| `{{$randomLoremParagraph}}` | Lorem ipsum paragraph | `Lorem ipsum dolor sit amet…` |

### Dynamic values in scripts

`{{$functionName}}` syntax is **not** evaluated inside script code. If you
write the following, you get the literal string `{{$randomUUID}}`, not a UUID:

```js
// WRONG — $randomUUID is not expanded inside a script string
pm.variables.set('traceId', '{{$randomUUID}}')
```

Generate the value with standard JavaScript instead:

```js
// CORRECT — use the crypto module available in the sandbox
const { randomUUID } = require('crypto')
pm.variables.set('traceId', randomUUID())

// Or for a random integer:
const requestId = Math.floor(Math.random() * 1000)
pm.variables.set('requestId', requestId)
```

Dynamic values are intended for fields that Testnizer substitutes before
sending — URL, headers, query parameters, and body text.

---

## Secrets and sensitive variables

Any environment variable can be marked as **secret** when it is created or
edited. Secret variables are stored through `electron-store` backed by the OS
keychain on macOS and the Windows Credential Manager on Windows.

Behavior of secret variables:

- The value is masked with asterisks in the Environments panel, the console,
  and the request history viewer.
- `pm.environment.get('secretKey')` returns the real value inside scripts so
  you can use it in Authorization headers.
- `pm.environment.toObject()` returns an object where secret keys are replaced
  with `"***"`. Do not rely on this method to read secret values.
- Secret values are never written to exported collection files. If you export a
  collection that references a secret variable, the export contains the
  variable name only.

For guidance on creating and organizing environments, see
[Environments & variables](/docs/environments).
