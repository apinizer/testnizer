---
name: launch-testnizer
description: Launch the Testnizer Electron desktop app in dev mode for manual UI verification. Use whenever the user asks to run, start, launch, open, or "spin up" the app, asks for a screenshot, wants to verify a UI/UX change in the live app, or asks to test that a fix actually works end-to-end. Also use after non-trivial renderer/main process changes when the dev test suite alone isn't enough proof — the Electron BrowserWindow is the only place where IPC, preload bridge, native modules (better-sqlite3, electron-store, electron-updater), and the real menu / keyboard chord behavior all line up at once. Do NOT use for unit / vitest runs (that's `npm run test:unit`) or for Playwright E2E (that's `npm run test:e2e`).
---

# Launching Testnizer for Manual UI Verification

Testnizer is an Electron + React app (electron-vite, React 19, Zustand, better-sqlite3). The dev launcher rebuilds the native sqlite binding to Electron's ABI, then starts both the Vite renderer server and an Electron BrowserWindow against it. The whole thing is a single command — `npm run dev` — but the launch sequence has a few project-specific gotchas worth knowing about up front.

## The launch command

```bash
npm run dev
```

This is the only command. Don't run `npx electron .` or `vite` directly — both miss the `predev` hook which is the part that makes the native module actually load.

`predev` runs two things:

1. **`scripts/ensure-native-abi.js electron`** — flips `better-sqlite3`'s compiled binding from Node's NODE_MODULE_VERSION to Electron 33's (130). It writes a marker at `node_modules/better-sqlite3/build/Release/.testnizer-abi`, so re-running `npm run dev` after a previous dev session is fast (<100ms). The expensive rebuild only happens when something else (`npm test`, a `npm install`) flipped the binding back to Node's ABI.
2. **`scripts/download-curl-binaries.js`** — fetches the static curl binary for the current platform/arch (~3–10MB). Used by the Legacy TLS routing path (Settings → Certificates). Cached under `resources/curl/`, only re-downloads with `--force`.

Then `electron-vite dev` builds main + preload (Vite SSR bundles), starts the renderer Vite dev server on `http://localhost:5173`, and spawns Electron pointed at it.

## Wait for the renderer dev server

The app is ready to use when this line appears in stdout:

```
dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
```

Total time from `npm run dev`:
- **Warm path (ABI already at Electron)**: ~5–10 seconds
- **Cold path (ABI rebuild + curl download)**: 30–60 seconds

If running via `Bash(run_in_background: true)`, wait with an `until` loop on the log file rather than sleeping — the rebuild duration is unpredictable:

```bash
until grep -q "dev server running for the electron renderer" <log-path> 2>/dev/null; do sleep 1; done
```

After the renderer line, two more lines confirm the BrowserWindow itself came up:

```
start Testnizer...
HH:MM:SS.MMM › [diagnostics] electron-log initialized
```

## On macOS the app launches as "Testnizer.app", not "Electron"

The `postinstall` script (`scripts/patch-electron-name.sh`) renames `node_modules/electron/dist/Electron.app` → `Testnizer.app` on install. So in `ps`, Activity Monitor, and Cmd-Tab the running process is **Testnizer**, not Electron. This is intentional — it matches the production build and keeps the dock icon branded.

`ps` output to confirm the app is live (expect 3+ rows: electron-vite parent, Electron main, GPU helper, network service helper):

```bash
ps aux | grep -E "Electron|electron-vite|Testnizer" | grep -v grep
```

If you only see `electron-vite dev` but no `Testnizer.app/Contents/MacOS/Electron`, the main process crashed during boot — check the log for stack traces.

## You can't drive the live app with Chrome MCP

The renderer is loaded from `http://localhost:5173` but **the only working instance is inside the Electron BrowserWindow**. Opening that URL in a regular Chrome tab gives you the React tree but no `window.api` (the contextBridge preload only injects into the Electron renderer), so every IPC call resolves to `undefined`. Anything that touches the database, network, files, or settings will silently no-op.

For automated UI driving use Playwright's `_electron` API (a separate concern; not what this skill is for). For manual verification just point the user at the actual Electron window — it should already be open and focused after launch.

If you genuinely need to inspect renderer DOM/CSS in isolation (e.g., a pure CSS layout question that doesn't touch IPC), opening `http://localhost:5173` in Chrome is fine — just don't expect any data to load.

## Reading errors out of the log

The dev log is verbose. Two warnings are always present and can be filtered out — they're not bugs:

- `MODULE_TYPELESS_PACKAGE_JSON Warning: Module type of file:///.../download-curl-binaries.js is not specified` — cosmetic, the script works.
- `[plugin vite:reporter] (!) ... is dynamically imported by ... but also statically imported by ...` (about `error-classifier.ts` and `runner.handler.ts`) — Vite chunking warning; behaviorally inert. Documented in CLAUDE.md → Gotchas.

A practical filter:

```bash
grep -iE "error|fail|crash|exception" <log-path> \
  | grep -v "MODULE_TYPELESS_PACKAGE_JSON" \
  | grep -v "error-classifier.ts is dynamically imported" \
  | grep -v "runner.handler.ts is dynamically imported"
```

Anything that survives that filter is worth reading. Renderer console errors are prefixed with a timestamp (`HH:MM:SS.MMM ›`) — those come from `electron-log` forwarding the BrowserWindow's console.

## Stopping the app

If launched in foreground, Ctrl+C in the terminal kills the whole tree.

If launched via `Bash(run_in_background: true)`, you have two options:

1. Use `KillShell` (or the harness's equivalent) on the bash task id — this sends SIGTERM to the npm script and Electron tears down cleanly.
2. Find the `electron-vite dev` PID via `ps aux | grep electron-vite | grep -v grep` and `kill <pid>`. Electron child processes die with the parent.

Avoid `pkill -f Testnizer` — the user may have a packaged install of Testnizer running alongside the dev build and the names overlap.

## When to use the E2E suite instead

If the goal is regression-proofing a specific flow (HTTP request lifecycle, SOAP envelope, WSSE), prefer:

```bash
npm run test:all          # unit → build → playwright e2e
npm run test:e2e          # e2e only, needs a prior `npm run build`
npm run test:e2e:smoke    # just tests/e2e/smoke.spec.ts
```

Playwright drives a packaged Electron build via the `_electron` API. That's the right tool when you want a deterministic, scriptable check — not for "let me look at the new modal and screenshot it."

## Quick reference

| Task | Command |
|---|---|
| Launch dev app | `npm run dev` |
| Wait for ready | `until grep -q "dev server running for the electron renderer" <log>; do sleep 1; done` |
| Confirm alive | `ps aux \| grep -E "Testnizer.app/Contents/MacOS/Electron" \| grep -v grep` |
| Filter real errors | `grep -iE "error\|fail" <log> \| grep -v "MODULE_TYPELESS\|is dynamically imported"` |
| Stop | KillShell on the bash task, or `kill <electron-vite pid>` |
| Renderer URL (debug only, no IPC) | `http://localhost:5173/` |
| E2E suite | `npm run test:e2e` (needs `npm run build` first) |
