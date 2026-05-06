# Testnizer

**Secure, Offline API Testing Platform**

[![Build](https://github.com/apinizer/testnizer/actions/workflows/build.yml/badge.svg)](https://github.com/apinizer/testnizer/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/apinizer/testnizer-releases/total.svg)](https://github.com/apinizer/testnizer-releases/releases)

> **Your data never leaves your machine.** Every API request, collection,
> credential, certificate, and token is stored locally in an encrypted
> database. No cloud sync. No telemetry. No external network calls during
> JWT decode, XML signing, encryption, or formatting — everything runs
> on-device.

Testnizer is a free, fully offline desktop API testing app for teams that
**cannot** paste production tokens, signed SOAP envelopes, or PII into web
tools — banking, government, insurance, healthcare. Built from scratch as
an Electron app with the same ergonomics as Postman / SoapUI / Insomnia,
but with a strict offline-only execution model.

---

## Why offline matters

| Concern | Cloud tools (Postman, etc.) | Testnizer |
|---|---|---|
| Where do collections live? | Cloud workspace | Local SQLite DB on your disk |
| Where do tokens / passwords live? | Synced to vendor servers | Encrypted via OS keychain (Keychain / DPAPI / libsecret) |
| JWT decode | Web app sends token to a remote service | Pure local crypto — token never leaves the process |
| WS-Security sign / encrypt | Online tools, or a separate desktop app | Built-in, runs in main process with `xml-crypto` + Node `crypto` |
| Telemetry | On by default | None — and no opt-in either |
| Network egress at rest | Background sync, analytics, login pings | Zero. The renderer has CSP `connect-src 'self'` |
| Air-gapped network | Doesn't work | Works |

Read it again: **the renderer process has Content-Security-Policy
`connect-src 'self'`** — meaning the React UI is *physically incapable* of
reaching the public internet. Every API request you fire is routed
through a Node main-process IPC handler that you, the user, control.

---

## Highlights

### 🌐 Protocols
- **HTTP / REST** — full method coverage, params/headers/body/auth, cookies, mTLS, proxy, redirects, multipart with file upload, raw / urlencoded / form-data / binary, pre/post scripts, assertions
- **SOAP** — WSDL import (URL or file), manual envelope mode, multi-service / multi-port, SOAPAction extraction, automatic example envelope generation
- **WebSocket** — ws + wss, custom headers, message timeline, JSON/text composer
- **GraphQL** — query / mutation / subscription, schema introspection, variables JSON
- **gRPC** — `.proto` import, unary + server-stream + client-stream + bidi-stream, metadata, JSON skeleton from message fields
- **Server-Sent Events** — long-lived streams with `Last-Event-ID` resume
- **AI Chat** *(new)* — 14 providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq, Perplexity, Cerebras, Cohere, Fireworks, DeepInfra, Together, OpenRouter) + Custom URL, streaming, multi-turn, env-var resolution

### 🔐 WS-Security (XML Signature & Encryption)
- UsernameToken: Password Text + Password Digest with nonce/created
- Timestamp with custom TTL
- XML Signature (RSA-SHA1 / RSA-SHA256), envelope or specific elements
- XML Encryption (AES-128/256-CBC, AES-128/256-GCM, RSA-OAEP key wrapping)
- Verify + decrypt operations as standalone Tools, not just request features
- All crypto runs on-device. Certificates and private keys never travel.

### 🛠 Built-in Tools (no internet, ever)
- **JWT debugger** — decode + verify HS/RS/ES signatures, inspect claims, no network call
- **JSON / XML formatters & validators**
- **Encoder/decoder** — Base64, URL, Hex, HTML entities, Unicode escape
- **Text diff** — side-by-side, line / word / char granularity
- **JSONPath / XPath / XSLT / Jolt** evaluators
- **WS-Security workbench** — apply / verify / decrypt / sign on arbitrary XML

### 📦 Local-first storage
- SQLite database on your disk — workspaces, projects, environments, history,
  certificates, test suites, scheduler tasks
- OS-native secret storage (`safeStorage`) for passphrases and tokens
- Optional master password gates the local data
- Native `simple-git` integration: tests live next to your code, version
  controlled by your normal workflow — no proprietary cloud sync

### 🔁 Import / Export (lossless round-trips)
- **OpenAPI 3.x / Swagger 2.0** — security schemes mapped to auth, examples
  preferred over schemas, tags + operationId + required params preserved
- **Postman v2.1** — including `event[]` (pre/test scripts), collection variables
- **Insomnia v4** — including form-data file fields, env shapes, script shim
- **cURL** — Chrome "Copy as cURL", Windows cmd.exe carets, multipart, ANSI-C quoting
- **WSDL** — multi-service, multi-port, SOAP 1.1 + SOAP 1.2 dual bindings
- **`.proto`** — gRPC service descriptions with JSON skeleton bodies
- **RAML 1.0** — nested resources, URI parameters, body content types
- **SoapUI / ReadyAPI** projects (XML)
- **HAR** — browser network logs

Test suites accept multi-format input via auto-detection (Testnizer
native + Postman + Insomnia).

---

## Install

Pre-built binaries from [the Releases page](https://github.com/apinizer/testnizer-releases/releases):

| Platform | Format | Note |
|---|---|---|
| macOS (Apple Silicon) | `Testnizer-X.Y.Z-arm64.dmg` | First-launch: right-click → Open (ad-hoc signed during beta) |
| macOS (Intel) | `Testnizer-X.Y.Z-x64.dmg` | First-launch: right-click → Open |
| Windows | `Testnizer Setup X.Y.Z.exe` | SmartScreen prompt expected during beta |
| Linux (deb) | `Testnizer-X.Y.Z-x64.deb` | `sudo dpkg -i ...` |
| Linux (AppImage) | `Testnizer-X.Y.Z-x64.AppImage` | `chmod +x` then run |

Auto-update is built in (electron-updater) and pulls signed delta packages
from the releases repo. You can disable it in Settings.

---

## Develop

```bash
# Requirements: Node 20+, Git
git clone https://github.com/apinizer/testnizer.git
cd testnizer

npm install              # postinstall renames Electron.app → Testnizer.app
npm run dev              # renderer @ http://localhost:5173, Electron app launches
npm run typecheck        # tsc --noEmit (main + renderer)
npm run lint             # ESLint flat config
npm run test:unit        # Vitest (548+ tests)
npm run test:e2e:smoke   # Playwright Electron smoke
npm run build            # production bundle in out/
```

For packaging, see `.claude/commands/package.md` — the order matters because
`better-sqlite3` is a native dependency that must be rebuilt for the host arch.

## Project layout

```
src/
├── main/         # Node.js — IPC handlers, protocol engines, SQLite repos
├── preload/      # contextBridge — single window.api boundary
└── renderer/     # React 19 + Tailwind v4 — UI only, no network
docs/production-readiness/   # versioned readiness tracker
.github/workflows/build.yml  # CI: quality + 6 platform builds + release
```

See [CLAUDE.md](CLAUDE.md) for deeper architectural rules (security model,
process separation, dev workflow).

---

## Security model

Three load-bearing rules, enforced by code:

1. **Renderer has CSP `connect-src 'self'`** — the React UI cannot reach
   the public internet. Every API call goes through a Node main-process
   IPC handler.
2. **`contextIsolation: true`, `nodeIntegration: false`** — preload
   exposes only an audited `window.api` surface. No raw `fetch`, `axios`,
   or `require` from the UI thread.
3. **Stored secrets pass through OS keychain** — passphrases, basic-auth
   passwords, bearer tokens, OAuth refresh tokens, certificate keys all
   go through Electron `safeStorage` (Keychain / DPAPI / libsecret).
   The encrypted blob lives in your local SQLite. The raw value never
   touches disk.

XML signing and encryption use Node's native `crypto` plus `xml-crypto` /
`xml-encryption` — both run in the main process. Private keys are loaded
from disk, used in-memory, and zeroed on close.

To report a security issue privately, email `security@testnizer.com`.

---

## Contributing

Issues and PRs welcome. Before pushing:

1. `npm run lint` + `npm run typecheck` + `npm run test:unit` clean
2. Match the IPC pattern: every handler returns `{ success: boolean, data?: T, error?: string }`
3. Keep the renderer free of direct network calls — add a main-process engine + IPC handler instead

## License

[MIT](LICENSE) — see file for full terms.

## Trademarks

"Testnizer" is a project of Apinizer. Other trademarks (Postman, SoapUI,
jwt.io, etc.) are referenced for compatibility / migration purposes only.
