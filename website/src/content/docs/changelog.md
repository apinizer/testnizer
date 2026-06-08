---
title: Changelog
description: Release notes and version history for Testnizer.
order: 5
section: Reference
---

Every Testnizer build is tagged and logged here. This page is the
source of truth for release descriptions — the CI release job mirrors
each entry into the matching [GitHub Release](https://github.com/apinizer/testnizer/releases),
where signed installers and SHA-256 checksums are attached.

## v1.4.14

**Scripts can now fetch a token once and reuse it across the whole suite —
`insomnia.*` / `bru.*` script APIs are supported, and the Collection Runner
persists the variables your scripts write (Postman "Keep variable values").**

- **Insomnia / Bruno scripts:** pre-request and test scripts can now use the
  `insomnia.*` and `bru.*` objects (aliases of `pm.*`), so collections imported
  from Insomnia v5 and Bruno run unchanged. Previously
  `insomnia.environment.set(...)` threw "insomnia is not defined", the error was
  swallowed, and the variable was silently never set — a token created in a
  setup request never reached later requests and folder Runs failed with
  401 Empty Key! (issue #12).
- **Runner — persisted variables:** the Collection Runner now honours its
  "Keep variable values" setting. Environment / global variables written by
  scripts during a run (`pm.environment.set`, `insomnia.environment.set`,
  `pm.globals.set`) are saved back to the active environment / project globals
  when the run finishes, so a token fetched once is reused — and refreshed in
  one place — by every later request and by subsequent runs. Request-local
  `pm.variables.*` stay ephemeral, matching Postman.

**Tests:** 10 new regression tests (fail-before / pass-after) cover token reuse,
the Insomnia/Bruno script aliases, and variable persistence — bringing the unit
suite to 1706.

## v1.4.13

**macOS builds are now signed with an Apple Developer ID and notarized by
Apple — no more "unidentified developer" / "app is damaged" Gatekeeper block,
and in-app auto-update now works on macOS too.**

- **macOS — signed & notarized:** every macOS build is now code-signed with a
  Developer ID Application certificate and notarized through Apple's notary
  service, with the hardened runtime enabled. Gatekeeper opens the app directly
  — no right-click → Open workaround, and no "app is damaged and can't be
  opened" error on Apple Silicon.
- **macOS — auto-update:** because builds are now notarized, in-app automatic
  updates work on macOS as well (previously macOS users were routed to a manual
  download, issue #34).
- **Quality:** the automated test layer grew to 679 UI E2E tests and 1696 unit
  tests after a manual-checklist coverage sweep — new journeys cover header
  autocomplete, the resolved actual-request view, auth-type selection, mock
  CORS and proxy recording, Insomnia export, PFX/PKCS12 certificates and
  suite-item rename.

No functional changes to requests, protocols or data — this release is about
trust (signing) and verification (tests). Windows signing is still in progress.

## v1.4.12

**Request lifecycle polish (open-on-create, unsaved-changes dialog, dirty dots
for every protocol), real Digest/NTLM authentication, the Runner resolving
variables in every body type, and four reliability fixes — from corrupt-database
startup recovery to lost Socket.IO events.**

- **Requests:** a request created from the tree's right-click **Add Request** is
  now opened and focused immediately, matching the global "+ New" dropdown
  (issue #6).
- **Requests:** the unsaved-changes blue dot now appears for **all** protocols —
  SOAP, WebSocket, SSE, Socket.IO, gRPC and GraphQL — not just HTTP (issue #8).
- **Requests:** closing a modified tab no longer silently discards your edits.
  A three-way **Save / Discard / Cancel** dialog now guards the × button and the
  context-menu Close for every protocol (issue #9).
- **Auth:** **Digest** and **NTLM** authentication are now actually implemented.
  Previously both silently fell back to Basic, so servers requiring
  challenge-response auth always returned 401.
- **Runner:** `{{variables}}` inside **form-data**, **x-www-form-urlencoded**
  and **binary file path** bodies are now resolved during a Run, mirroring Send.
  Previously only raw body content was substituted, so form fields reached the
  wire as literal `{{...}}` (issue #10).
- **Import:** importing an **Insomnia v5 collection** now also imports its
  bundled environments as real environment rows with variables — no more adding
  every variable by hand after an import (issue #11).
- **Export:** the environment export dialog now suggests a
  `*.testnizer_environment.json` file name instead of a Postman-branded one.
  The file content stays Postman-schema compatible (issue #7).
- **SSE:** setting a **Last-Event-ID** before connecting no longer breaks the
  connection with a DOMException — custom headers are now merged correctly with
  the reconnect bookkeeping of the SSE client.
- **Socket.IO:** events pushed by the server **immediately on connect** (e.g. a
  `welcome` event) are no longer lost. The engine now buffers early events until
  the UI's event listener is attached, then replays them in order.
- **WebSocket:** a saved WebSocket request now restores its URL and settings
  when its tab is reopened. Previously the editor reverted to the default
  `wss://echo.websocket.org` even though the request was saved correctly.
- **Reliability:** if the local database file is corrupted, the app no longer
  fails to launch with no window and no message. The corrupt file is backed up
  next to the original, a fresh database is created, and a dialog explains what
  happened and where the backup lives.

## v1.4.11

**The Collection Runner now resolves environment variables exactly like Send —
a request that returns 200 OK with Send no longer fails with "Invalid URL" on
Run.**

- **Runner / Mock:** environment and global variables whose value lives only in
  the **Initial Value** column are now resolved during a Run. This is the common
  shape right after importing a Postman / Insomnia collection, or when only the
  leftmost column is filled in the environment editor. Previously the runner read
  only the **Current Value** column, so a `{{AccessURL}}`-style URL stayed
  unsubstituted and the request failed with **Invalid URL** — even though the same
  request returned 200 OK via **Send**. The runner and the mock server now mirror
  Send's dual-value model: Current Value, falling back to Initial Value. Folder
  and collection runs that resolve the project's active environment automatically
  benefit from the same fix.

## v1.4.10

**Two follow-up fixes on top of v1.4.9 — the Home page now refreshes after
an import, and the folder Run action opens the run instead of the Tests
overview.**

- **Import:** importing a project no longer requires an app restart to show
  up — the Home page project list refreshes immediately after the import
  completes.
- **Runner:** right-click **Run** on a folder now opens the run scoped to
  that folder's endpoints (the run config, ready to fire) instead of landing
  on the generic Tests overview.

## v1.4.9

**Follow-up fixes for four issues re-reported on v1.4.8 — folder
export/import, the folder Run action, the Windows installer shortcut, and
the macOS update path.**

- **Import / export:** exporting a collection made of saved requests and
  re-importing it via **Testnizer Native** now round-trips losslessly. The
  folder export was only collecting structured endpoints and silently
  dropping ad-hoc saved requests, so the collection came back empty.
- **Runner:** right-click **Run** on a folder in the APIs tree now opens the
  runner and switches to the Tests page where it lives, instead of opening
  it invisibly behind the APIs view — it used to look like nothing happened.
- **Windows:** the installer now creates the Start Menu and Desktop
  shortcuts explicitly, so there is always a launch point after install
  rather than having to re-run the installer `.exe`.
- **macOS updates:** because the macOS build is unsigned, electron-updater
  cannot self-install it; the update dialog now sends macOS users straight
  to the manual download (with an explanation) instead of a Download &
  Install button that always fails. A true in-app auto-update needs Apple
  signing + notarization.

## v1.4.8

**A broad sweep of the v1.4.7 user-reported issue list — request
settings, SOAP transport, mock templating, import/export, branch
isolation, and multi-project tabs — closing every open report.**

- **Request settings:** the per-request **Settings** tab now actually
  reaches the engine — timeout (0 = no timeout), max redirects, follow
  redirects, and SSL verification are honored per request instead of
  silently falling back to the project defaults. The URL bar and the
  **Params** tab stay in sync both ways (adding a param updates the
  URL; typing a query populates Params). `Shift+F` formats the body,
  and the `{{variable}}` highlight no longer pushes the caret off its
  character boundary.
- **Protocols:** WSDL-generated request bodies use the service's real
  target namespace instead of `http://tempuri.org/`, and a manual SOAP
  request sends its SOAP Action in the transport-correct place (quoted
  `SOAPAction` for 1.1, `action="…"` in the Content-Type for 1.2).
  Saved SOAP / WebSocket / Socket.IO / GraphQL / gRPC requests restore
  their full state when reopened; Socket.IO keeps its emit + subscriptions
  across disconnect; the WS-Security tool keeps its state across tab
  switches.
- **Mock servers:** response templating resolves request headers
  case-insensitively (per HTTP spec), the body hint documents
  `{{request.query.x}}` for query params, and the delete confirmation
  uses the app's styled dialog.
- **Import / export:** HAR import is available from the Import menu;
  Insomnia-imported query parameters now show in the URL like Postman;
  Testnizer-native imports land their content in the right place
  (project export → new project, folder export → into the current
  project); and an environment can be exported as a Postman-compatible
  file.
- **Branches & projects:** API-tree content is isolated per branch
  (content created on one branch no longer leaks to another), deleting a
  branch actually removes it, and **multiple project tabs stay open** —
  switching between projects no longer closes the previous one.
- **Navigation & settings:** the APIs search box filters the tree;
  right-click **Run** / **Export** and **Add Request** work; the New (+)
  menu gained Quick Request / Import; a header session menu (lock / set
  password / about) was added; the Environment manager is reachable with
  no request open; secret environment variables stay masked; the Themes
  accent color persists across restart; and Export project / Clear
  history show success feedback.
- **Update & packaging:** when an update can't self-apply (e.g. an
  unsigned macOS build) the dialog offers a manual-download link with a
  clearer message; Clone-from-Git writes the repository to disk; and the
  Windows installer shortcut configuration was hardened.

## v1.4.7

**Sweeping pass over the v1.4.4 user-reported bug list — Auto Update,
save flow, Test Suite runner, importers, every protocol editor — plus
security hardening for credential persistence.**

- **Auto Update:** Release notes in Settings → Update render as
  formatted HTML again (headings, lists, code spans) instead of raw
  `<h2>…</h2>` source text — a DOMPurify interop regression that had
  been hiding the changelog inside the modal. The Windows installer
  flow no longer reports success when `quitAndInstall` actually
  threw; the IPC reply carries the failure back to the modal so
  users see a real error message instead of a stalled "restarting…"
  state. The `update-downloaded` event also logs the on-disk
  installer path for post-mortem support.
- **File menu & keyboard:** File → New Tab / Close Tab / Save /
  Import… / Export… each drive the actual action now — previously
  three of these items fired into a dead custom-event handler and
  did nothing. `Ctrl+T` and `Ctrl+W` no longer double-fire: the
  menu accelerator and the window keydown listener were both bound
  to the same chord, so opening one tab actually opened two. Menu
  labels display the platform-correct modifier (`Cmd+T` on macOS,
  `Ctrl+T` on Windows/Linux). Close Tab from the menu now prompts
  for unsaved changes and tears down per-tab protocol state,
  matching the in-Workbench `Ctrl+W` path.
- **Save flow:** `Ctrl+S` on an already-persisted request updates
  the row in place instead of opening the folder-picker modal that
  used to create a duplicate APIs request when the active tab was a
  Test Suite item. SOAP, Socket.IO, gRPC, WebSocket, and SSE
  requests persist their full editor state (WSDL URL / namespace /
  proto path / custom headers / composer template / event-type
  filter / metadata) and re-hydrate it on reopen — closing a tab no
  longer drops you on an empty editor next time.
- **Test Suite & Runner:** "Create Test Suite from this folder"
  carries the source endpoint's default-case params, headers, body,
  and auth into each new suite item, so requests aren't blank when
  the user opens them. Default-case columns that are NULL leave the
  endpoint's template values intact instead of clobbering them with
  empty fallbacks. Basic auth credentials no longer leak into the
  displayed URL during a runner pass — they ride the Authorization
  header (RFC 7617), and the Run Results Request tab now shows the
  header that was sent. Header assertions (`Header exists` /
  `equals` / `contains`) handle case-insensitive lookup, trim
  whitespace symmetrically, and normalise headers that arrive as
  `[k, v]` pairs vs. a `Record<string, string>`. The Tests sidebar
  Import button opens the Test Suite import wizard — it used to
  open the APIs wizard, which rejected suite exports with a
  type-mismatch banner. Code → cURL / JS / Python snippet
  generators resolve `{{var}}` placeholders in URL, headers, body,
  and binary path so the snippet is paste-ready. All Runs → run
  detail survives a tab switch — the results panel was blanking on
  return because the snapshot wasn't being persisted.
- **Importers:** RAML files (`.raml`) are selectable in the native
  file picker, and `!include` directives no longer crash the YAML
  parser — the directive is preserved as a string placeholder, full
  include resolution remains future work. Testnizer-native exports
  detect under their proper `kind: "project" | "folder" |
  "testSuite"` shape and route through the native importer instead
  of being rejected as "JSON, not native".
- **Protocols:** Right-click on a folder → Add Request → protocol
  picker actually creates the request and surfaces failures via
  toast instead of swallowing them. SOAP → WS-Security Tool → "Send
  to active SOAP" injects the signed envelope into the right tab
  and fires the request (a tab-state race was leaving an older SOAP
  tab as the target). GraphQL Introspect handles schemeless URLs
  (`localhost:4000/graphql`), adds a default `Content-Type:
  application/json`, guards against an empty URL, and refuses to
  prepend `http://` when the URL still has unresolved `{{var}}`
  placeholders — the user gets "variable not defined" instead of a
  misleading DNS error.
- **History & credential hygiene:** Test results, console logs, and
  the captured `actualRequest` snapshot all restore when reopening
  a history row, so `pm.test()` verdicts come back into the Tests
  pane. `user:pass@host` userinfo is stripped from every persisted
  URL — the history table, the request snapshot, and the Run
  Results display — closing a v1.4.6 leak where credentials in the
  URL bar would land in SQLite forever. Legacy rows that already
  carry userinfo are sanitised on restore.
- **Internals:** `cleanupTabState` and `stripUrlCredentials` moved
  to shared helpers so the menu / keyboard / runner / engine paths
  all use the same teardown and the same credential-strip logic. A
  new `save-active-request` helper captures every protocol store's
  snapshot in one place so the Save As modal and the in-place
  Ctrl+S path stay in lockstep when a new protocol is added.
  `header_contains` matches `header_equals`'s trim semantics. The
  RunnerTab run-snapshot restore was moved into `useState` lazy
  initializers so an MB-scale `JSON.parse` no longer fires on every
  render.

## v1.4.6

**Every APIs Import format now rejects wrong-file-type input with a
single consistent error instead of silently creating empty folders or
producing misleading "missing field X" messages.**

- **Postman, Insomnia, SoapUI, cURL, Testnizer-native:** each
  importer verifies the input matches the format it was asked to
  load before doing anything else. Anything that doesn't match gets
  the same one-line message: *"This file is not a {format}. You
  can't upload this file type from here."* No phantom folders, no
  cross-contamination, no "six different validation hints for the
  same wrong file" guessing game.
- **Postman:** rejects standalone environment exports
  (`_postman_variable_scope: environment`) and arbitrary JSON blobs
  that aren't a v2.x collection. Postman v1 still gets its dedicated
  "re-export as v2.1" hint.
- **Insomnia:** rejects v5 environment YAML files. Insomnia v4
  collections that happen to carry environments alongside endpoints
  still work — v4 is request-shaped, the environments come along
  for the ride.
- **SoapUI:** rejects anything whose first 4 KB doesn't contain a
  `<con:soapui-project ...>` root element. Other XML / JSON / YAML
  files no longer make it as far as the project parser.
- **cURL:** rejects input that doesn't start with `curl ` (a leading
  shell prompt `$ ` is tolerated). Dropping a JSON file here used to
  hit the parser's vague "no URL found" message; now it gets the
  consistent wrong-file-type error.
- **Testnizer-native project:** collapses six different "missing
  field X" branches into the single generic error and now requires
  `kind: "project"` so a Postman / Insomnia / SoapUI / etc. file
  dragged into the native importer fails consistently. Genuinely-
  empty exports still get the dedicated "re-export the source
  project" hint so users know the file shape is right, just stale.
- **Environment-only imports** continue to work — they're just
  routed through the right entry point now. The Environments
  modal's Import action calls the new `import:postmanEnvironment` /
  `import:insomniaEnvironment` IPC handlers, which only accept env
  files and only touch the environments table.

## v1.4.5

**Hotfix: Windows update flow no longer uninstalls the app silently.**

- **Updater quitAndInstall:** The Windows installer is now launched
  with `isSilent: false`, so the NSIS wizard appears with a visible
  progress bar and any failure dialog. In v1.4.4 a silent install
  could fail after the previous version's uninstall step had already
  run, leaving the user with a fully removed app, no UI, and no
  diagnostic — the only indication was that the Start Menu / Desktop
  shortcut disappeared. The wizard now stays open through completion
  so the user can see — and report — what actually happened.
- **Removed custom NSIS hook:** The `build/installer.nsh` cleanup
  macros (added in v1.4.3 for the "Missing Shortcut" dialog) are no
  longer included in the build. They were a suspected contributor to
  the silent-install failure path. NSIS now uses electron-builder's
  stock install/uninstall flow without any local additions.
- **NSIS `oneClick: false`:** Switched from one-click silent install
  to the standard multi-step wizard. Users will now see the install
  progress + completion screen during an update, which both surfaces
  errors and gives a familiar shape to the upgrade.

## v1.4.4

**Hotfix: white-screen on OpenAPI 3 import + updater error visibility +
top-level error boundary.**

- **OpenAPI import (white-screen fix):** importing an OpenAPI 3 spec
  whose query/header parameters declared a numeric default (e.g.
  `page: { schema: { type: integer, default: 1 } }`) used to leave
  the renderer blank as soon as the user clicked the first imported
  request. The number was written straight into
  `saved_requests.params[].value`; on tab open KeyValueTable called
  string-only APIs (`isInsideVariableExpression`, suggestion filter)
  on it and threw `TypeError`, unmounting the entire React tree —
  and because the broken state was persisted in localStorage, every
  subsequent launch reproduced the same crash. Imports now coerce
  the default to a string (string passes through, null/undefined
  becomes empty, objects get JSON-stringified, everything else
  through `String()`).
- **Top-level ErrorBoundary:** any uncaught render crash now lands
  on a recovery panel instead of a blank window. The panel offers
  Reload, "Reset UI state &amp; reload" (wipes localStorage +
  sessionStorage but leaves the SQLite database — and therefore
  every project, request, environment, certificate, history entry
  — completely intact), and Copy error. The recovery exists so
  users who hit a crash before this patch can still rescue
  themselves.
- **Updater error visibility:** "Update check failed" no longer
  appears with zero detail. The renderer's updater store was only
  surfacing Promise-reject errors, but the IPC handler resolves with
  `{success:false, error:'...'}` on failure — so the real cause
  (network, feed not configured, GitHub rate limit) was discarded.
  The store now inspects the result and pushes the actual message
  onto `errorMessage` so the modal can show it.

## v1.4.3

**Second test-cycle bug remediation — 23 fixes across updater, import,
tests workbench, scripting, WSSE, GraphQL, history, and the Windows
installer.**

- **Updater modal:** Release notes now render as proper HTML (sanitised
  with DOMPurify) instead of literal `<h2>` / `<p>` / `<ul>` source —
  the GitHub Releases body that electron-updater hands us is real HTML,
  not Markdown, so the modal piped it straight into a JSX text node
  before. When a user hops more than one version (e.g. v1.4.1 → v1.4.3)
  the multi-release `ReleaseNoteInfo[]` payload is also joined together
  so every intermediate block is visible, not just the latest.
- **Windows updater:** "Missing Shortcut: Testnizer.exe has been
  changed or moved" no longer fires after an update. A custom
  `installer.nsh` proactively strips stale Desktop / Start Menu /
  Quick Launch shortcuts before electron-builder recreates them, and
  the NSIS `differentialPackage` flag is off so the full uninstaller
  + installer pair runs every time instead of patching in place.
- **Scripting:** `pm.execution.skipRequest()` now actually aborts the
  pre-request script — code after the call no longer executes
  (previously it set a flag but kept running, contradicting Postman's
  documented behaviour). Synchronous abort happens via a sentinel
  error the runtime catches silently.
- **Import:**
  - **Insomnia v4 environment exports** are now persisted as real
    `environments` rows + variables. v4 used to land only in
    `suggestedEnvVars` and never appeared in the Environment Manager,
    so users saw a "Imported" toast and an empty list.
  - **Swagger 2.0 (OpenAPI v2)** request bodies are no longer empty:
    `parameters[].in='body'` now generates a JSON example from the
    schema and `in='formData'` pre-fills the form-data table with
    every form field. petstore-style imports show a usable starter
    payload instead of "This request does not have a body".
  - **Test-suite re-imports** of the same native export now produce
    `X`, `X (1)`, `X (2)` instead of two suites sharing the same name
    (the Postman/Insomnia branch had this; the native branch missed
    it).
- **Tests workbench:**
  - Run-results Request tab now shows the headers / body / URL the
    engine actually put on the wire (Content-Type, Host, User-Agent,
    Authorization from the Auth tab, query params resolved into the
    URL). Previously the panel only listed the user-typed headers, so
    auth tokens and content negotiation appeared to be missing.
  - Saving a suite item then closing and reopening it now restores
    the freshly-saved request schema instead of a pre-edit cache.
    The per-tab `_tabStates` cache was holding the original snapshot
    and override-loading after the DB read.
  - Saving a request from the URL bar also syncs the active tab's
    method / url / protocol chip so GET → POST changes appear on the
    tab immediately, without a close+reopen.
  - Method-type change in the tab no longer requires close+reopen to
    update the badge.
  - Opening a run from All Runs, switching tabs, and coming back no
    longer drops the user on an empty detail panel — the selected
    result id is now persisted with the tab's sessionStorage so the
    same row stays highlighted.
  - APIs tree right-click → Add Request now auto-expands the parent
    folder, so users see the freshly-added request even if they were
    looking at a collapsed branch.
- **Save dialog:** Saving a SOAP / WebSocket / SSE editor's request
  into a folder now persists the actual protocol payload — previously
  the modal only read the HTTP request store and silently inserted an
  empty `protocol: 'http'` row. Each protocol's store is consulted on
  save, and protocol-specific metadata (WSDL URL, selected operation,
  WS-Security config) round-trips through the new `metadata` column.
- **Save modal scrollbar:** A long folder list no longer reflows the
  whole dialog when the scrollbar appears — `scrollbar-gutter: stable`
  reserves the gutter so the layout stays crisp.
- **Response pane:** The two no-op icons in the Response Body toolbar
  (Search + Open-in-new-tab) have been removed — Filter already
  covered substring/JSONPath search and the second button was never
  wired.
- **Console pane:** The Layout (maximize) button in the Console
  header is now functional. From the response-pane in-tab view it
  promotes the console to the global bottom panel; from inside that
  bottom panel it toggles between the user-resized height and a
  near-fullscreen (~78%-of-viewport) maximised view.
- **File menu:** The native File menu used to contain just "Exit".
  It now lists New Tab (⌘/Ctrl+T), New Window, Import…, Export…,
  Save, Settings…, Close Tab, and Exit, all wired to the matching
  in-app actions over a new `menu:*` IPC channel.
- **Help / About:** "Source repository" in the Privacy Policy and
  EULA footers now points at the **public**
  `apinizer/testnizer` repo (the private source repo was
  giving users a 404). Postal address corrected from İstanbul to
  Ankara.
- **WSSE tool:** "Send to active SOAP" now both injects the signed
  envelope into the SOAP tab AND fires the request, so one click
  performs the full handshake users expected. Previously the body
  was updated silently and nothing went on the wire.
- **GraphQL Introspect:** Real introspection failures (HTTP errors,
  malformed JSON, `errors[]` body, missing `data` field) surface as
  the actual error message in the schema panel. The previous fallback
  silently swapped the real failure for a hard-coded demo schema —
  users could not tell why their endpoint's queries weren't running.
- **History:**
  - The Today / runner-history side panel auto-expands every
    runner-history folder grouping the first time it appears, so
    suite-run rows are visible without a manual click.
  - Clicking a suite-run request entry now shows the response body,
    headers, and body-size detail. The history `response_snapshot`
    column was previously only persisting `status` / `statusText` /
    `timing`, leaving the detail panel empty.
- **Code panel:** Unresolved `{{var}}` placeholders in the cURL /
  JS / Python snippet now surface as a small orange banner above
  the editor ("Unresolved: {{employee_body}}"), so users immediately
  notice when an environment variable referenced by the request is
  missing.
- **Internals:** DNS-failure assertion in the http-engine error tests
  was broadened to accept the `ECONNABORTED` timeout path some
  resolvers take for `.invalid` hostnames, eliminating an
  environment-dependent CI flake.

## v1.4.2

**Legacy TLS support, Postman-parity Console, every v1.4.1 test-cycle bug closed.**

- **Legacy TLS (1.0 / 1.1) talks to enterprise backends again.** Banking,
  government, and insurance API gateways that still mandate TLS 1.0 or
  1.1 are reachable out of the box: Testnizer detects the protocol pin
  in Settings → Certificates and routes the request through a bundled
  static `curl` binary (per-platform, ~3MB) that uses the OS TLS stack.
  No system install required — the binary ships with every installer,
  including locked-down Windows images with `curl.exe` stripped from
  `PATH`. The cipher suite drops to `DEFAULT@SECLEVEL=0` automatically
  for legacy handshakes; the dropdown labels surface the routing path
  honestly ("TLS 1.0 — via system curl"). Modern TLS 1.2/1.3 keeps the
  fast axios path with no overhead.
- **Scripting:** The `pm` API gained the surface Postman scripts depend
  on. `pm.request` now populates in pre-request scope (method / URL /
  headers were empty before); `pm.request.headers` is a case-insensitive
  collection with `add` / `upsert` / `remove` / `get` / `has` / `each`;
  pre-request mutations are folded into the outgoing request before the
  wire send. `pm.environment.has` / `.unset` and `pm.globals.has` /
  `.unset` added. `pm.execution.skipRequest()` actually aborts the send
  now. `pm.response` access in a pre-request script throws a clear
  error instead of returning a phantom shell. `CryptoJS` is exposed as
  a built-in script global for AWS SigV4 / HMAC / webhook signing.
- **Import:** Insomnia v5 YAML environment exports import correctly —
  the EnvironmentModal detects the v5 shape from the raw text and
  routes through the main-side YAML importer. Postman + Insomnia env
  imports now surface inner failures (project not found, missing
  fields) instead of false-positive "imported" toasts. Project imports
  apply an `(imported)` / `(imported N)` suffix when a workspace
  already has a project with the same name. Folder/project exports
  show a success toast and clear error message on failure.
- **Tests workbench:** The "New Run" button on the Overview, All Runs,
  and Scheduled Tasks tabs is one shared component with identical
  styling, and opens the same Test Suite picker dropdown. The legacy
  APIs-tree picker that listed every endpoint in the project is gone
  — Test Suites are the entry point. Random tab switches no longer
  drop the user into an unscoped config view showing 200 endpoints
  (stale `sessionStorage` view restore guard). Runner iteration
  grouping now renders each iteration as its own collapsible group;
  the "New Run" blank screen on click is fixed.
- **Console:** One collapsible entry per request/response cycle
  (matches Postman). Expanding shows Network meta, Request Headers,
  Request Body, Response Headers, Response Body, and Script Logs in a
  single row. The two clipped tabs in the response pane ("Console" +
  "Actual") that duplicated the same data have been removed. The
  globe popover with Network / Timings tables no longer gets clipped
  behind the Console panel — it's portaled and flips upward when
  space below is constrained.
- **Branches:** Settings → Branches lists `main` correctly (was
  missing for projects that pre-dated branch seeding) and shows
  exactly one active branch at a time (two-active state fixed).
- **History:** Clicking a history row opens it in a tab — both HTTP
  and SOAP entries route correctly now. The sidebar flips to APIs so
  the new tab is actually visible (it used to open silently while the
  History welcome surface stayed in place).
- **Windows updater:** Silent one-click updates that preserve Start
  Menu / Desktop shortcuts. Differential packaging cuts update
  download size to the changed blocks only. The "Problem with
  Shortcut: 'Testnizer.exe' has been changed or moved" dialog is
  fixed — installs go to `%LOCALAPPDATA%\Programs\Testnizer` per-user
  with no UAC. First hop from v1.4.1 to v1.4.2 still shows the old
  wizard once (the installed uninstaller is v1.4.1's NSIS); from
  v1.4.2 onward the new silent flow takes over.
- **Internals:** macOS x64 CI runner moved from `macos-13` (dead
  pool, jobs queued 10+ hours) to `macos-14` with `--x64`
  cross-build. Scheduler test DB schema synced with production
  migrations. `pm.request.headers` storage rewrote to RFC 7230
  case-insensitive semantics. Bundled curl 8.20.0 with OpenSSL 4.0
  backend.

## v1.4.1

**Scheduled Tasks rebuilt around Test Suites, sidebar polish, native About.**

- **Scheduled Tasks:** The "New Run" button now opens a Test Suite
  picker — schedules are owned by Test Suites, by design, so the
  ad-hoc APIs endpoint picker is gone. Each task row expands to show
  both the endpoints inside it (method badges + name + URL) and the
  last ten runs (When / Result / Tests / Duration). A per-row "Run
  now" button fires the task without waiting for the next cycle.
- **Schedule Configuration** gained Interval / Daily / Weekly / Cron
  modes. Daily / Weekly take a local-time `HH:MM`; Weekly adds a
  weekday chip selector; Cron accepts a 5-field expression with live
  validation. The scheduler timer recomputes the next fire after each
  run so daily / weekly / cron don't drift.
- **Runner config:** The "Schedule runs" radio only shows up when the
  run is sourced from a Test Suite. APIs-tree and folder runs are
  one-shots — hiding the radio there prevents stranded "Scheduled:
  ad-hoc" tasks no one knows where to find. Tests sidebar landing
  now lands on the Tests Overview instead of a 200-endpoint runner
  config screen.
- **Sidebar:** A dedicated Import button sits next to the "+" New
  button on both APIs and Tests sidebars. Picking a format opens the
  Import wizard directly on step 2 instead of the old two-click
  "open modal, then pick format" path. The format list dropped the
  logo grid (cURL / RAML / WSDL had no real logo, so we were just
  printing the name twice) in favour of a categorised list (Specs /
  Collections / Quick). All sidebar action buttons standardised at
  28×28 with matching icon size and stroke weight; the Mocks panel
  used to be 26×26. The History sidebar header lifted to 44px so it
  matches the rest of the chrome.
- **Tree right-click:** Endpoint right-click gained "Create Test
  Suite from this request" and "Create Mock Server from this
  request"; the resulting suite or mock auto-takes the request's
  name. The Run entry on folder right-click was removed — Send
  already covers the single-endpoint case and Test Suite covers the
  multi-endpoint one.
- **Import / Export icons:** Direction fixed across the app — Download
  (arrow down, into the system) for Import, Upload (arrow up, out)
  for Export. Affected the Tests panel context menu, the Project Hub
  home button, and the Environment modal.
- **Footer + native About:** The Runner footer link was removed (the
  Tests sidebar's Overview / All Runs / Scheduled Tasks entries
  cover it explicitly). The Enterprise button now opens an in-app
  modal with a copy-to-clipboard email address — body covers
  licensing, on-prem deployment, and dedicated support. The macOS
  "About Testnizer" menu item now opens our branded About modal
  instead of Electron's default panel (atom logo + framework
  version).
- **Console panel:** The dead three-dot button in the toolbar was
  removed — it had no click handler and overlapped the Auto / Clear
  actions. The toolbar gained right padding so it no longer collides
  with the panel's close button.
- **Internals:** Added `scheduled_task_id` to `runner_history` so
  per-task history survives task renames. Added `schedule_type`,
  `schedule_time`, `schedule_days`, `schedule_cron`, and `suite_id`
  columns to `scheduled_tasks` (additive — legacy rows stay on the
  'interval' path). New `scheduler:history`, `scheduler:runNow`,
  `scheduler:taskEndpoints`, and `scheduler:validateCron` IPC
  handlers back the new UI. A custom macOS application menu replaces
  the default so the About item is hookable. CI gained a new
  `cleanup` job that drains old artifacts, caches, and workflow runs
  before every build, and artifact retention dropped from 90 days to
  1 day — the Actions storage quota was killing release builds.

## v1.4.0

**Three-team QA pass: scripts run again, exports round-trip, Test Suite is honest.**

- **Scripts:** Pre-request and post-response scripts execute again —
  v1.3.1 shipped a CSP that blocked `new Function()`, so every `pm.*`
  script silently failed with "Refused to evaluate a string as
  JavaScript". The renderer CSP now permits `'unsafe-eval'` for user-
  authored scripts. The `pm.expect` chain understands the Chai-BDD
  connectors it had been missing: `.that`, `.with`, `.is`, `.and`,
  plus `.empty` and `.lengthOf(n)`. Assertions like
  `pm.expect(res.errors).to.be.an('array').that.is.empty` now pass
  when the response matches. The Scripts and Tests tabs gained a
  green-dot indicator when a script or assertion is present, matching
  the Auth tab convention. The Scripts Reference modal traps
  Ctrl/Cmd+A inside the focused snippet instead of selecting the
  entire dialog.
- **Backup & restore:** Export Project now refuses to write a 200-
  byte stub when the project's data didn't load. The export payload
  returns a count summary (folders / endpoints / environments /
  suites / mocks) that the UI surfaces in a toast, and the importer
  rejects empty shells with a specific error instead of "Invalid
  project file format". Round-tripping a project through Export →
  Import works end-to-end again.
- **Test Suite:** Form-data bodies appear in the generated cURL.
  cURL snippets resolve `{{variable}}` placeholders against the
  active environment instead of emitting them verbatim. Suite
  imports auto-disambiguate by appending `(1)`, `(2)`… when a suite
  with the same name already exists in the project. Test Suite
  Import → Insomnia now accepts `.yaml` / `.yml` files (Insomnia v5
  export shape). Insomnia v5 environment YAMLs route to a dedicated
  importer instead of falling through to the v4 path. The runner
  tab is singleton — right-clicking "Run" three times no longer
  leaves three phantom runner tabs behind. The suite-item right-
  click menu dismisses on outside click. The runner history
  snapshot now includes the resolved headers, query params, body
  preview, and auth type so the Request panel in run details
  reflects what actually went out on the wire. The right-click
  "Run" path opens the runner's configuration view instead of
  auto-starting, and the runner tab's active view (config / results
  / history) persists across tab switches.
- **Import / Export:** Postman imports skip stray "New Request"
  placeholder items (URL empty + default name). Folder export
  filenames use the project's display name and drop the duplicated
  `folder-` prefix; the v1.3.1 `folder-folder-2026-mm-dd.json`
  filename is gone. The format picker gained a "Testnizer Native"
  entry that reuses `save:importProjectFromContent` to load an
  export as a new project. Import → cURL now offers a code-mode
  textarea alongside the file picker. The SoapUI importer walks
  `con:resource` / `con:method` trees in addition to
  `con:operation`, so REST endpoints in SoapUI 5.x projects no
  longer disappear into empty interface folders.
- **Environment imports:** Postman environment imports and Insomnia
  v4 environment imports now propagate to the active-environment
  selector — the import success toast no longer lies.
- **Branch UX:** Creating a branch automatically switches to it
  (matches VS Code / IntelliJ / GitKraken). The branch dropdown
  lists the current branch even when the git fetch came back empty,
  so the pill and the menu agree.
- **Project Hub:** Wizard avatar initials are consistent between
  the Details preview and the Storage Settings summary card — both
  pull `display_name` instead of letting Storage Settings derive
  initials from the slug. `Cmd/Ctrl+P` opens the Project Hub. The
  header project pill has a tooltip pointing users to the same
  shortcut and goes home on click — addresses the v1.3.1 "MP
  avatar doesn't do anything" UX complaint. Right-clicking a
  folder now triggers a real server-side deep clone (sub-folders,
  endpoints, saved requests) in a single transaction; the Project
  Hub `…` menu gained a Duplicate item backed by the same export →
  import-as-new pipeline.
- **Sidebar:** The tree root label shows the project's display
  name instead of its slug. Tree right-click on the project root
  reads "Create Test Suite from this project" / "Create Mock
  Server from this project" (separate i18n keys; EN + TR mirrors).
  Exporting the project root routes through `save:exportProject`
  instead of `save:exportFolder`, so the JSON correctly carries
  `kind: 'project'`. Folder duplication now surfaces a clear toast
  explaining the feature isn't wired yet, instead of silently doing
  nothing. The most recent five requests render as one-click cards
  on the APIs welcome screen with status colour, method badge,
  and a "Xm ago" stamp.
- **APIs ↔ Tests ↔ Mocks round-trips** restore the previously-
  focused tab instead of dropping the user on the welcome screen.
  The tabs store bookmarks the last-active tab per sidebar page.
- **Commit history sidebar:** The History sidebar gained a
  "Commits" tab that lists git commits for the active project's
  branch — endpoint Save actions now show up where users expect
  them.
- **Certificates:** The Project Settings modal's Save Changes
  button actually closes the modal after a save. TLS 1.0 / 1.1 are
  marked "not supported" in the version dropdowns and explicitly
  coerced to the BoringSSL default at runtime, so selecting them no
  longer fails with `ERR_SSL_INVALID_COMMAND` — the option only
  ever existed as false advertising.
- **About:** Reads its version from `package.json` (bundled at
  build time) with `app.getVersion()` as a fallback, so the dialog
  never shows the Electron framework's `1.0.0` placeholder again.
- **Cmd/Ctrl+S** prefers the active endpoint / saved request /
  suite item tab over the project save modal, even before the
  protocol field has propagated through tab state.
- **Headers autocomplete:** Substring matching — typing "type"
  surfaces "Content-Type" again. Prefix matches stay at the top.
- **Variables:** The runner-side Variables panel masks
  `type: secret` values with `••••••••` instead of showing them in
  plaintext.
- **Status bar:** `ui.store.setStatusMessage(text, ttlMs)` provides
  a centralized, auto-clearing status message slot so stale banners
  can't outlive their relevance.
- **New endpoint baseline:** "+ New" in the tab strip and every
  welcome card flips every protocol store to its empty state via a
  Workbench effect on `activeTabId`. Previously a fresh tab
  inherited the last endpoint's URL / params / scripts. The
  "+ Insert example" button on the Scripts tab is also always
  visible now, appending the snippet instead of vanishing on first
  keystroke.
- **HTTP timing breakdown** is rebuilt on top of socket lifecycle
  events (`lookup`, `connect`, `secureConnect`) plus axios's
  `onDownloadProgress` for TTFB / download split. TLS handshake is
  populated for HTTPS requests; download time reflects the body
  stream.
- **Internals:** Tab state cache is bounded — the request store
  evicts the oldest entries after 20 cached tabs so long sessions
  don't accumulate unbounded per-tab state. Added regression
  coverage for the Chai chain, the TLS version validator, header
  autocomplete substring semantics, `validateProjectExport` (7
  cases), the Postman placeholder-item filter, and the Insomnia v5
  environment YAML importer.

## v1.3.1

**Import-everywhere overhaul, Script Reference, and a deep audit pass.**

- **Imports:** The Tests panel Import button now opens a format-picker
  modal (Testnizer / Postman v2.x / Insomnia v4-v5) instead of dropping
  straight into the OS file dialog. The APIs-side importer accepts every
  Insomnia 8 document subtype (`collection`, `spec`, `proxy` — previously
  rejected as "unknown format") and falls back to `js-yaml` so Insomnia v5
  YAML exports land as either endpoints or test suites without re-saving
  as JSON. A 44-test fixture audit drives 18 real Insomnia exports plus a
  Postman + SoapUI fixture end-to-end.
- **Environments:** A dedicated Import button in the Environment modal
  picks up Postman environment files and Insomnia exports, friendly-routes
  Postman collections to the APIs path, and toasts a clear error for
  anything unrecognised.
- **Scripts:** A "?" Script Reference modal opens from both the Scripts
  tab (Pre / Post variants) and the Tests tab's Post-response Script
  block — 4-6 ready-to-copy snippets, a 15-row `pm.*` API table, and
  notes on aliasing / async / scope / console.
- **Headers UX:** Value-cell autocomplete now covers Accept, Cache-Control,
  Connection, Authorization, X-Requested-With and friends, opens on focus
  even when the cell is empty, and anchors the popup to the cell DIV so it
  no longer renders off-screen. The Variable Autocomplete (`{{var}}`)
  works in the same cell.
- **Runner Results:** Request and Response panes now match standard HTTP
  message order — status / headers above, body below — and the Request tab
  surfaces Method + URL as a summary header.
- **Test Suite items** are fully self-contained (copy-on-add): deleting
  the source endpoint no longer empties the suite. Clicking a suite item
  reliably opens its editor under the Tests page (the routing bug that
  silently filtered them into APIs is fixed).
- **Command Palette:** `Cmd+K` opens a `cmdk`-backed palette with
  endpoint, recent, tool, mock-server, and settings categories. `?` opens
  a keyboard-shortcut cheatsheet.
- **Toasts + a11y:** `sonner` toast notifications, EmptyState components
  widened across panels, and every custom modal migrated to a Radix
  Dialog wrapper for ESC + focus-trap + click-outside dismissal.
- **Cancellable requests:** Every protocol (HTTP, SOAP, WebSocket,
  GraphQL, gRPC, SSE, Socket.IO, MCP) now honours an in-flight Cancel
  click and stops the work in the main process.
- **About page** now renders proper labels (Version / Platform / Electron
  / Node / Chrome / License) in both EN and TR — previously showed raw
  i18n keys.
- **Page-aware workbench:** The tab strip is scoped to the active sidebar
  page; switching pages clears the active tab when it doesn't belong, and
  an empty workbench shows the right welcome surface (Project welcome on
  APIs, TestsHome on Tests, EmptyState on Mocks / History / Tools).
- **Fixes:** Imports stay on the originating page (no surprise jump to
  Tests after an APIs import). Pre-script / post-script `pm.test()`
  results merge with visual assertions into a single `response.testResults`
  array. Postman environment files are correctly detected when picked
  through the Postman import path. `Cmd+S` saves the active tab.
- **Internals:** Tightened IPC handler typings, dropping renderer-side
  `any` casts. Validated every renderer-supplied path in main-process
  handlers. Bumped `simple-git` to 3.36.0 and `fast-uri` to 3.1.2 for
  RCE / path-traversal advisories. Removed pre-release migration code.
  Project export → import now preserves the `project_id` foreign key
  for environments and global variables (was silently dropped). Cleaned
  up duplicated import format detectors. Added 250+ tests covering IPC
  handlers, suite multi-format imports, project export round-trip,
  header value suggestions, page routing, cert + mTLS pipeline, and an
  opt-in BadSSL network suite gated on `BADSSL_NETWORK=1`.

## v1.3.0

**Git collaboration and history coverage.**

- Added a side-by-side **Use mine / Use theirs** picker for `git merge` and
  `git pull` conflicts, with item-count summaries for endpoints, mock servers,
  test suites, and environments.
- Added a per-file tab strip for multi-file conflicts, locale-aware commit
  messages, and conflict abort support.
- Extended `git push / pull / branch-switch` round-trip to Mock Server, mock
  endpoints, mock responses, and client certificates — previously DB-only,
  so branch switching silently dropped them.
- Recorded request history for every protocol: SOAP, GraphQL, gRPC unary,
  WebSocket / SSE / Socket.IO (connection-level), and MCP tool calls. The
  History panel now shows the full picture, scoped to the active project.
- Stopped the macOS login-screen About button from slipping under the
  traffic-light cluster.
- **Internals:** Parallelized `git.show` reads during conflict resolution,
  trimmed dead payload from IPC, deduplicated the import-from-disk helper,
  added 13 unit tests for the conflict resolver.

## v1.2.0

**Mock Server and Tools workbench expansion.**

- **Mock Server:** Added a real HTTP server bound to `127.0.0.1` with
  multi-instance support.
- Supported endpoint matching by exact, param, wildcard, and regex.
- Implemented conditional responses on header, query, path-param,
  body-JSONPath, body-XPath, and method, with `and` / `or` composition.
- Added Handlebars and dynamic-value templating, plus pre-response
  JavaScript in a 5-second `vm` sandbox with per-server in-memory state.
- Added Bearer / Basic / API-key auth (per-endpoint override), draft-07
  JSON Schema body validation, failure injection, sliding-window rate
  limit, fine-grained CORS, a `/__echo` endpoint, and proxy passthrough
  with optional recording.
- Supported OpenAPI 3 and Postman v2 import. Added a full URL bar with
  Copy / Copy as cURL / Open and a live request log.
- **Tools workbench:** Shipped 17 offline tools — JWT debugger reworked
  (Decoder + Encoder tabs, JSON / Table view, Generate example for every
  algorithm), side-by-side diff with intra-line character highlights,
  Hash and HMAC calculators (RFC vectors), Epoch converter, HTTP status
  code reference, base converter (ASCII / Bin / Oct / Dec / Hex), JSON
  Schema generator, JSON ↔ XML converter, UUID generator (v1 / v4 / v5
  / v7), Regex tester with cheatsheet, and YAML ↔ JSON converter.
- Bundled 17 ready-to-load samples per evaluator (JSONPath, XPath,
  Jolt, XSLT).

## v1.1.1

**Runner, test engine, console, and import polish.**

- **Collection Runner:** Fixed multi-iteration execution, expanded result
  rows with Request / Response / Tests tabs, and corrected the
  skipped-count.
- **`pm` test engine:** Awaited async `pm.test()`, fixed the `pm.expect()`
  chain getter, populated `pm.info.requestName`, and implemented
  `jsonBody(path)`.
- **AI Chat:** Made the endpoint URL always visible and refreshed 14
  providers for the 2026 model catalogue.
- **Console:** Added gRPC trailers, WS / SSE / Socket.IO / MCP handshake
  headers, per-event timing and sizing, and completed the filter dropdown.
- **Import / export:** Preserved GraphQL body on Postman and Insomnia
  round-trip, and honoured the HAR disabled flag.
- **Enterprise:** Added enterprise contact to the About modal, Footer, and
  EULA. The EULA gained no-maintenance and air-gap clauses.

## v1.1.0

**MCP, Socket.IO, and Postman parity.**

- Added MCP (Model Context Protocol) and Socket.IO protocol support.
- Imported Postman scripts and collection variables on collection import.
- Added gRPC reflection support (v1 and v1alpha).
- Added tab persistence and an IDE-style right-click menu with `Cmd+T`
  and `Cmd+W` shortcuts.
- Extended the `pm` and `t` test API.

## v1.0.3

- Improved the WS-Security workbench.
- Fixed SOAP UI bugs.
- Deduplicated open tabs.

## v1.0.2

- Added full gRPC streaming support.
- Added GraphQL subscriptions.

## v1.0.1

- Expanded import formats: HAR, Insomnia v4, SoapUI.

## v1.0.0

- Initial public release.
