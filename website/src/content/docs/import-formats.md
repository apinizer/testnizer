---
title: Import & export
description: Bring your existing collections from Postman, Insomnia, OpenAPI, Swagger, cURL, WSDL, .proto, RAML, SoapUI, and HAR.
order: 1
section: Guides
---

Testnizer accepts ten input formats and emits four. Imports are designed for
**lossless round-trip** for the documented surface — including pre-/post-scripts
and collection variables, not just the URL and method.

## Formats matrix

| Format | Import | Export | Notes |
|---|---|---|---|
| **OpenAPI 3.x** | ✓ | ✓ | Security schemes mapped to auth, examples preferred over schemas |
| **Swagger 2.0** | ✓ | — | Read-only; export emits OpenAPI 3.0.3 |
| **Postman v2.1** | ✓ | ✓ | `event[]` (pre/test scripts) and `variable[]` round-trip |
| **Insomnia v4** | ✓ | ✓ | Form-data file fields, env shapes, script shim |
| **cURL** | ✓ | ✓ | Chrome "Copy as cURL", Windows cmd, multipart, ANSI-C quoting |
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

### Postman v2.1

- Collection variables become a **project-scoped environment** (named after the
  collection)
- `event` array (`prerequest` and `test` scripts) is preserved verbatim
- Auth, headers, and body modes map 1:1
- The `pm` API is shimmed to be Postman-compatible — most existing scripts run
  unchanged

Postman variables are collection-scoped in Postman, but Testnizer scopes them
to the **project** instead. This avoids cross-collection leakage when importing
multiple Postman collections into a single Testnizer project.

### Insomnia v4

- Workspace becomes a project
- Request groups become endpoint folders
- Form-data file fields preserve the file path reference
- Pre-request scripts work via the same `pm` shim
- Environment objects become Testnizer environments

### cURL

Paste any cURL command into **Import → cURL** or directly into the URL bar
(Testnizer auto-detects). Supported flags include:

- Standard: `-X`, `-H`, `-d`, `--data`, `--data-raw`, `--data-binary`,
  `--data-urlencode`
- Multipart: `-F`, `--form`
- Auth: `-u`, `--user`, `--basic`, `--bearer`
- TLS: `--cert`, `--key`, `-k`, `--insecure`, `--cacert`
- Cookies: `-b`, `--cookie`, `-c`, `--cookie-jar`
- Proxy: `-x`, `--proxy`, `--proxy-user`
- Output: `-o`, `--output`, `-O`, `--remote-name` (silently dropped)
- Timing: `--max-time`, `--connect-timeout`
- 40+ flags total

Quoting works for both POSIX (`'…'`) and Windows cmd (`^"…^"` carets). ANSI-C
quoting (`$'…'`) is parsed but escape sequences inside aren't decoded yet —
see open issues.

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

**File → Export** offers four output formats:

- **Postman v2.1 collection** — lossless for scripts and variables
- **Insomnia v4 export** — lossless for requests and environments
- **OpenAPI 3.0.3** — uses round-trip metadata to reproduce the original spec
- **cURL commands** — one-line per request, with all auth and bodies inlined

For everything else (WSDL, `.proto`, RAML, SoapUI), the original source files
travel with the project — Testnizer doesn't try to round-trip emit them, since
those formats are typically authored upstream.

## Test suite import

Test suites accept three formats via auto-detection:

- Testnizer native (`.tns` JSON)
- Postman collection (treated as a single regression set)
- Insomnia export (treated likewise)

Multi-format export for test suites is on the roadmap (currently only Testnizer
native is emitted).
