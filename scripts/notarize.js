/**
 * electron-builder afterSign hook: notarize the .app bundle with Apple.
 *
 * Required env vars (set them in your shell or CI before running build:mac):
 *   APPLE_ID                     — your Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD  — app-specific password generated at
 *                                  https://appleid.apple.com/account/manage
 *   APPLE_TEAM_ID                — 10-char team ID from Apple Developer portal
 *
 * If any of these are missing, notarization is skipped (local/dev builds).
 */

const { notarize } = require('@electron/notarize')
const { join } = require('path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping notarization')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  console.log(`[notarize] Notarizing ${appPath} — this can take several minutes...`)
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })
  console.log('[notarize] Notarization completed')
}
