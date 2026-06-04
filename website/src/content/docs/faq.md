---
title: Frequently asked questions
description: Answers to common questions about offline usage, data storage, compatibility, licensing, and migration from Postman.
order: 3
section: Reference
---

## How do I migrate from Postman?

Open the **Import** dialog (`File → Import` or drag a file onto the left
sidebar) and select your Postman export file. Testnizer supports Postman
Collection v2 and v2.1 format. Environments exported from Postman as JSON are
also importable — use the same Import dialog and choose the environment file.

Folder hierarchy, request descriptions, pre-request scripts, test scripts, and
authorization settings are all preserved. A small number of Postman-specific
collection runner options (such as `postman.setNextRequest`) are treated as
no-ops and logged to the console during import.

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
open it in Testnizer. Branches map directly to Testnizer branches.

**Database copy.** For one-time transfers, you can copy the `testnizer.db` file
from one machine to another. The file is located in `~/Library/Application
Support/Testnizer` on macOS, `%APPDATA%\Testnizer` on Windows, and
`~/.config/Testnizer` on Linux. This replaces all data on the target machine,
so use it only for initial setup or migration scenarios.

---

## Will my existing Postman scripts work in Testnizer?

Most scripts work without changes. Testnizer implements the `pm` scripting API
including `pm.request`, `pm.response`, `pm.environment`, `pm.globals`,
`pm.collectionVariables`, `pm.variables`, `pm.test`, `pm.expect`, and
`pm.sendRequest`.

The following Postman-specific features are not supported:

- `postman.setNextRequest()` — collection runner uses sequential execution only
- Visualizer (`pm.visualizer.set()`) — no equivalent; output is ignored
- `pm.info.iteration` and `pm.info.iterationCount` — available only inside the
  collection runner context, not in single-request runs
- References to the built-in Postman cloud or monitor APIs

If a script calls an unsupported method, Testnizer logs a warning to the
console and continues execution rather than failing the request.

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

## How are certificates and private keys stored?

Client certificate files (PEM / P12) are referenced by their file path. The
private key passphrase, if any, is stored through `electron-store` using the OS
keychain on macOS (Keychain Access) and the Windows Credential Manager on
Windows. On Linux, the passphrase is stored in an encrypted file in the
application data directory using a machine-specific key.

The certificate files themselves are never copied into the application data
directory — Testnizer reads them from the path you specify at the time each
request is made.

---

## Is telemetry completely disabled?

Yes. Testnizer contains no telemetry, crash reporting, or usage analytics
library. The application does not make any background network requests other
than checking for software updates (see "How do updates work in an air-gapped
environment?" below). Update checks can also be disabled from **Settings →
General → Check for updates automatically**.

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
**Settings → General**. When a new version is available, download the
appropriate installer from the official releases page on a machine with
internet access, transfer the file to the air-gapped machine, and run the
installer manually. The installer replaces the existing installation while
preserving the application data directory.

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

## How do I send test results to a CI pipeline?

Use the Testnizer CLI runner. Run a collection from the command line with:

```bash
testnizer run --collection ./my-project.db \
              --environment staging \
              --reporter junit \
              --output ./results/report.xml
```

The JUnit XML output is compatible with Jenkins, GitLab CI, GitHub Actions, and
most other CI systems. A JSON reporter is also available with `--reporter json`.
Set the `--bail` flag to stop execution on the first failed test and exit with a
non-zero code.

For details on all CLI options, see [CLI and automation](/docs/cli-and-automation).

---

## Does Testnizer support proxy servers?

Yes. Configure a proxy from **Settings → Network → Proxy**. You can set an
HTTP or SOCKS5 proxy address that applies to all requests made by Testnizer.
Per-request proxy overrides are not currently supported; the proxy setting is
global.

Proxy authentication (username and password) is supported. The credentials are
stored in `electron-store` and are not written to collection or environment
files.

The system proxy configured in macOS Network Preferences or Windows Internet
Options is respected by default unless you set a custom proxy in Testnizer
settings.

---

## How do I disable TLS certificate verification for gRPC?

In the gRPC request editor, open the **Connection** tab and set
**TLS mode** to `Insecure`. This disables server certificate verification for
that request only and is equivalent to passing `grpc.ssl_target_name_override`
and using an insecure channel credential.

Do not use insecure mode against production endpoints. For self-signed
certificates, the better approach is to upload the root CA certificate in
**Settings → Certificates → Trusted CA** and keep TLS verification enabled.

---

## What is planned for v1.1?

The v1.1 roadmap includes the following items, in rough priority order:

- **Team workspace sync over self-hosted Git server** — first-class UI for
  configuring a remote origin without leaving the app
- **Environment variable groups** — organize variables into named groups within
  a single environment for large projects with many services
- **Collection runner improvements** — data-driven runs from CSV/JSON files,
  parallel execution option, and an improved HTML report template
- **Response comparison** — side-by-side diff between two saved responses or
  between a baseline and a live response
- **WSDL code generation** — generate typed client stubs from a loaded WSDL
  in TypeScript and Java
- **Plugin API (beta)** — allow third-party extensions to add request editors,
  response viewers, and sidebar panels

The roadmap is subject to change. Follow the release notes on the official
website for confirmed delivery dates.
