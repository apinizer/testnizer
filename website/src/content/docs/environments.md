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

Setters write to the **current value** of the active environment. They persist
across requests within the same Testnizer session.

## Sharing collections without leaking secrets

The recommended pattern:

1. Put placeholder values in **initial value** (`{{authToken}}` defaults to
   `"<paste-here>"` or empty)
2. Each developer fills their **current value** locally
3. Commit the project to Git — only initial values travel; current values are
   stored in a separate, gitignored file

This is how production-quality teams ship Testnizer projects without
accidentally pushing a real bearer token to the repo.

## Secrets in the OS keychain

For long-lived credentials (OAuth refresh tokens, certificate passphrases),
prefer the **Certificate manager** or per-request auth fields rather than
environment variables. Those values pass through the OS keychain and never
write plaintext to disk.

Environment "current values" are stored in plaintext within your project
directory — convenient for development, not appropriate for production
credentials. Always use the keychain-backed paths for tokens that grant
production access.
