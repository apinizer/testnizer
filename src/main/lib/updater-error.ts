/**
 * Rephrase auto-updater errors into actionable messages (issue #34).
 *
 * macOS auto-update requires a signed (ideally notarized) app; an ad-hoc /
 * unsigned build can't self-update and electron-updater fails with a code-
 * signature error. Turn that into something the user can act on — the update
 * modal also offers a manual-download link. Other errors pass through verbatim.
 *
 * Pure + electron-free so it can be unit-tested without mocking the runtime.
 */
export function formatUpdaterError(platform: NodeJS.Platform, message: string): string {
  if (
    platform === 'darwin' &&
    /code sign|signature|not.*valid.*process|could not get/i.test(message)
  ) {
    return 'Automatic update is not available for this macOS build (code signature requirement). Please download the latest version manually.'
  }
  return message
}
