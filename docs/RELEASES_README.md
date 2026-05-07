# Testnizer

### Secure, Offline API Testing Platform

[![Latest Release](https://img.shields.io/github/v/release/apinizer/testnizer-releases)](https://github.com/apinizer/testnizer-releases/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/apinizer/testnizer-releases/total.svg)](https://github.com/apinizer/testnizer-releases/releases)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Your data never leaves your machine.**
> All API requests, collections, and credentials are stored locally in
> an encrypted database. No cloud sync. No telemetry. No external
> calls — not even to decode a JWT or sign an XML envelope.

---

## Why we built this

Postman is great. Until your security team finds out you pasted a
production bearer token into a cloud service. Or that the JWT your
auth team gave you got round-tripped through an SaaS analytics
pipeline. Or that the contents of your customer's signed SOAP
envelope are now sitting on someone else's S3 bucket.

For most teams the answer is "stop using nice tools, go back to
curl + a notepad." We thought there was a third option.

**Testnizer is a free, fully offline desktop app for teams that
cannot send their data to vendor servers.** Banking, government,
insurance, healthcare, defence — anywhere "no cloud sync" is a hard
compliance requirement.

---

## The four guarantees

### 🚫 100% Offline
**No internet connection required.** Air-gapped networks supported.
The app launches, runs, sends API requests to *your* endpoints,
decodes JWTs, signs envelopes, generates examples — all without
calling out to anything but the targets you choose.

### 💾 Local Storage Only
**All data stays on your machine.** Workspaces, projects,
environments, request history, certificates, test suites, and
secrets live in a single SQLite database on your local disk.
Move it, back it up, delete it — your call.

### 🌳 Internal Git & Local DB
**Version control without cloud.** Tests live next to your code in
your existing Git repo. Built-in `simple-git` integration means
collections travel with the project, branch with the project, and
review through your existing PR pipeline.

### 🔒 Zero Data Leakage
**Nothing is ever sent externally.** The renderer process has a
strict Content-Security-Policy (`connect-src 'self'`) — meaning the
UI is *physically incapable* of reaching the public internet. Every
network call goes through an audited main-process IPC handler that
you, the user, control. No background sync. No analytics ping. No
auto-update without consent.

---

## What's included

> Most "Postman alternatives" hand off everything heavy to a cloud
> service. We do it on-device.

### 🔐 JWT, encrypted payload & XML security — all on-device
- **JWT decoder** — claims, header, signature verification with HS / RS / ES algorithms — token never leaves the process
- **WS-Security** — XML Signature, XML Encryption, UsernameToken (Text + Digest with nonce/created), Timestamp — sign your envelopes locally with on-disk private keys
- **AES / RSA encrypt / decrypt** — workbench tool for opening encrypted XML payloads without uploading them anywhere
- **Certificate management** — local cert store, mTLS / client certificates per project, OS keychain encryption for passphrases (Keychain on macOS, DPAPI on Windows, libsecret on Linux)

### 🌐 Protocol coverage
- **HTTP / REST** — methods, params, headers, body (raw / JSON / XML / urlencoded / form-data + file upload / binary), cookies, mTLS, proxy, redirects, pre/post scripts, assertions
- **SOAP** — WSDL import (URL or file), manual envelope mode, SOAP 1.1 + SOAP 1.2, multi-service / multi-port
- **WebSocket** — ws + wss, custom headers, JSON / text composer, message timeline
- **GraphQL** — query, mutation, subscription, schema introspection
- **gRPC** — `.proto` import, all four streaming modes, metadata, JSON skeleton from proto fields
- **Server-Sent Events** — long-lived streams with `Last-Event-ID` resume
- **Socket.IO** — `socket.io-client`, namespaces, `auth.token`, custom upgrade headers, emit + subscribe, bidirectional event timeline
- **MCP (Model Context Protocol)** — MCP client with Streamable HTTP / SSE / stdio transports; list and invoke tools advertised by the server (built on `@modelcontextprotocol/sdk`)
- **AI Chat** — 14 providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq, Perplexity, Cerebras, Cohere, Fireworks, DeepInfra, Together, OpenRouter) plus Custom URL — streaming, multi-turn

### 🛠 Built-in offline tools
- **JWT debugger** — decode + verify, no remote call
- **JSON / XML formatters & validators**
- **Encoder / decoder** — Base64, URL, Hex, HTML entities, Unicode escape
- **Text diff** — side-by-side, line / word / char granularity
- **JSONPath / XPath / XSLT / Jolt** evaluators
- **WS-Security workbench** — sign / verify / encrypt / decrypt arbitrary XML

### 🔁 Lossless format imports
OpenAPI 3.x / Swagger 2.0 · Postman v2.1 · Insomnia v4 · cURL · WSDL · `.proto` (gRPC) · RAML 1.0 · SoapUI / ReadyAPI projects · HAR · Test suites accept multi-format input via auto-detection.

### 📦 Workflow
- Collection runner with HTML reports
- Scheduler for repeating tasks
- Test suites (multi-collection regression sets)
- Pre/post scripts in JavaScript with a Postman-compatible `pm` API
- Console with virtualized log timeline + per-tab filtering

---

## Download

| Platform | Format | First-launch note |
|---|---|---|
| **macOS (Apple Silicon)** | `Testnizer-X.Y.Z-arm64.dmg` | Right-click → **Open** (ad-hoc signed during beta). On Sequoia, also `xattr -dr com.apple.quarantine /Applications/Testnizer.app` if Gatekeeper blocks. |
| **macOS (Intel)** | `Testnizer-X.Y.Z-x64.dmg` | Same as above |
| **Windows (x64)** | `Testnizer Setup X.Y.Z.exe` | SmartScreen prompts during beta — **More info** → **Run anyway** |
| **Windows (arm64)** | `Testnizer Setup X.Y.Z-arm64.exe` | Same as above |
| **Linux (deb, x64/arm64)** | `Testnizer-X.Y.Z-{arch}.deb` | `sudo dpkg -i Testnizer-X.Y.Z-x64.deb` |
| **Linux (AppImage, x64/arm64)** | `Testnizer-X.Y.Z-{arch}.AppImage` | `chmod +x` then `./Testnizer-X.Y.Z-x64.AppImage` |

Auto-update is built in — the app pulls signed delta packages from this
repository when you ask it to. You can disable it in **Settings → Updates**.

---

## What's the catch?

There isn't one. Testnizer is **free, MIT-licensed, and unfunded**.
There is no "pro" tier, no cloud workspace upsell, no waitlist for
real features. The source lives at
[github.com/apinizer/testnizer](https://github.com/apinizer/testnizer).
This repository (`testnizer-releases`) is the public download mirror —
the actual build artifacts and auto-update channel.

We make money on a separate product (Apinizer API platform). Testnizer
is what we built because we needed it ourselves, and there was no good
offline alternative.

---

## Compatibility

Migrate **from**:
- Postman (v2.1 collections, with scripts + variables)
- Insomnia (v4 exports, with environments)
- SoapUI / ReadyAPI (project XML)
- OpenAPI 3.x / Swagger 2.0
- Raw cURL commands (Chrome "Copy as cURL", Windows cmd, multipart, ANSI-C quoting)
- WSDL files / URLs
- `.proto` files
- RAML 1.0
- HAR (browser network exports)

Migrate **to**: Postman v2.1 + Insomnia v4 (lossless round-trips for
the documented surface) + cURL (every request) + OpenAPI 3.0.3.

---

## Reporting issues

- **Bugs / feature requests:** [github.com/apinizer/testnizer/issues](https://github.com/apinizer/testnizer/issues)
- **Security:** `security@testnizer.com` (please don't open a public issue for vulnerabilities)
- **Discussion:** [github.com/apinizer/testnizer/discussions](https://github.com/apinizer/testnizer/discussions)

---

## License

[MIT](LICENSE). Built by [Apinizer](https://apinizer.com) and a small
group of contributors. Other trademarks (Postman, SoapUI, jwt.io, etc.)
are referenced for compatibility purposes only.
