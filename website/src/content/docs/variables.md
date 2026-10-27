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

Testnizer resolves `{{variable}}` placeholders from three scopes. When the same
key exists in more than one, the more specific scope wins. From lowest to
highest priority:

1. **Globals** — the project's own variable list, open from **Environments** →
   **Globals**. Every request of the project sees them, whichever environment is
   active, and they are saved with the project (Git, export). Globals are
   **per project**: another project in the same workspace does not see them, on
   Send or on Run. This list is both Postman's *globals* and Postman's
   *collection variables* — a Testnizer project is the Postman collection — so
   `pm.globals` and `pm.collectionVariables` read and write the same
   variables. A variable can be marked **secret**; see
   [Secrets and sensitive variables](#secrets-and-sensitive-variables).

2. **Environment variables** — pulled from the currently active environment.
   See [Environments & variables](/docs/environments) for how to create and
   manage environments. This is the usual place for values that differ between
   staging and production. An environment variable beats a Global of the same
   name.

3. **Local variables** — live only for the duration of a single request
   execution. Set with `pm.variables.set()` in a pre-request or test script.
   Cleared automatically once the response is received.

**Resolution example.** Suppose `baseUrl` is defined in two places:

| Scope | Value |
|---|---|
| Globals | `https://prod.api.example.com` |
| Environment (active: Staging) | `https://staging-v2.api.example.com` |

When a request uses `{{baseUrl}}`, Testnizer resolves it to
`https://staging-v2.api.example.com` because the environment scope has the
higher priority. Switch to an environment that does not define `baseUrl` and
the same placeholder falls back to the Global value.

Send, the Collection Runner, Test Suites, the Scheduler and mock servers read
the same Globals and the same environments, so a request that resolves on Send
resolves on Run too.

### Moving an environment into Globals

Postman collections that use collection variables arrive in Testnizer as
Globals. If you have an environment whose values really belong to the whole
project, open **Environments**, pick it and choose **Move to Globals**: its
variables are copied into Globals, a variable Globals already has keeps its
value, and you are then asked whether to delete the environment (the question
names any value that would be lost). Environments created by an earlier import
are not moved automatically.

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

// Globals: pm.collectionVariables and pm.globals are the same project-wide list
pm.collectionVariables.set('sharedCounter', 1)
pm.globals.get('sharedCounter')   // 1
```

---

## Dynamic values

Dynamic value functions generate a fresh value each time the request is sent.
Use them with the `{{$functionName}}` syntax directly in URLs, headers, or body
fields.

Testnizer supports **all 118 of Postman's dynamic variables** (`{{$guid}}`,
`{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`,
`{{$randomEmail}}`, `{{$randomFullName}}`, `{{$randomIP}}`, and so on), with
the same output shapes as Postman, because the values come from the same
generator table Postman and Newman use. Type `{{$` in a field and the
autocomplete lists them. A few common ones:

| Function | Returns | Example output |
|---|---|---|
| `{{$randomInt}}` | Random integer 0–1000 | `742` |
| `{{$randomBoolean}}` | `true` or `false` | `true` |
| `{{$guid}}` / `{{$randomUUID}}` | Version 4 UUID | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `{{$timestamp}}` | Unix epoch in seconds | `1715000000` |
| `{{$isoTimestamp}}` | ISO 8601 date-time | `2024-05-06T14:30:00.000Z` |
| `{{$randomEmail}}` | Synthetic email address | `alice.smith@example.com` |
| `{{$randomFirstName}}` | First name | `Marcus` |
| `{{$randomLastName}}` | Last name | `Chen` |
| `{{$randomFullName}}` | Full name | `Sarah Okafor` |
| `{{$randomPhoneNumber}}` | Phone number | `+1-555-0147` |
| `{{$randomAlphaNumeric}}` | A single alphanumeric character | `x` |
| `{{$randomHexColor}}` | Hex color code | `#a3c4e8` |
| `{{$randomIP}}` | IPv4 address | `192.168.14.23` |
| `{{$randomLoremWord}}` | Single lorem ipsum word | `pariatur` |
| `{{$randomLoremParagraph}}` | Lorem ipsum paragraph | `Lorem ipsum dolor sit amet…` |

Testnizer adds a few forms Postman does not have:

| Function | Returns |
|---|---|
| `{{$randomInt(1,100)}}` | Random integer in the given range |
| `{{$randomString}}` / `{{$randomString(12)}}` | Random alphanumeric string (8 characters, or the length you give) |
| `{{$randomName}}` | Random full name |
| `{{$datetime(YYYY-MM-DD)}}` | Current local date/time; `YYYY MM DD HH mm ss` are replaced |

A name Testnizer does not know is left exactly as you typed it
(`{{$notAFunction}}` is sent literally), the same as Postman.

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

Any environment variable or Global can be marked as **secret** when it is
created or edited. Secret variables are stored through `electron-store` backed by the OS
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
  variable name only (a Postman export marks it `type: secret` with an empty
  value).
- A script that writes a secret variable (`pm.environment.set`,
  `pm.globals.set`, `pm.collectionVariables.set` or `pm.vault.set`) does not
  leak the new value: during a Run it is masked in the results, History and
  Console, and on Send it is stored before the request goes out so History and
  the Console mask it too.
- `pm.vault` is Postman's name for secret storage. In Testnizer it is the
  **secret Globals**: `await pm.vault.set('apiKey', value)` creates or updates a
  secret Global, `await pm.vault.get('apiKey')` reads only secret ones, and
  `await pm.vault.unset('apiKey')` deletes a secret one. See
  [Scripts](/docs/scripts#pmvault-and-pmrequire).

For guidance on creating and organizing environments, see
[Environments & variables](/docs/environments).
