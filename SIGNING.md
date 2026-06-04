# Code Signing

Testnizer ships signed installers so users don't hit "unknown publisher" /
Gatekeeper warnings. Windows and macOS are signed through **separate**
mechanisms.

| Platform | Mechanism | Cost | Status |
|---|---|---|---|
| **Windows** | [SignPath Foundation](https://signpath.io/open-source) (free OSS code signing) | Free | ⏳ pending application |
| **macOS** | Apple Developer ID + notarization (`scripts/notarize.js`) | $99/yr (Apple) | ⏳ not enabled — needs Apple membership |

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

### CI integration (after approval)

1. Add repo secrets (`apinizer/testnizer` → Settings → Secrets → Actions):
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORGANIZATION_ID`
   - (project / policy slugs can be repo *variables* or inlined in the workflow)
2. In the Windows job of `build.yml`, after electron-builder produces the
   unsigned `.exe`, submit it for signing with the official action and swap the
   signed file back before publishing to the release:

   ```yaml
   - name: Sign Windows artifacts (SignPath)
     if: ${{ secrets.SIGNPATH_API_TOKEN != '' }}
     uses: SignPath/github-action-submit-signing-request@v1
     with:
       api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
       organization-id: ${{ secrets.SIGNPATH_ORGANIZATION_ID }}
       project-slug: testnizer
       signing-policy-slug: release-signing
       artifact-configuration-slug: nsis
       github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
       wait-for-completion: true
       output-artifact-directory: dist-signed
   ```

   The `if:` guard keeps unsigned builds working until the secrets exist, so
   merging the wiring early cannot break the pipeline. Finalize the exact
   artifact flow (upload unsigned → sign → re-publish) once the real slugs are
   known, and verify with a test tag.

---

## macOS — Apple Developer ID (not yet enabled)

The `afterSign` hook (`scripts/notarize.js`) already notarizes when these env
vars are present; CI currently disables signing (`CSC_IDENTITY_AUTO_DISCOVERY:
false`). To enable:

1. Apple Developer Program membership ($99/yr).
2. Create a **Developer ID Application** certificate; export as `.p12`.
3. Generate an app-specific password; note the 10-char Team ID.
4. Add repo secrets: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`,
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
5. Flip `build.mac.notarize` to `true` and make the macOS job sign when the
   secrets are present.

Once a signed + notarized macOS build ships, in-app auto-update (issue #34)
works on macOS too.
