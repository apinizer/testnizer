---
title: Why offline?
description: The compliance and operational reasons Testnizer enforces a strict offline execution model.
order: 2
section: Getting started
---

Most API testing tools assume the network is fine. They were built for
mobile-app developers, indie hackers, and small startups — audiences for whom
"sign in with GitHub and your collections sync to the cloud" is a feature, not
a problem.

For some teams it is a problem.

## Who Testnizer is for

- **Banking, insurance** — customer PII in request bodies, regulatory ban on
  third-party data egress
- **Government, defence** — air-gapped staging networks, certified secure
  enclaves with no internet path
- **Healthcare** — HIPAA / GDPR exposure for any vendor that touches a token
  signed against patient data
- **Internal platform teams** — corporate proxies that block SaaS workspaces,
  or enterprise architects who don't want collections living on a vendor's S3

If your security review starts with "where does this data go?" Testnizer is
the answer that doesn't require an exception.

## What "offline" actually means here

Three concrete claims, each enforced by code:

### 1. The renderer can't reach the internet

The React UI runs with a strict
[Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP):
`connect-src 'self'`. Browsers block any `fetch`, `WebSocket`, or `EventSource`
that goes anywhere except the renderer's own origin. Even if a malicious
dependency tried to phone home from the UI thread, it physically can't.

The renderer is also **sandboxed** (Chromium's OS sandbox, with context isolation
on and Node integration off), and the preload exposes only the audited
`window.api` bridge plus plain `platform` and `versions` values — no raw IPC and
none of the process environment. **Web permissions are denied by default**:
camera, microphone, geolocation, notifications, device access and the like are
refused for every frame, including a response body shown in a preview. Only the
app's own window may write to the clipboard (every Copy button), read it (Import →
Paste from clipboard) and take a video response fullscreen. The inline PDF preview
of a response runs under the same policy.

### 2. Every API call goes through an audited handler

When you hit "Send", the request crosses the IPC boundary into Electron's main
process. There it routes through a single Node-side handler per protocol —
`http.engine.ts`, `soap.engine.ts`, `grpc.engine.ts`, etc. Every one of those
handlers routes only to the endpoint you configure — never to a vendor server.

### 3. Stored secrets are encrypted with your OS keychain

Secret variables, mock server tokens, git tokens, certificate passphrases and
keystores go through Electron's
[`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) API.
On macOS that's Keychain. On Windows, DPAPI. On Linux, libsecret. The encrypted
blob lives in your local SQLite database and the raw value is only decrypted in
the main process when a request needs it. Where no keychain exists (some Linux
setups) these values are stored without encryption and Testnizer tells you so; they
are encrypted on a later start once a keychain is available. Credentials you type
straight into a request's Auth tab are plain text in the local database — keep the
real value in a secret variable and reference it with `{{secretVar}}`. Secret values
are blanked in every project file, Git commit and export.

## Comparison with cloud tools

| Concern | Cloud tools | Testnizer |
|---|---|---|
| Where collections live | Vendor cloud workspace | Local SQLite on your disk |
| Where tokens are stored | Synced to vendor servers | OS keychain (Keychain / DPAPI / libsecret) where one exists |
| JWT decode | Web app sends token to a remote service | Local crypto — token stays in process |
| WS-Security sign / encrypt | Online tools, or a separate desktop app | Built-in main process with xml-crypto + Node crypto |
| Telemetry | On by default | None — and no opt-in either |
| Network egress at rest | Background sync, analytics, login pings | Zero. CSP `connect-src 'self'` |
| Air-gapped network | Doesn't work | Works |

## The trade-off

There is one. Without a cloud, there's no automatic team sync.

Our answer: use the Git you already have. Testnizer projects are folders. Add
them to a repo, branch them, review them through PRs. The collaboration model
is the one your engineering org already trusts — not a vendor's proprietary
"workspace sharing" feature.

For organisations where Git review is already the source of truth for
infrastructure-as-code, this is the pattern that actually fits.

## Read more

- [Security model](/security) — how the three rules are enforced in code
- [Verifying releases](/docs/build-from-source) — SHA-256 checksums for air-gapped transfer
