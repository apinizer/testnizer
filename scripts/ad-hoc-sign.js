/**
 * electron-builder afterPack hook.
 *
 * If APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID env vars are
 * present, electron-builder's own Developer-ID signing + notarization flow
 * is used (we do nothing here for mac in that case).
 *
 * Otherwise we fall back to an ad-hoc signature so that unsigned downloads
 * at least produce the "Apple cannot verify this developer" dialog (with
 * right-click > Open > Open Anyway) instead of the bricking
 * "app is damaged and can't be opened" Gatekeeper error.
 */

const { execSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // Proper signing is configured — let electron-builder handle it.
  if (process.env.APPLE_ID && process.env.APPLE_TEAM_ID) return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  console.log(`[ad-hoc-sign] Ad-hoc signing ${appPath}`)
  try {
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    )
    console.log('[ad-hoc-sign] Ad-hoc signing completed')
  } catch (e) {
    console.error('[ad-hoc-sign] Ad-hoc signing failed:', e.message)
    throw e
  }
}
