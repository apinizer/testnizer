# Testnizer — Privacy Policy

**Effective date:** 2026-05-07
**Last updated:** 2026-05-07
**Applies to:** Testnizer v1.0.3 and later

This Privacy Policy explains how **Testnizer** ("the Software", "we", "our")
handles information when you install and use the application. Testnizer is
published by **Apinizer Yazılım A.Ş.** ("the Publisher"), located in
**İstanbul, Republic of Türkiye**.

Testnizer is a free, dual-licensed (MIT for source, EULA for binaries)
desktop application for testing APIs. It runs entirely on your local
machine. **We do not operate any backend service that receives, stores, or
processes your data.** We do not have user accounts. We do not monetize you
in any way.

---

## 1. Overview (TL;DR)

- Testnizer collects **no personal data by default**.
- All workspaces, projects, branches, requests, responses, environment
  variables, certificates, and credentials stay on **your local disk**.
- Outbound traffic from the Software is limited to:
  1. The API requests **you** explicitly send (HTTP, SOAP, WebSocket,
     GraphQL, gRPC, SSE) — these go directly from your device to the target
     you specify and never pass through us.
  2. A periodic version check against the GitHub Releases feed for
     auto-update.
  3. **AI Chat:** if you use the AI Chat feature, prompts and responses
     travel directly between your device and the AI provider you have
     selected (using the API key you supplied). We do not see, proxy, or
     store this content. See Section 6 for details.
  4. Optional crash telemetry, **only** if you supply a `SENTRY_DSN`
     environment variable when building or running the Software (off by
     default). See Section 5.
- We have no user accounts, host nothing on your behalf, and do not see
  your traffic.

---

## 2. What Data We Collect

### 2.1 Data we collect from you: none, by default

Testnizer does not transmit your collections, requests, responses, headers,
bodies, environment variables, secrets, certificates, history, AI prompts,
or any other content you create or import — to us or to any third party
under our control. We have no servers that receive this content. We have
no analytics SDK, no tracking beacons, no advertising identifiers, no usage
counters phoning home.

### 2.2 What "we collect" actually means

The only data exchange initiated by the Software where the destination is
**not** an API target you chose is:

- The auto-update version check (Section 4) — destination: GitHub.
- Optional crash telemetry (Section 5) — destination: a Sentry instance
  **you** configured.

That is the complete list. There is no other path.

---

## 3. Local Data Storage

All your work product is stored on your own device. We have no copy and no
ability to retrieve it.

| Item | Location |
|---|---|
| Database (SQLite) | `<userData>/testnizer.db` |
| Settings (electron-store) | `<userData>/config.json` |
| Secrets (passwords, tokens, certificates) | OS keychain via Electron `safeStorage` (macOS Keychain, Windows DPAPI, libsecret on Linux) |
| Logs (if any) | `<userData>/logs/` |
| Cached AI provider configurations | `<userData>/config.json` (the API keys you paste are stored encrypted via `safeStorage`) |

`<userData>` resolves to:

- **macOS:** `~/Library/Application Support/Testnizer`
- **Windows:** `%APPDATA%\Testnizer`
- **Linux:** `~/.config/Testnizer`

Stored in this directory: workspaces, projects, branches, endpoints,
environments (with `initialValue` and `value` per variable), request and
response history, imported collections (OpenAPI / Postman / Insomnia / cURL
/ HAR / WSDL / Proto), client certificates and keys, application settings,
your selected language and theme, and any optional master password you have
enabled for additional local-data protection.

You are the sole controller of this data. There is no cloud sync. You may
inspect, edit, export, or delete it at any time by manipulating the files
directly or by using the in-app Export / Settings menus.

---

## 4. Auto-Update

Testnizer uses `electron-updater` to check the project's public GitHub
Releases feed at `https://github.com/apinizer/testnizer/releases` for newer
versions. The check sends a standard HTTPS request consisting of:

- The updater's User-Agent string (the application name and the currently
  installed version).
- Your IP address as visible to GitHub at the network layer.

**No data about your workspaces, requests, responses, environments,
credentials, or usage is sent.** No account or device identifier is
generated or transmitted. GitHub's handling of this request is governed by
GitHub's own privacy policy
(https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

You can disable the auto-updater in **Settings → Updates**. Disabling it has
no effect on the Software's other functionality; the Software remains fully
usable offline.

**Lawful basis (GDPR Art. 6(1)(f)):** legitimate interest in delivering
security and stability fixes to installed binaries. This processing
involves only IP and User-Agent metadata, intrinsic to any HTTPS request
the user's machine makes to a public host.

---

## 5. Optional Telemetry (Sentry)

Testnizer ships **without a default telemetry endpoint**. There is no
analytics, no crash reporting, no usage tracking enabled out of the box.

Crash reporting only activates when **you** (or your organization, when
self-distributing) build or run the application with a `SENTRY_DSN`
environment variable set. When and only when that DSN is present, the
following may be sent to the configured Sentry instance:

- application version, OS version, runtime (Node/Electron) version;
- stack traces of unhandled errors;
- non-PII breadcrumbs (UI navigation events, IPC channel names).

The following are **never** sent — even when telemetry is enabled:

- request or response bodies, target URLs, headers, cookies;
- bearer tokens, basic-auth credentials, API keys, OAuth tokens, JWTs;
- TLS client certificates or private keys;
- environment-variable values;
- file contents the user opens;
- AI Chat prompts or responses.

If you build Testnizer yourself or receive a build with telemetry enabled
by your organization, the operator of that Sentry instance is the data
controller for that processing — not us. The official binaries we publish
on Testnizer.com and GitHub Releases ship **without** a `SENTRY_DSN` and
therefore transmit no telemetry.

**Lawful basis (GDPR Art. 6(1)(a)):** explicit opt-in by the user or the
self-distributing organization that sets the `SENTRY_DSN`.

---

## 6. AI Chat Feature

Testnizer includes an "AI Chat" tab that allows you to converse with a
large-language-model provider of your choice from within the application.
The application ships with presets for the following providers:

- OpenAI
- Anthropic
- Groq
- Google (Gemini)
- Azure OpenAI
- Cohere
- Mistral
- Perplexity
- Together AI
- OpenRouter
- Fireworks AI
- DeepSeek
- xAI (Grok)
- Ollama (local; no outbound network call)

**How AI Chat data flows:**

When you use AI Chat, the prompts you submit and the responses returned by
the model travel **directly from your machine to the AI provider's API
endpoint**, authenticated with the API key **you** supplied in the
provider's settings. **Testnizer does not proxy, relay, intercept, log, or
store this content at any point.** It is a peer-to-peer connection between
your device and the provider you selected — exactly the same as if you
called that provider's API yourself with `curl`.

**What this means in practice:**

- We have no access to your prompts or model responses. We could not
  produce them under subpoena because we never receive them.
- The AI provider you selected sees your prompts, responses, and IP. Each
  provider has its own privacy policy, retention policy, training-data
  policy, and regulatory posture. **You should review the privacy policy of
  the provider you select before sending sensitive data through AI Chat.**
- Data sent to AI providers may be retained, used to improve their models,
  or made available to third parties in accordance with the provider's
  terms — entirely outside our control.
- You can run AI Chat **fully offline** by selecting the **Ollama** preset
  (or any other locally-hosted, OpenAI-compatible endpoint). In that case
  no outbound network traffic leaves your machine.
- Your API keys are stored locally and encrypted via the OS keychain
  (Section 3). They are sent only to the provider whose configuration they
  belong to.

**Lawful basis (GDPR Art. 6(1)(a)):** explicit opt-in by the user, who
configures an AI provider and submits prompts. With respect to data
processed by the AI provider, the AI provider is the data controller (or
joint controller, depending on configuration); we are neither.

If you do not use the AI Chat feature, no AI-related network traffic is
generated by the Software.

---

## 7. Third-Party Services

Testnizer interacts with third-party services only as a direct result of
actions you take. We have no affiliation with these services and no
control over how they handle the data you choose to send them.

| Service | When it is contacted | What is shared | Controller |
|---|---|---|---|
| GitHub Releases | Auto-update check (default on; disable in Settings) | Version metadata, your IP, standard User-Agent | GitHub, Inc. |
| Your API targets | When you click **Send** on a request | Whatever you put in the request | The operator of that endpoint |
| Sentry (optional) | Only if `SENTRY_DSN` is configured | Anonymous error metadata (Section 5) | The operator of that Sentry instance |
| AI providers (optional) | When you use AI Chat with that provider configured | Your prompts and any context you attach (Section 6) | The selected AI provider |

We have no affiliation with the API targets you choose to call, nor with
the AI providers you may choose to configure.

---

## 8. Cookies and Tracking

Testnizer is a desktop application, not a website, and uses **no tracking
cookies, no advertising cookies, no analytics cookies**. The Software does
not embed any tracking pixels or third-party tags.

When you call HTTP APIs that set cookies, those cookies are stored on your
machine via `tough-cookie` so that subsequent requests within the same
session can include them — exactly as a browser would. Those cookies are
your data, scoped to the API targets you chose, and stay on your device.

---

## 9. Children's Privacy

Testnizer is intended for software developers, QA engineers, and IT
professionals. It is **not directed at children under the age of 13** (or
the equivalent minimum age in your jurisdiction). We do not knowingly
collect personal data from anyone, regardless of age. If a parent or
guardian believes a child has used the Software in a way that warrants
attention, please contact us at the address in Section 15.

---

## 10. GDPR and International Users

Because Testnizer does not transmit your personal data to us by default, no
cross-border transfer is initiated by the Software, and we act neither as a
data controller nor as a data processor with respect to the content you
create. The processing in Sections 4 (Auto-Update) and 5 (Telemetry) is
limited to network metadata or, in the case of Sentry, opt-in technical
crash data.

**Principles honored by design:**

- **Data minimization (Art. 5(1)(c)):** the application asks for nothing it
  does not strictly need to operate. There is no email collection, no
  account, no profile.
- **Purpose limitation (Art. 5(1)(b)):** the only outbound traffic we
  initiate (the GitHub update check) has the single purpose of delivering
  newer versions.
- **Storage limitation (Art. 5(1)(e)):** all your work product is stored
  locally; deletion is fully under your control.
- **Lawful basis (Art. 6):**
  - Auto-update — Art. 6(1)(f) legitimate interest (security & stability).
  - Telemetry — Art. 6(1)(a) explicit opt-in.
  - AI Chat — Art. 6(1)(a) explicit opt-in (the AI provider, not us, is
    the controller for that data).

You retain full control over your data on your device — exercising the
rights of access, rectification, erasure, restriction of processing,
portability, and objection by editing or deleting the local database
directly, or by using the in-app export and clear-data features.

If you enable optional telemetry through your own Sentry DSN, you (or your
organization) are the data controller for that processing.

---

## 11. Security

The Software employs the following defensive practices:

- **Local secret encryption.** Passwords, API keys, OAuth tokens, and
  client certificates are encrypted at rest via Electron `safeStorage`,
  which delegates to the OS keychain (macOS Keychain, Windows DPAPI,
  libsecret on Linux). Plain-text secrets are never written to disk.
- **Renderer hardening.** The Renderer process runs with
  `contextIsolation: true`, `nodeIntegration: false`, and a strict Content
  Security Policy of `connect-src 'self'`, which means the UI cannot make
  outbound network calls. All network activity is centralized in the Main
  process and originates from explicit user-initiated actions or the
  consented update-check / telemetry / AI Chat flows.
- **Process separation.** The UI cannot directly access the filesystem,
  child processes, or network. All such operations are mediated by typed
  IPC channels with input validation in the Main process.
- **No telemetry by default.** Crash data does not leave your machine
  unless you opt in (Section 5).

No software is perfectly secure. You remain responsible for the physical
and logical security of the device on which Testnizer runs, including
keeping your operating system and the Software updated, using full-disk
encryption, and protecting against unauthorized physical access.

---

## 12. International Transfers

The Software does not initiate cross-border transfers of your work product.
Outbound network traffic initiated by the Software is limited to:

- Auto-update requests to **GitHub**, served by GitHub's global edge
  network. GitHub's data-handling and Standard Contractual Clauses are
  documented in its own privacy policy.
- Optional Sentry crash reports, transmitted to whichever Sentry endpoint
  you configured. The legal basis and transfer arrangement for that
  destination are determined by you or your organization.
- AI Chat requests, transmitted directly from your device to the AI
  provider you selected. The location of that provider's infrastructure is
  determined by your provider choice; review their privacy policy for
  details.

We do not send your data to any third country ourselves.

---

## 13. Your Rights

Because we hold no data about you, exercising your data-protection rights
generally means acting on your **local device**:

- **Right of access.** Inspect the local database, configuration files,
  and exported collections directly. The Software's Export feature
  produces a portable JSON snapshot of any workspace.
- **Right to rectification.** Edit any record from within the Software.
- **Right to erasure.** Delete the user-data directory listed in
  Section 3, or use the in-app "Clear data" option in Settings, or
  uninstall the Software (the user-data directory may persist after
  uninstall on some platforms — delete it manually to complete erasure).
- **Right to portability.** Use the Export functions (OpenAPI, Postman,
  HAR) to obtain your data in standard interoperable formats.
- **Right to object / restrict processing.** Disable auto-update in
  Settings; do not configure `SENTRY_DSN`; do not use AI Chat.

If a third-party provider (an AI provider, a Sentry instance, or an API
target) holds personal data **about you** because of how you used
Testnizer, please direct your data-protection request to that provider
directly — we cannot act on their behalf.

---

## 14. Changes to this Policy

We may update this Privacy Policy from time to time. Material changes are
reflected by updating the **Last updated** date at the top of this document
and incrementing its hash. When the document hash changes, the
in-application consent gate prompts you to review and accept the updated
text on the next launch of the Software. If you decline the updated text,
the Software will exit and you must uninstall it to terminate the
relationship.

We will not retroactively reduce protections in this Policy without first
giving you the opportunity to refuse the change.

---

## 15. Contact

For questions, requests, or complaints about this Privacy Policy or about
how Testnizer handles data:

- **Privacy & legal:** legal@testnizer.com (with fallback to
  info@testnizer.com)
- **General support:** info@testnizer.com
- **Source repository:** https://github.com/apinizer/testnizer
- **Website:** https://www.testnizer.com
- **Postal:** Apinizer Yazılım A.Ş., İstanbul, Türkiye

Copyright © 2026 Apinizer Yazılım A.Ş.
