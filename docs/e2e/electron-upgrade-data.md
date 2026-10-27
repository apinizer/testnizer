# Electron upgrade: proving user data survives (issue #291)

1.6.0 moves Testnizer from Electron 33 (Node 20, Chromium 130) to Electron 44
(Node 24, Chromium 152). The data a user already has must open unchanged:

- the SQLite database;
- values sealed with `safeStorage`: secret variables, mock auth, the Mock MCP
  bearer token, certificate passphrases, the OTP seeds, the AI provider key and
  passwords in project settings;
- the electron-store files (`settings.json`, `config.json`);
- renderer localStorage (open tabs, unsaved drafts).

`tests/e2e/ui/49-electron-upgrade-data.spec.ts` proves it. This page covers how
to run the opt-in parts and the checks that stay manual.

## What runs automatically

**"a 1.5.4 profile opens on this build…"** runs in every `--project=ui` run,
on all three platforms. It rebuilds a v1.5.4 profile from the checked-in,
secret-free dump in `tests/fixtures/upgrade-data/`, starts this build on it,
and asserts the following:

- **Rows:** every table and every row of the old DB is still there, with every
  old column unchanged. The only allowed changes are the `CHANGE_RULES` in the
  spec: issue #239 sealing of secret values, and the issue #195/#238 masking
  of credentials echoed in History and Runner rows.
- **Secrets:** they decrypt, through the app's IPC, to the values v1.5.4
  stored.
- **Settings:** they read back as written.
- **Backup (issue #297):** exactly one pre-migration backup exists. It holds
  every row and its secrets are sealed.
- **Second start:** no new backup is taken, and the saved request Sends to
  the local test server.

## Opt-in: a profile written by an older build

This needs a built copy of the older build, with its own `node_modules/electron`
and `out/`.

```bash
# A pre-upgrade build: the commit before issue #291, or a release tag.
git archive --format=tar v1.5.4 | tar -x -C /tmp/tnz-old
cd /tmp/tnz-old && npm ci && npm run build

# From this checkout, after `npm run build`:
TESTNIZER_OLD_BUILD_DIR=/tmp/tnz-old TESTNIZER_OLD_BUILD_LABEL=v1.5.4 \
  npx playwright test --project=ui tests/e2e/ui/49-electron-upgrade-data.spec.ts
```

The test then works in three steps:

1. **The old build writes the profile, on its own Electron.** It creates a
   workspace with two projects, folders with auth and scripts, and requests for
   HTTP, GraphQL, SOAP, WebSocket, Socket.IO, MQTT, MCP, gRPC and SSE. It adds
   a saved request, saved examples, environments with secret and normal
   variables (current and initial values), project variables, an HTTP mock with
   auth, a Mock MCP server with a bearer token, a certificate row, an OTP entry,
   history, a Runner result, a test suite, settings including the AI key and
   a proxy password, and two open tabs, one with an unsaved draft.
2. **This build opens a copy.** The same row, secret, settings and backup checks
   run as in the automatic test. On top of that:
   - localStorage reads back: for the same app version on the older Electron,
     every key the old Chromium wrote; for an older app version, the tab list
     and the request drafts (other tab stores may reshape their own snapshot
     on load, as the Socket.IO store does in 1.6.0);
   - both tabs and the draft are restored on screen;
   - the saved request Sends.
3. **The old build opens what this build left (downgrade).** No row or column
   is lost; new tables and columns are additive. Sealed values decrypt on the
   old runtime when the old build knows about sealing (the pre-upgrade 1.6.0
   build does). 1.5.x predates issue #239, so after a downgrade to 1.5.x the
   secret variables show their `enc:v1:` text instead of the value. That is a
   1.6.0 storage change, not an Electron one, and the test only checks it for
   builds that seal.

Add `TESTNIZER_WRITE_FIXTURE=1` to regenerate the checked-in fixture from the
old build's profile. The generator drops machine-bound ciphertext (OTP seeds,
certificate passphrases, the AI key, proxy passwords). It refuses to write a
dump that still contains `enc:` values.

## Manual RC checks (cannot be automated)

Both automated tests pin safeStorage to Chromium's built-in test keys:
`--use-mock-keychain` on macOS and `--password-store=basic` on Linux. So they
never prompt and never touch your keychain. The ciphertext format and the
decrypt path are the same with a real key store. What they cannot show is
whether the signed 1.6.0 app is allowed to read the key the 1.5.x app stored.

**macOS (signed RC build)**

1. On a Mac running 1.5.x, create the following:
   - a secret environment variable;
   - an OTP entry;
   - an AI provider key;
   - a project proxy password.
2. Install the 1.6.0 RC over it from the DMG.
3. Start it. There must be no keychain prompt, because the Developer ID team
   is the same. The secret values must show in the environment editor, and
   the OTP code must match an authenticator app.
4. In Keychain Access, "Testnizer Safe Storage" is still the only Testnizer
   item.
5. In Finder, open `~/Library/Application Support/Testnizer/backups`. It holds
   exactly one `testnizer.db.1.6.0-*` file (the copy taken before the first
   1.6.0 start; the app has no screen for it).

Ad-hoc signed local builds prompt for keychain access once. That is expected
for unsigned builds and does not happen with the Developer ID build.

**macOS 12 or older**

A 1.5.x install on macOS 11 or 12 must NOT be offered 1.6.0. Electron 44 needs
macOS 13, and `latest-mac.yml` carries `minimumSystemVersion: 22.0.0`. Check
for updates there: the app must report that no update is available.

**Linux (deb or AppImage, GNOME and KDE)**

1. Start 1.5.x on the desktop under test and add a secret variable.
2. Also add an OTP entry and an AI provider key. In 1.5.x these are the
   values already encrypted with the OS keyring; secret variables are still
   plain text there and are encrypted on the first 1.6.0 start.
3. Upgrade and start 1.6.0. The variable, the OTP code and the AI key must all
   still work.
4. "Secrets are stored unencrypted: OS keychain unavailable." under the
   variable means no keyring was reachable. Values still work; note it in the
   report.
5. "Can't decrypt this secret on this computer" is a blocker: a value written
   by 1.5.x no longer opens.

**Windows (x64 and arm64)**

DPAPI is bound to the Windows user, not to the Electron version. Run the
installer over 1.5.x without uninstalling, then check that the secret
variable and the OTP entry are there.
