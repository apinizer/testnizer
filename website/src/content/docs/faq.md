---
title: Frequently asked questions
description: Answers to common questions about offline usage, data storage, compatibility, licensing, and migration from Postman.
order: 3
section: Reference
---

## How do I migrate from Postman?

Open the **Import** dialog (`File → Import` or drag a file onto the left
sidebar), pick the **Postman** card and select your Postman file. Testnizer
reads Postman Collection **v1, v2.0, v2.1 and v3** (a single JSON file, or a
Postman 12 *Native Git* folder through **Import folder…**), Postman
environments and globals files, a Postman data export, and `.zip` archives of
those. It detects the version from the file, so you do not choose one.

Folder hierarchy, request descriptions, pre-request scripts, test scripts,
saved examples and authorization settings are preserved. Collection variables
become the project's **Globals**, and collection-level auth and scripts move to
the import folder instead of being copied into every request. When something
cannot be carried over (an auth type Testnizer does not have, a Kafka request,
a `pm.require` call), the **Import finished** panel lists it. See
[Import & export](/docs/import-formats#postman) for the details, and
[Environments & variables](/docs/environments#globals) for Globals.

---

## Which protocols does Testnizer support?

HTTP / REST, SOAP, WebSocket, GraphQL (queries, mutations and subscriptions),
gRPC, SSE, Socket.IO, MQTT, MCP and AI Chat, each with its own editor. Mock
servers come in four kinds (HTTP, SSE, AI and MCP). See the
[Protocols overview](/docs/protocols) and [Mock servers](/docs/mock-server).

---

## Does Testnizer send any data to external servers?

No. Testnizer is a standalone desktop application. All HTTP requests are made
from the main Electron process directly to the target API — there is no
Testnizer relay server, telemetry endpoint, or analytics service involved in
any network call. You can verify this by inspecting outbound traffic with a
local proxy: the only connections are to the hosts you explicitly request.

---

## Can I use the same installation on Windows, macOS, and Linux at the same time?

Yes. Testnizer stores all data in a local SQLite database
(`testnizer.db`) inside the application data directory on each machine. There
is no centralized account or license server. Install the appropriate platform
package on each machine independently. If you want to share collections across
machines, use the Git integration (see "How do I share with my team?" below).

---

## How do I share a collection with my team?

There are two approaches.

**Git repository (recommended).** Initialize a Git repository inside the
project folder from the branch panel in the left sidebar. Commit and push
changes as you would with any codebase. Team members clone the repository and
open it in Testnizer. Branches map directly to Testnizer branches. A pull brings the whole project,
including project-level authentication, scripts and request settings. Secret
variable values, mock tokens and certificate passphrases are never written to
the file, so each teammate enters their own; a pull tells you how many secret
values are still empty on your machine. See [Git integration](/docs/git-branches).

**Database copy.** For one-time transfers, you can copy the `testnizer.db` file
from one machine to another. The file is located in `~/Library/Application
Support/Testnizer` on macOS, `%APPDATA%\Testnizer` on Windows, and
`~/.config/Testnizer` on Linux. This replaces all data on the target machine,
so use it only for initial setup or migration scenarios.

---

## Will my existing Postman scripts work in Testnizer?

Most scripts work without changes. Testnizer implements the `pm` scripting API
including `pm.request`, `pm.response`, `pm.environment`, `pm.globals`,
`pm.collectionVariables`, `pm.variables`, `pm.vault`, `pm.test` (including the
`done` callback form), `pm.expect`, and `pm.sendRequest`.

The following Postman-specific features are not supported:

- Visualizer (`pm.visualizer.set()`) — no equivalent; output is ignored
- `pm.require()` (Postman package libraries) — throws a clear "not supported"
  error; the built-in `require()` libraries cover the common cases
- `pm.info.iteration` and `pm.info.iterationCount` — available only inside the
  collection runner context, not in single-request runs
- References to the built-in Postman cloud or monitor APIs

A script that calls `pm.require()` fails with a clear "not supported" error,
and the import report names scripts that use it. A project that arrives from Git
or a project file runs no scripts until you allow it on this computer.

---

## What happens if the WSDL URL is behind a firewall?

Testnizer fetches WSDL documents from the main process, so any firewall rules
that apply to the machine running Testnizer also apply to WSDL retrieval. If
the WSDL URL is not reachable, you will see a connection error in the SOAP
editor.

To work around a restricted WSDL URL, save the WSDL file locally and use the
**Load from file** option in the SOAP request editor. Testnizer parses the
local file and lists all available operations without making a network request.

---

## Are my secrets encrypted?

Variables marked **secret** (current and initial value), mock server
authentication, the Mock MCP bearer token, certificate passphrases and AI Chat
API keys are encrypted with the operating system's keychain (Keychain on macOS,
DPAPI on Windows, libsecret on Linux) in the local database. They are written as
empty values to every file that leaves the app: Git, project files and exports.
History, the Console, run reports and mock logs mask credentials and the values
of your secret variables before anything is stored or shown.

Where no keychain exists (some Linux setups), these values are stored without
encryption, and the environment editor and Settings say so. If a value can no
longer be decrypted (for example after the keychain changed), the field asks you
to enter it again. Credentials you type straight into a request's Auth tab are
stored as typed in the request: keep the real value in a secret variable and
reference it as `{{secretVar}}`.

The optional **app password** is a lock on launch, not database encryption.

---

## How are certificates and private keys stored?

Client certificate files (PEM / P12) are referenced by their file path. The
private key passphrase, if any, is encrypted with Electron `safeStorage` — the OS
keychain: Keychain on macOS, DPAPI on Windows, libsecret on Linux. Where no keychain
is available on Linux, the passphrase is stored without encryption on your computer.
It is never written to project files, Git or exports.

The certificate files themselves are never copied into the application data
directory — Testnizer reads them from the path you specify at the time each
request is made.

---

## Is telemetry completely disabled?

Yes. Testnizer contains no telemetry, crash reporting, or usage analytics
library. The application does not make any background network requests other
than checking for software updates (see "How do updates work in an air-gapped
environment?" below). Update checks can also be disabled from **Project Settings →
Update → Automatically check for updates**.

---

## Is Testnizer free for commercial use?

Yes. Testnizer is free for personal and commercial use with no restriction on
the number of users, projects, or requests. There is no paid tier, no seat
license, and no feature gating. The source of the project and any future
licensing changes will be announced on the official website before taking
effect.

---

## How do updates work in an air-gapped environment?

In an air-gapped environment, disable automatic update checks in
**Project Settings → Update**. When a new version is available, download the
appropriate installer from the official releases page on a machine with
internet access, transfer the file to the air-gapped machine, and run the
installer manually. The installer replaces the existing installation while
preserving the application data directory.

By default Testnizer downloads an update in the background and asks when it is
ready: **Restart & install**, install when you quit, or **Skip this version**.
The first start of a new version copies your database to a `backups` folder
first; see [Getting started](/docs/getting-started#restoring-a-backup-after-an-update).
Testnizer 1.6.0 needs macOS 13 (Ventura) or later.

On macOS, drag the new `.app` bundle into the Applications folder. On Windows,
run the `.exe` installer. On Linux, replace the `.AppImage` file or install the
new `.deb` package.

---

## Is there a cloud sync feature?

No, and this is intentional. Testnizer is designed for teams and industries
where sending request data — including URLs, headers, and payloads — to an
external cloud service is not acceptable. All data stays on your machine or in
your own version control system.

If you need to sync across machines, commit and push the project using the
built-in Git integration.

---

## Is there a command-line runner for CI?

Not in 1.6.0. A standalone CLI is on the roadmap but has not shipped. For
unattended runs today, use the in-app **Scheduler**, and save the **HTML** or
**JSON** report of any run. See [Collection runner & automation](/docs/cli-and-automation).

---

## Does Testnizer support proxy servers?

Yes. Set an HTTP proxy in **Settings → Network → Proxy**, or for one project in its
**Project Settings**. It applies to HTTP, SOAP, GraphQL (subscriptions included),
WebSocket, Socket.IO, MQTT and SSE. Hosts in **Bypass for hosts** go out directly.
SOCKS proxies are not supported yet, and a request set to use one fails with a message.
gRPC, MCP and AI Chat do not use this setting.

Proxy authentication (username and password) is supported. The password is
encrypted with the OS keychain (`safeStorage`) and is not written to collection or
environment files.

With **Use system proxy**, HTTP requests read the `HTTP_PROXY`, `HTTPS_PROXY` and
`NO_PROXY` environment variables, not the macOS or Windows network settings. WebSocket,
Socket.IO, MQTT, SSE and GraphQL subscriptions use only a custom proxy.

---

## Can I turn off TLS certificate verification for gRPC?

No. gRPC does not follow the **SSL verification** setting that HTTP, SOAP and
GraphQL use: with TLS on, it always verifies the server certificate. For a server
with a self-signed certificate, add its CA certificate as described in the
[gRPC page](/docs/protocols/grpc), or use **Plaintext** for a local server that
does not use TLS.
