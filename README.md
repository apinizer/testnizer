# Testnizer

Cross-platform offline API testing and protocol-debugging desktop app.

[![Build](https://github.com/apinizer-cloud/testnizer/actions/workflows/build.yml/badge.svg)](https://github.com/apinizer-cloud/testnizer/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What it is

Testnizer is a free, fully offline alternative to SoapUI + Postman + jwt.io +
samltool.com + freeformatter.com — built for enterprise teams (banking,
government, insurance) who can't paste production tokens or signed payloads
into web tools but still need ergonomic protocol debugging.

- **Protocols:** HTTP/REST, SOAP (WSDL + manual), WebSocket, GraphQL, gRPC,
  Server-Sent Events
- **WS-Security:** XML Sign/Verify/Encrypt/Decrypt, UsernameToken (Text/Digest
  + nonce/created), Timestamp — both as a SOAP request feature and a standalone
  Tools tab
- **Tools:** offline JWT debugger, JSON/XML formatter, encoders (Base64,
  URL, Hex, HTML, Unicode), text diff, JSONPath/XPath/XSLT/Jolt evaluators,
  WS-Security tool
- **Local-first storage:** all workspaces, projects, environments, history live
  in a local SQLite database (no servers, no telemetry by default)
- **Open / version-controlled tests:** Git integration via `simple-git`; tests
  travel with your repo

## Status

Currently in beta — see [docs/production-readiness/STATUS.md](docs/production-readiness/STATUS.md)
for the full sprint-by-sprint readiness tracker. As of v1.0 beta:

- 266 unit tests + 3 smoke + 3 WSSE + 48 HTTP e2e tests passing
- macOS + Linux + Windows native builds (x64 + arm64)
- Auto-update via GitHub Releases (electron-updater)
- macOS: ad-hoc signed (production code-signing post-Apple Dev cert)
- Windows: unsigned beta (production EV cert post-procurement)

## Install

Pre-built packages: see the [Releases page](https://github.com/apinizer-cloud/testnizer/releases).

| Platform | Format | Note |
|---|---|---|
| macOS (Apple Silicon) | `Testnizer-X.Y.Z-arm64.dmg` | First-launch: right-click → Open (ad-hoc signed) |
| macOS (Intel) | `Testnizer-X.Y.Z-x64.dmg` | First-launch: right-click → Open |
| Windows | `Testnizer Setup X.Y.Z.exe` | SmartScreen prompt expected during beta |
| Linux (deb) | `Testnizer-X.Y.Z-x64.deb` | `sudo dpkg -i ...` |
| Linux (AppImage) | `Testnizer-X.Y.Z-x64.AppImage` | `chmod +x` then run |

## Develop

```bash
# Requirements: Node 20+, Git
git clone https://github.com/apinizer-cloud/testnizer.git
cd testnizer

npm install              # postinstall renames Electron.app → Testnizer.app
npm run dev              # renderer @ http://localhost:5173, Electron app launches
npm run typecheck        # tsc --noEmit (main + renderer)
npm run lint             # ESLint flat config
npm run test:unit        # Vitest (266 tests)
npm run test:e2e:smoke   # Playwright Electron smoke (3 tests)
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

## Security

- Renderer has CSP `connect-src 'self'` — no direct external network from the
  renderer; everything goes through main-process IPC handlers.
- `contextIsolation: true`, `nodeIntegration: false` always.
- Stored secrets (cert passphrases, auth credentials) are encrypted with
  Electron `safeStorage` (Keychain / DPAPI / libsecret) on supported platforms.
- WS-Security XML signing/encryption uses Node's native `crypto` +
  `xml-crypto` / `xml-encryption` in main process — never in the renderer.

To report a security issue privately, see [SECURITY.md](SECURITY.md) (TBD)
or email `security@testnizer.com`.

## Contributing

Issues and PRs welcome. Please:

1. Run `npm run lint` + `npm run typecheck` + `npm run test:unit` before pushing
2. Match the IPC pattern: every handler returns `{ success: boolean, data?: T, error?: string }`
3. Keep the renderer free of direct network calls — add a main-process engine
   + IPC handler instead

## License

[MIT](LICENSE) — see file for full terms.

## Trademarks

"Testnizer" is a project of Apinizer Cloud. Other trademarks (Postman, SoapUI,
jwt.io, etc.) are referenced for compatibility/migration purposes only.
