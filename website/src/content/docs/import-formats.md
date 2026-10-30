---
title: Import & export
description: Bring your existing collections from Postman, Insomnia, OpenAPI, Swagger, cURL, WSDL, .proto, RAML, SoapUI, and HAR.
order: 1
section: Guides
---

Testnizer accepts ten input formats and exports to six. Imports are designed for
**lossless round-trip** for the documented surface — including pre-/post-scripts
and collection variables, not just the URL and method.

## Formats matrix

| Format | Import | Export | Notes |
|---|---|---|---|
| **OpenAPI 3.x** | ✓ | ✓ | Security schemes mapped to auth, examples preferred over schemas |
| **Swagger 2.0** | ✓ | — | Read-only; export emits OpenAPI 3.0.3 |
| **Postman** (v1, v2.0, v2.1, v3) | ✓ | ✓ | Auto-detected. Export is v2.1 or v3 (folder / JSON). Also environments, globals, a Postman data export and `.zip` archives |
| **Insomnia v4 / v5** | ✓ | ✓ | Form-data file fields, base environment → Globals, script shim |
| **cURL** | ✓ | ✓ | bash, Windows CMD and PowerShell commands; paste into the URL bar; multipart; ANSI-C quoting |
| **WSDL** | ✓ | — | Multi-service, multi-port, SOAP 1.1 + 1.2 dual bindings |
| **`.proto`** | ✓ | — | gRPC services with JSON skeleton bodies |
| **RAML 1.0** | ✓ | — | Nested resources, URI parameters, body content types |
| **SoapUI / ReadyAPI** | ✓ | — | Project XML |
| **HAR** | ✓ | — | Browser network logs |

## How to import

**File → Import** (or drag a file onto the sidebar) and Testnizer auto-detects
the format. If detection is ambiguous (rare with `.json`, common with raw XML),
a dropdown lets you pick.

Importing creates a new collection inside the active project. You can rename it
afterwards from the sidebar context menu.

### OpenAPI / Swagger

- `info.title` becomes the collection name
- `paths.*` become endpoints, organised by `tags[0]` (or "Default" if none)
- `components.securitySchemes` map to per-request auth blocks:
  - `http.basic` → Basic auth
  - `http.bearer` → Bearer token
  - `apiKey` (header / query / cookie) → API key auth
  - `oauth2` → OAuth 2.0 (config preserved, run flow manually first time)
- Body examples come from `example` first, schema-derived skeletons second

Round-trip metadata (tags, `operationId`, `required` parameters, security
references) is persisted in a sidecar field so re-export reproduces the original
spec faithfully.

### Postman

Pick the **Postman** card in the Import dialog and choose a file (or, for a v3
folder, **Import folder…**). Testnizer tells the format apart from the file
itself, so you do not choose a version:

| What you pick | What it is |
|---|---|
| Collection JSON | v1, v2.0, v2.1, or a single v3 JSON file |
| Environment JSON | Becomes a project environment |
| Globals JSON | Its variables are added to the project's [Globals](/docs/environments#globals) — no folder is created |
| A Postman data export (`postman_dump.json`) | Every collection, environment and globals file in it |
| **Import folder…** | A Postman 12 *Native Git* collection folder (it holds `.resources` and `*.request.yaml` files) or a whole workspace folder (it holds `postman/collections`, `postman/environments` and globals) |
| A `.zip` | A zipped data export, zipped collection or environment files, or a zipped v3 folder |

What you get:

- Folders, requests, headers, bodies (raw, form-data, urlencoded, binary,
  GraphQL), the `event` scripts (`prerequest` and `test`) verbatim, and path
  variables (`:id` in the URL path)
- **Collection variables, folder variables and request variables go to the
  project's Globals**, together with Postman globals files. A Testnizer project
  is the Postman collection, so there is no separate "collection" tier: the same
  list is `pm.collectionVariables` and `pm.globals` in a script. A key the
  project already has keeps its local value (the import report names it); a key
  defined twice keeps the first definition. `secret` variables arrive as secret
  Globals; a v3 variable linked to a Postman vault arrives as an empty secret
  variable with a note to enter the value again
- **Collection-level auth and scripts are not copied into every request.** They
  go to the folder the import creates or, for a simple `{{variable}}`-based
  Basic / Bearer / API key auth on a project that has no auth yet, to the
  project's auth. Requests become **Inherit from parent**
- Saved responses become **saved examples**; per-request settings (follow
  redirects, timeout and so on) are kept; disabled scripts and variables stay
  disabled; OAuth 2.0 grant details are mapped
- Auth types Testnizer does not have are imported as **No auth** and listed in
  the report so you can set them up again in the Auth tab
- Scripts run unchanged on the `pm` API — see [Scripts](/docs/scripts). A script
  that calls `pm.vault` or `pm.require` is named in the report; `pm.vault` works
  on secret Globals, `pm.require` is not supported
- Environments become project environments. "(imported)" environments created
  by older versions are not migrated automatically — use **Move to Globals** in
  **Environments** if you want their variables in Globals

Importing a collection is **one transaction**: it either completes or leaves the
project untouched, and an unsupported detail is reported instead of aborting.
When the import finishes, an **Import finished** panel shows how many requests,
folders and examples were imported, and **Show details** lists every item that
could not be imported as-is.

**Postman v3 request types.** A v3 collection (folder or JSON) can hold more
than HTTP. Testnizer imports GraphQL, gRPC, WebSocket, Socket.IO, MCP, MQTT and
LLM requests as their own request types, in the shape the editor saves. An MCP
request that starts a local program (stdio) is imported but never trusted: it
only runs after you connect to that exact command on this computer once. An LLM
request becomes an AI Chat request with the saved API key switched off and no
credential from the file. Kafka, Data (database / file) and unknown kinds are
skipped and named in the report.

**Folders and archives from elsewhere are untrusted input.** A `.zip` is read in
memory and never extracted. Testnizer refuses an archive or folder with absolute
or `..` paths, symbolic links, encrypted entries, an oversized or
over-compressed entry, or too many entries, and a script file that climbs out of
the picked folder. A refused archive shows its reason in the dialog.

**Scope note.** Postman variables are collection-scoped in Postman; Testnizer
scopes the same variables to the **project**. Importing several Postman
collections into one project therefore shares the Globals between them (the
first definition of a key wins and later ones are reported).

### Insomnia (v4 and v5)

- Workspace becomes a project
- Request groups become endpoint folders
- Form-data file fields preserve the file path reference
- Pre-request scripts work via the same `pm` shim (`insomnia.*`)
- The collection's **base environment** goes to the project's
  [Globals](/docs/environments#globals), because Insomnia's base environment is
  the always-active tier. Its **sub-environments** become project environments.
  A key the project already has keeps its local value and the import report
  names it. Importing the same file again does not duplicate anything
- In scripts, `insomnia.environment` reads and writes the Globals while no
  environment is selected, as Insomnia does with its base environment; see
  [Scripts](/docs/scripts#insomnia--bruno)
- A project imported before 1.6.0 keeps its base environment as an ordinary
  environment; **Move to Globals** copies it over

### cURL

Paste any cURL command into **Import → cURL**, or paste it straight into an HTTP
request's **URL bar**: Testnizer recognises a command and fills the whole
request (method, URL, query parameters, headers, body, auth, redirect, timeout
and TLS-verification settings). A **toast** names the shell it detected and has
**Undo**, which puts the previous request back exactly; pasting a plain URL
behaves as before. Because a pasted command is the whole request, anything it
does not say returns to the new-request default. A command with no credentials
leaves auth on **Inherit from parent**.

One parser reads commands copied for **bash / zsh** (`'…'`, `$'…'` with escape
sequences decoded, `\` line continuations), **Windows CMD** (`^` carets and
`"…"`) and **PowerShell** (backticks, `curl.exe`), and strips a leading prompt.
It knows about 300 curl options and what each one consumes, so the value of
`-o out.txt` is never mistaken for the URL. Supported options include:

- Method and body: `-X` (also glued, as in `-XPOST`), `-I`, `-G`, `-d` /
  `--data` / `--data-raw` / `--data-binary` / `--data-urlencode` (repeated
  ones are joined), `--json`, `-F` / `--form`
- Auth: `-u` / `--user`, `--basic`, `--digest`, `--ntlm`, `--oauth2-bearer`
- Headers and cookies: `-H`, `-b`, `-A`, `-e`
- Behaviour: `-L` / `--max-redirs`, `-k` / `--insecure`, `-m` / `--max-time`,
  `--connect-timeout`, `--compressed`, `--url`, and the `--option=value` form

Options that change what curl sends but have no equivalent on a Testnizer
request — a proxy (`-x`), a client certificate (`-E`), `--config` and the like —
are **ignored, with a warning** listed under **Not carried over** in the toast
and in the import report. Output options (`-o`, `-O`, progress and retry flags)
are dropped silently. Only the first request of a `--next` chain is used, and an
option the parser does not know is reported rather than swallowing the URL that
follows it.

To go the other way, **Generate Code → cURL** produces a bash, Windows CMD or
PowerShell command; see
[Code snippet generation](/docs/protocols/http#code-snippet-generation).

### WSDL

Paste a WSDL URL or pick a `.wsdl` file. Testnizer:

- Resolves the WSDL (caches a copy in the project for offline reuse)
- Enumerates services → ports → operations
- Generates an example envelope for each operation from the XSD schemas
- Detects SOAPAction headers automatically
- Handles dual SOAP 1.1 + 1.2 bindings (each port becomes a separate endpoint)

### `.proto` (gRPC)

Drop a `.proto` file. Testnizer parses message types, services, and methods,
and generates a JSON skeleton with zero-valued fields for every message. The
skeleton walks `repeated`, `optional`, nested message types, oneofs, and enums.

You can override the server address per request — useful when the `.proto`
references a non-deterministic endpoint.

### RAML 1.0

Resources, methods, URI parameters, query parameters, and body content types
are parsed. Library / type extensions partially supported (basic resolution).

### SoapUI / ReadyAPI

Project XML is parsed. Test cases become endpoints, REST and SOAP requests are
recognised by their request type element, assertions are imported as best-effort
mapping to Testnizer's test assertion model.

### HAR

Each entry becomes an endpoint. Useful for replaying captured browser sessions
against a different environment.

## How to export

**Export…** on a project (home screen, or the project root in the APIs tree)
opens **Export project** with six formats:

- **Testnizer JSON** — full project snapshot: every protocol, environments,
  test suites and mocks
- **Postman v2.1** — a collection with folders, requests, auth and scripts.
  HTTP, SOAP, GraphQL and SSE only. It also carries the project's Globals as
  collection `variable[]`, saved examples as `response[]` with their original
  request, per-request settings as `protocolProfileBehavior`, path variables as
  `url.variable[]`, AWS Signature and Hawk auth, and the project id as
  `info._postman_id`
- **Postman v3 (folder)** — a Postman 12 *Native Git* folder (YAML files) with
  every request type and the environments, ready for Postman's Local View or a
  Git repository
- **Postman v3 (JSON)** — one Postman v3 collection file with every request
  type: WebSocket, Socket.IO, MQTT, gRPC, GraphQL, MCP and AI Chat included
- **OpenAPI 3** — an API description of the HTTP requests, tagged by folder
- **Insomnia** — request groups. HTTP, SOAP, GraphQL and SSE only

A test suite exports from its context menu (**Export as Postman v2.1**, **Export
as Postman v3 (folder)**, **Export as Postman v3 (JSON)**), and the Environments
dialog has **Export Environment** and **Export Globals** (a Postman globals
file).

Inherited auth is resolved on export: a request that inherits its auth from a
folder or the project still carries the effective auth in OpenAPI, Insomnia and
cURL output.

**Secrets never leave in a file.** The values of secret variables, project-auth
credentials and other machine-local secrets are written empty in every export (a
Postman export marks a secret variable `type: secret` with no value).

**What Postman v3 cannot carry.** v3 has no field for some Testnizer details.
They are left out and counted in one warning after the export ("N detail(s)
could not be carried into Postman v3"):

- the HTTP request timeout
- the Socket.IO handshake token and a fixed transport
- an auth type that has no Postman counterpart for that request type
- a saved example with no status code
- AI Chat custom headers and MCP tool servers
- MQTT XML / HTML payload formats, disabled message user properties and an
  unsaved message draft in the composer (save it as a saved message to export it)
- an MCP protocol pin other than Auto, Legacy or 2026-07-28 (it is exported as
  Legacy)

For everything else (WSDL, `.proto`, RAML, SoapUI), the original source files
travel with the project — Testnizer doesn't try to round-trip emit them, since
those formats are typically authored upstream. A cURL command for one request
comes from [Generate Code](/docs/protocols/http#code-snippet-generation).

## Test suite import

Test suites accept three formats via auto-detection:

- Testnizer native (`.tns` JSON)
- Postman collection (treated as a single regression set)
- Insomnia export (treated likewise)

Multi-format export for test suites is on the roadmap (currently only Testnizer
native is emitted).
