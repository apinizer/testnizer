---
title: Environments & variables
description: Project-scoped environments, variable substitution, dynamic values, and best practices for sharing collections without leaking secrets.
order: 2
section: Guides
---

Environments hold the values that change between runs — base URLs, auth tokens,
test user IDs. Testnizer scopes environments to the **project**, which makes
them simpler to reason about than Postman's three-tier (global / collection /
environment) model.

## Project-scoped environments

A project can have any number of environments. Exactly one is **active** at a
time. The active environment's variables are substituted into requests as they
fire.

Create one from **Environments** in the right sidebar → **+ New**.

Each variable has:

- A **name** (used in `{{name}}` references)
- An **initial value** (committed with the project, safe to version)
- A **current value** (your local override, never written to Git)

This split is the same as Postman's. Use **initial value** for the default a
team would expect (`baseUrl: https://api.example.com`). Use **current value**
for your personal override (`baseUrl: http://localhost:3000`).

## Substitution syntax

`{{variableName}}` works in:

- URL paths and query strings
- Header keys and values
- Body raw / JSON / XML content
- Form-data and urlencoded fields *(planned — currently only raw bodies)*
- Auth fields (basic, bearer, API key, OAuth 2.0, AWS Signature, WS-Security)

Resolution order:

1. Environment variables (active environment)
2. Global variables (configured in **Settings → Globals**)
3. Dynamic variables (built-in, see below)
4. Literal — `{{...}}` left in place if no match

## Dynamic variables

Built-in helpers, prefixed with `$`:

- `{{$randomInt}}` — random 32-bit integer
- `{{$randomUuid}}` — RFC 4122 v4 UUID
- `{{$timestamp}}` — Unix epoch seconds
- `{{$isoTimestamp}}` — ISO 8601 UTC
- `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomLastName}}` — fake data
- `{{$base64:hello}}` — Base64-encode a literal
- `{{$jwt.decode:<token>:claim}}` — extract a claim from a JWT (handy for
  asserting against a value the auth server returns)

Dynamic variables resolve fresh on every request — useful for cache-busting
query parameters or unique idempotency keys.

## Setting variables from scripts

In a pre-request or post-response script:

```js
pm.environment.set('userId', 12345)
pm.environment.get('baseUrl')
pm.variables.set('correlationId', pm.variables.get('$randomUuid'))
```

Setters write to the **current value** of the active environment. Writes from a
**test** script persist — a token captured in one request is available to the
next request and shows up in the environment editor. See
[Scripts and test assertions](/docs/scripts/) for the full `pm` API, the
project/folder script cascade, and built-in OAuth 2.0 (which often removes the
need for a token-fetch script entirely).

## Sharing collections without leaking secrets

The project file you export or commit to Git carries every variable — name,
type, initial value **and** current value — except the values of variables
marked **secret**: those are written empty and stay on this computer.

The recommended pattern:

1. Mark tokens, passwords and API keys as **secret** (Type column).
2. Push. A teammate's Pull brings the variable with an empty value, and
   Testnizer tells them how many secret values they still have to fill in.
   Each developer enters their own; later Pulls and branch switches keep it.
3. Reference the variable (`{{authToken}}`) from requests and Auth tabs instead
   of pasting the value — auth typed directly into a request or folder travels
   with the project.

HTTP mock server tokens, passwords and API keys, and Mock MCP bearer tokens,
follow the same rule.

## Secrets in the OS keychain

Mark a variable as **secret** (Type column) for tokens and passwords. Its
current and initial value are encrypted on disk with the OS keychain (macOS
Keychain, Windows DPAPI, libsecret on Linux), are never written to the project
file, git or exports, and are masked in History and the Console. HTTP mock
server tokens, passwords and API keys, and Mock MCP bearer tokens, are stored
the same way; certificate passphrases are encrypted too.

If the keychain is unavailable (for example Linux without libsecret), secret
values are stored unencrypted and are encrypted on a later launch once it is
available. A value encrypted on one computer cannot be decrypted on another,
or after the keychain is reset — enter it again there.

Variables that are not marked secret, and credentials typed directly into a
request's Auth tab, are stored as plain text in the local database. For tokens
that grant production access, put the value in a secret variable and reference
it (`{{token}}`) from the Auth tab.
