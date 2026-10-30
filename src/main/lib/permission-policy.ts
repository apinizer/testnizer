/**
 * Web permission policy for the app's session (issue #294).
 *
 * Electron GRANTS every permission request by default — camera, microphone,
 * geolocation, notifications, clipboard, MIDI… — to any frame, including an
 * iframe showing a response body. Testnizer's renderer needs almost none of
 * that, so the policy is deny-by-default with a short allow-list, and only the
 * app's own top-level document can use it:
 *
 *   permission                  why the app needs it
 *   ─────────────────────────── ──────────────────────────────────────────────
 *   clipboard-sanitized-write   every "Copy" button (navigator.clipboard.writeText)
 *   clipboard-read              Import → "Paste from clipboard" (ImportModal)
 *   fullscreen                  the fullscreen button of a video response preview
 *   openExternal (mailto: only) the bare `mailto:` link in EnterpriseModal
 *
 * Everything else — and every one of the above when asked by a subframe (HTML
 * preview `srcdoc`, the PDF viewer's `blob:` frame), another `file://` page or
 * a remote origin — is refused. The same decision function backs both the
 * request handler and the check handler: Chromium consults the CHECK handler
 * for clipboard writes and `navigator.permissions.query`, so a check handler
 * that said "no" while the request handler said "yes" would still break copy.
 *
 * Device access (HID / serial / USB) is refused through the device permission
 * handler as well; Bluetooth needs no handler (with no `select-bluetooth-device`
 * listener Electron cancels every request).
 */
import { pathToFileURL } from 'node:url'

/** Where the app's own document is loaded from. */
export interface AppDocument {
  /** Dev server origin (ELECTRON_RENDERER_URL), when running under `npm run dev`. */
  devServerUrl?: string
  /** Absolute path of the packaged `renderer/index.html`. */
  indexHtmlPath: string
}

export interface PermissionQuery {
  permission: string
  isMainFrame: boolean
  /** The URL of the frame asking (Electron's `requestingUrl`). */
  requestingUrl?: string
  /** `openExternal` requests only: the URL that would be handed to the OS. */
  externalURL?: string
}

/** Allowed for the app's top-level document; everything else is denied. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'clipboard-read',
  'fullscreen',
  'openExternal',
])

/** `openExternal` may only hand these schemes to the OS (matches app:openExternal minus http(s), which never arrive here). */
const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set(['mailto:'])

function stripVolatile(url: URL): string {
  url.hash = ''
  url.search = ''
  return url.href
}

/** True when `url` is the app's own renderer document (not another file, not a blob, not srcdoc). */
export function isAppDocumentUrl(url: string | undefined, doc: AppDocument): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (doc.devServerUrl) {
    try {
      const dev = new URL(doc.devServerUrl)
      if ((dev.protocol === 'http:' || dev.protocol === 'https:') && parsed.origin === dev.origin) {
        return true
      }
    } catch {
      // Malformed dev URL — fall through to the packaged file check.
    }
  }
  if (parsed.protocol !== 'file:') return false
  return stripVolatile(parsed) === stripVolatile(pathToFileURL(doc.indexHtmlPath))
}

/** The single decision both handlers use. */
export function decidePermission(query: PermissionQuery, doc: AppDocument): boolean {
  if (!ALLOWED_PERMISSIONS.has(query.permission)) return false
  if (!query.isMainFrame) return false
  if (!isAppDocumentUrl(query.requestingUrl, doc)) return false
  if (query.permission === 'openExternal') {
    if (!query.externalURL) return false
    try {
      return EXTERNAL_SCHEMES.has(new URL(query.externalURL).protocol)
    } catch {
      return false
    }
  }
  return true
}

/** The parts of `Electron.Session` the policy installs itself on. */
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: { isMainFrame: boolean; requestingUrl: string; externalURL?: string },
    ) => void,
  ): void
  setPermissionCheckHandler(
    handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: { isMainFrame: boolean; requestingUrl?: string },
    ) => boolean,
  ): void
  setDevicePermissionHandler(handler: (details: unknown) => boolean): void
}

export type DeniedLogger = (message: string) => void

/** Install the policy on a session. `logDenied` should be debug-level only. */
export function installPermissionPolicy(
  ses: PermissionSession,
  doc: AppDocument,
  logDenied: DeniedLogger = () => {},
): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const granted = decidePermission(
      {
        permission,
        isMainFrame: details.isMainFrame,
        requestingUrl: details.requestingUrl,
        externalURL: details.externalURL,
      },
      doc,
    )
    if (!granted) {
      logDenied(
        `[permissions] denied request "${permission}" from ${details.requestingUrl || '(unknown)'}` +
          `${details.isMainFrame ? '' : ' (subframe)'}`,
      )
    }
    callback(granted)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const granted = decidePermission(
      {
        permission,
        isMainFrame: details.isMainFrame,
        requestingUrl: details.requestingUrl,
      },
      doc,
    )
    if (!granted) {
      logDenied(
        `[permissions] denied check "${permission}" from ${details.requestingUrl || requestingOrigin || '(unknown)'}`,
      )
    }
    return granted
  })
  ses.setDevicePermissionHandler(() => false)
}
