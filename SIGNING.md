# Code Signing

Testnizer ships signed installers so users don't hit "unknown publisher" /
Gatekeeper warnings. Windows and macOS are signed through **separate**
mechanisms.

| Platform | Mechanism | Cost | Status |
|---|---|---|---|
| **Windows** | [SignPath Foundation](https://signpath.io/open-source) (free OSS code signing) | Free | ⏳ application pending · CI skeleton **wired & guarded** (`build.yml` Windows job) |
| **macOS** | Apple Developer ID + notarization (`scripts/notarize.js`) | $99/yr (Apple) | ⏳ needs Apple membership · CI **wired & guarded** — add the 5 secrets to activate |

> Both CI paths are already in `build.yml`, gated so they're **completely inert
> until the secrets exist** — current unsigned/ad-hoc builds are byte-identical.
> macOS goes fully live the moment the secrets are added. Windows needs one
> finalize + test-tag pass after approval (the signed-installer publish handoff
> can't be verified without the real certificate).

> SignPath covers **Windows only**. macOS notarization is Apple-exclusive and
> is not solved by open-sourcing. Until an Apple Developer membership is added,
> macOS builds remain ad-hoc-signed and the update modal routes macOS users to
> a manual download (see `src/main/lib/updater-error.ts` / issue #34).

---

## Windows — SignPath Foundation

SignPath Foundation provides free **OV-level** Authenticode signing for
qualifying open-source projects. Signing runs in CI: the unsigned artifact is
uploaded, SignPath signs it (cloud HSM), and the signed artifact comes back —
no hardware token, no private key on the build machine.

### Eligibility (already met / to confirm)

- [x] Public source repository — https://github.com/apinizer/testnizer
- [x] OSI-approved license — **MIT** (`LICENSE`)
- [x] Project released + described on a download page — https://www.testnizer.com
- [ ] **All team members have MFA enabled on GitHub _and_ SignPath** (required)
- [ ] Every release is **manually approved** for signing (SignPath policy)

> Note on the binary EULA: the **source** is pure MIT (no dual-licensing). The
> EULA in `docs/legal/eula.md` only adds terms for our *official pre-built
> binaries* (trademark + update channel) and explicitly does not narrow the
> MIT-licensed source. If the SignPath reviewer asks, state this clearly. If it
> becomes a blocker, the fallback is to drop the binary EULA and ship the
> binaries under pure MIT too.

### Application

Apply at **https://signpath.io/open-source**. Submit:

| Field | Value |
|---|---|
| Project name | Testnizer |
| Description | Free, fully-offline cross-platform desktop API testing app (Electron + React). All data stays local; no telemetry. |
| Repository | https://github.com/apinizer/testnizer |
| License | MIT |
| Download / info page | https://www.testnizer.com |
| Artifacts to sign | Windows NSIS installer + app `.exe` (x64 + arm64) |
| Build system | GitHub Actions (`.github/workflows/build.yml`) + electron-builder |

Approval typically takes ~1 week. On approval SignPath provisions an
**organization id**, a **project slug**, and a **signing-policy slug**.

### CI integration (skeleton already wired)

`build.yml`'s `build-windows` job already contains the guarded flow — three
steps (`Upload unsigned installer` → `Sign with SignPath` → `Publish signed
installer`) that are skipped entirely while `SIGNPATH_API_TOKEN` is empty, plus
a conditional publish (when SignPath is active the package step builds with
`--publish never` so the unsigned `.exe` doesn't win the race). On approval:

1. Add repo secrets (`apinizer/testnizer` → Settings → Secrets → Actions):
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORGANIZATION_ID`
2. Replace the two `TODO: real slug at approval` placeholders in the
   `Sign with SignPath` step with the real `signing-policy-slug` and
   `artifact-configuration-slug` from your SignPath project.
3. **Implement the `Publish signed installer` step** (currently a loud
   tripwire — it `exit 1`s so an unsigned build is never mistaken for signed):
   replace `dist/*.exe` with `dist-signed/*.exe`, recompute the
   electron-updater `latest.yml` `sha512` + `size` for the signed file, and
   `gh release upload` both.
4. **Validate with a test tag** — install the signed build (no SmartScreen
   "unknown publisher"), then confirm in-app auto-update accepts it (hash must
   match `latest.yml`). Only then is Windows signing live.

The guard means merging this skeleton can't break anything; the only piece that
genuinely needs the real certificate to verify is steps 3–4.

---

## macOS — Apple Developer ID (CI wired, needs membership)

The `build.yml` macOS job already passes the signing env through, gated on the
secrets: `scripts/ad-hoc-sign.js` (afterPack) steps aside when an Apple identity
is present so electron-builder signs with Developer ID, and `scripts/notarize.js`
(afterSign) notarizes via `notarytool`. `CSC_IDENTITY_AUTO_DISCOVERY` is
auto-`true` only when a cert is supplied, else `false` (ad-hoc path). **Nothing
else in CI needs to change — just add the secrets:**

### Step-by-step

**1. Enroll in the Apple Developer Program ($99/yr)** — developer.apple.com/programs/enroll
   - **Individual** (fast, ~24–48h, signer shows your personal name) or
     **Organization** (signer shows the company name, but needs a free D-U-N-S
     number + legal verification — days to weeks). Individual is the pragmatic
     pick for an OSS app; Organization only if company branding on the signature
     matters.

**2. Create a "Developer ID Application" certificate** (no Xcode needed):
   - Keychain Access → *Certificate Assistant → Request a Certificate From a
     Certificate Authority* → enter your email + a name, choose **Saved to disk**
     → save the `.certSigningRequest`.
   - developer.apple.com/account → **Certificates** → **+** → **Developer ID
     Application** → upload the CSR → download the `.cer` → double-click to add it
     to the **login** keychain.

**3. Export the cert as `.p12`** (cert + private key together):
   - Keychain Access → **My Certificates** → expand *“Developer ID Application:
     …”* (must show a private key under it) → right-click → **Export** → `.p12`
     → set a password. **That password = `CSC_KEY_PASSWORD`.**

**4. App-specific password + Team ID:**
   - appleid.apple.com → *Sign-In and Security → App-Specific Passwords* →
     generate (e.g. `testnizer-notarize`) → that's `APPLE_APP_SPECIFIC_PASSWORD`
     (format `xxxx-xxxx-xxxx-xxxx`).
   - developer.apple.com/account → *Membership* → the 10-char **Team ID** =
     `APPLE_TEAM_ID`.

**5. Base64-encode the `.p12` for `CSC_LINK`:**
   ```bash
   base64 -i DeveloperID.p12 | pbcopy     # → clipboard, paste as the secret
   ```

**6. Add the 5 repo secrets** (github.com/apinizer/testnizer → Settings →
   Secrets and variables → Actions → New repository secret):

   | Secret | Value |
   |---|---|
   | `CSC_LINK` | base64 of the `.p12` (step 5) |
   | `CSC_KEY_PASSWORD` | the `.p12` export password (step 3) |
   | `APPLE_ID` | your Apple account e-mail |
   | `APPLE_APP_SPECIFIC_PASSWORD` | step 4 |
   | `APPLE_TEAM_ID` | step 4 |

That's it — the next tag/release builds signed + notarized macOS automatically.

> **Do NOT flip `build.mac.notarize` to `true`.** Notarization is handled by the
> custom `notarize.js` afterSign hook; `mac.notarize` stays `false` so
> electron-builder doesn't *also* notarize (which would double-submit and slow
> every build). The two are mutually exclusive — we use the hook.

**Verify the first signed build:** download the `.dmg`, the app should open with
no “unidentified developer” block. From a terminal:
```bash
spctl -a -vvv -t install /Applications/Testnizer.app   # → "source=Notarized Developer ID"
codesign -dv --verbose=4 /Applications/Testnizer.app    # shows the Developer ID
```

Once a signed + notarized macOS build ships, in-app auto-update (issue #34)
works on macOS too. No test-tag gymnastics needed — Apple signing is
deterministic, so the first signed release is the real one.
