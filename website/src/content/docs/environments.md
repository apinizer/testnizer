---
title: Environments & variables
description: Project-scoped environments, variable substitution, dynamic values, and best practices for sharing collections without leaking secrets.
order: 2
section: Guides
---

Environments hold the values that change between runs — base URLs, auth tokens,
test user IDs. Testnizer scopes environments to the **project**, which makes
them simpler to reason about than Postman's three-tier (global / collection /
environment) model: a project has its **environments** and one list of
**Globals** that every environment shares.

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
2. Globals (the project's own list, see [Globals](#globals))
3. Dynamic variables (built-in, see below)
4. Literal — `{{...}}` left in place if no match

## Globals

Open **Environments** (the environment selector's **Manage Environments**) and
pick **Globals** to edit the project's variables that apply whichever
environment is active. An environment variable of the same name wins. Globals
are saved with the project, so they travel with Git and export, and they can be
marked **secret** like any other variable.

Globals are where Postman *collection variables* and *globals* land when you
import a Postman collection, and what `pm.collectionVariables` and
`pm.globals` read and write in a script. They belong to one project: another
project in the same workspace has its own list. **Export Globals** saves the
list as a Postman globals file (secret values are left empty).

To turn an existing environment into Globals, select it and choose **Move to
Globals**: the variables are copied, a name Globals already has keeps its
value, and you are asked whether to delete the environment afterwards.

## Dynamic variables

Built-in helpers, prefixed with `$`. Testnizer supports all 118 of Postman's
dynamic variables with the same output, for example:

- `{{$guid}}` / `{{$randomUUID}}` — a v4 UUID
- `{{$randomInt}}` — random integer, 0–1000
- `{{$timestamp}}` — Unix epoch seconds
- `{{$isoTimestamp}}` — ISO 8601 UTC
- `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomLastName}}` — fake data

plus Testnizer's own `{{$randomInt(1,100)}}`, `{{$randomString(12)}}` and
`{{$datetime(YYYY-MM-DD)}}`. A `{{$name}}` Testnizer does not know is left as
written. The full list with example output is in the
[Variables reference](/docs/variables#dynamic-values).

Dynamic variables resolve fresh on every request — useful for cache-busting
query parameters or unique idempotency keys.

## Setting variables from scripts

In a pre-request or post-response script:

```js
pm.environment.set('userId', 12345)
pm.environment.get('baseUrl')
pm.variables.set('correlationId', require('uuid').v4())
```

Setters write to the **current value** of the active environment. Writes from a
**test** script persist — a token captured in one request is available to the
next request and shows up in the environment editor. See
[Scripts and test assertions](/docs/scripts/) for the full `pm` API, the
project/folder script cascade, and built-in OAuth 2.0 (which often removes the
need for a token-fetch script entirely).

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
