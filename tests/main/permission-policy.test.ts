/**
 * Issue #294 — deny-by-default web permissions.
 *
 * Electron grants every permission request when no handler is installed (the
 * e2e baseline before this change: notifications, geolocation, camera and
 * microphone all "granted"). The policy allows four permissions, and only to
 * the app's own top-level document.
 */
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  decidePermission,
  installPermissionPolicy,
  isAppDocumentUrl,
  type AppDocument,
  type PermissionSession,
} from '../../src/main/lib/permission-policy'

const INDEX = path.resolve('/opt/Testnizer/resources/app.asar/out/renderer/index.html')
const APP_URL = pathToFileURL(INDEX).href
const PROD: AppDocument = { indexHtmlPath: INDEX }
const DEV: AppDocument = { indexHtmlPath: INDEX, devServerUrl: 'http://localhost:5173' }

type Row = [
  label: string,
  permission: string,
  isMainFrame: boolean,
  requestingUrl: string | undefined,
  expected: boolean,
  externalURL?: string,
]

const TABLE: Row[] = [
  // ── allowed: the app's own top-level document ─────────────────────────────
  ['copy buttons', 'clipboard-sanitized-write', true, APP_URL, true],
  ['Import → paste from clipboard', 'clipboard-read', true, APP_URL, true],
  ['video preview fullscreen', 'fullscreen', true, APP_URL, true],
  ['EnterpriseModal mailto link', 'openExternal', true, APP_URL, true, 'mailto:sales@example.com'],
  ['hash route of the app document', 'clipboard-sanitized-write', true, `${APP_URL}#/x`, true],
  // ── denied: permissions the app never uses ────────────────────────────────
  ['notifications', 'notifications', true, APP_URL, false],
  ['camera / microphone', 'media', true, APP_URL, false],
  ['geolocation', 'geolocation', true, APP_URL, false],
  ['screen capture', 'display-capture', true, APP_URL, false],
  ['MIDI sysex', 'midiSysex', true, APP_URL, false],
  ['pointer lock', 'pointerLock', true, APP_URL, false],
  ['keyboard lock', 'keyboardLock', true, APP_URL, false],
  ['window management', 'window-management', true, APP_URL, false],
  ['File System Access', 'fileSystem', true, APP_URL, false],
  ['legacy sync clipboard read', 'deprecated-sync-clipboard-read', true, APP_URL, false],
  ['HID', 'hid', true, APP_URL, false],
  ['serial', 'serial', true, APP_URL, false],
  ['USB', 'usb', true, APP_URL, false],
  ['idle detection', 'idle-detection', true, APP_URL, false],
  ['local fonts', 'local-fonts', true, APP_URL, false],
  ['storage access', 'storage-access', true, APP_URL, false],
  ['unknown', 'unknown', true, APP_URL, false],
  // ── denied: an allowed permission from the wrong frame / URL ──────────────
  ['HTML preview srcdoc subframe', 'clipboard-read', false, 'about:srcdoc', false],
  ['srcdoc even if reported as main', 'clipboard-read', true, 'about:srcdoc', false],
  ['PDF blob frame', 'clipboard-sanitized-write', false, 'blob:file:///4f1c', false],
  ['blob URL as main frame', 'fullscreen', true, 'blob:file:///4f1c', false],
  [
    'PDF viewer extension frame',
    'fullscreen',
    false,
    'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
    false,
  ],
  ['app URL but subframe', 'clipboard-read', false, APP_URL, false],
  ['another file:// page', 'clipboard-read', true, pathToFileURL('/tmp/evil.html').href, false],
  [
    'sibling file next to index.html',
    'clipboard-read',
    true,
    pathToFileURL(path.join(path.dirname(INDEX), 'other.html')).href,
    false,
  ],
  ['external https page', 'clipboard-read', true, 'https://example.com/', false],
  ['no requesting URL', 'clipboard-read', true, undefined, false],
  ['malformed URL', 'clipboard-read', true, 'not a url', false],
  // ── openExternal is mailto: only ──────────────────────────────────────────
  ['openExternal file:', 'openExternal', true, APP_URL, false, 'file:///etc/passwd'],
  ['openExternal smb:', 'openExternal', true, APP_URL, false, 'smb://host/share'],
  ['openExternal custom scheme', 'openExternal', true, APP_URL, false, 'vscode://x'],
  ['openExternal without URL (check handler)', 'openExternal', true, APP_URL, false],
  [
    'openExternal mailto from subframe',
    'openExternal',
    false,
    'about:srcdoc',
    false,
    'mailto:a@b.c',
  ],
]

describe('permission policy table (issue #294)', () => {
  it.each(TABLE)(
    '%s: %s → %s',
    (_label, permission, isMainFrame, requestingUrl, expected, externalURL) => {
      expect(decidePermission({ permission, isMainFrame, requestingUrl, externalURL }, PROD)).toBe(
        expected,
      )
    },
  )

  it('dev server: same origin is the app document, other localhost ports are not', () => {
    expect(isAppDocumentUrl('http://localhost:5173/', DEV)).toBe(true)
    expect(isAppDocumentUrl('http://localhost:5173/index.html#/x', DEV)).toBe(true)
    expect(isAppDocumentUrl('http://localhost:5174/', DEV)).toBe(false)
    expect(isAppDocumentUrl('http://127.0.0.1:5173/', DEV)).toBe(false)
    // The packaged file is still recognised (dev with a built renderer).
    expect(isAppDocumentUrl(APP_URL, DEV)).toBe(true)
    // No dev server configured → a localhost page is NOT the app.
    expect(isAppDocumentUrl('http://localhost:5173/', PROD)).toBe(false)
  })
})

describe('installPermissionPolicy', () => {
  function install() {
    const handlers: {
      request?: Parameters<PermissionSession['setPermissionRequestHandler']>[0]
      check?: Parameters<PermissionSession['setPermissionCheckHandler']>[0]
      device?: Parameters<PermissionSession['setDevicePermissionHandler']>[0]
    } = {}
    const ses: PermissionSession = {
      setPermissionRequestHandler: (h) => (handlers.request = h),
      setPermissionCheckHandler: (h) => (handlers.check = h),
      setDevicePermissionHandler: (h) => (handlers.device = h),
    }
    const log = vi.fn()
    installPermissionPolicy(ses, PROD, log)
    return { handlers, log }
  }

  it('installs all three handlers', () => {
    const { handlers } = install()
    expect(handlers.request).toBeTypeOf('function')
    expect(handlers.check).toBeTypeOf('function')
    expect(handlers.device).toBeTypeOf('function')
  })

  it('request handler grants the allow-list and denies (and logs) the rest', () => {
    const { handlers, log } = install()
    const cb = vi.fn()
    handlers.request!({}, 'clipboard-read', cb, { isMainFrame: true, requestingUrl: APP_URL })
    expect(cb).toHaveBeenLastCalledWith(true)
    expect(log).not.toHaveBeenCalled()

    handlers.request!({}, 'media', cb, { isMainFrame: true, requestingUrl: APP_URL })
    expect(cb).toHaveBeenLastCalledWith(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('denied request "media"'))

    handlers.request!({}, 'openExternal', cb, {
      isMainFrame: true,
      requestingUrl: APP_URL,
      externalURL: 'mailto:x@y.z',
    })
    expect(cb).toHaveBeenLastCalledWith(true)
  })

  it('check handler uses the same decision (clipboard write must pass the check too)', () => {
    const { handlers } = install()
    expect(
      handlers.check!(null, 'clipboard-sanitized-write', 'file:///', {
        isMainFrame: true,
        requestingUrl: APP_URL,
      }),
    ).toBe(true)
    expect(
      handlers.check!(null, 'notifications', 'file:///', {
        isMainFrame: true,
        requestingUrl: APP_URL,
      }),
    ).toBe(false)
    expect(
      handlers.check!(null, 'clipboard-read', 'file:///', {
        isMainFrame: false,
        requestingUrl: 'about:srcdoc',
      }),
    ).toBe(false)
  })

  it('device permission handler denies every device', () => {
    const { handlers } = install()
    expect(handlers.device!({ deviceType: 'hid', origin: 'file://' })).toBe(false)
    expect(handlers.device!({ deviceType: 'usb', origin: 'file://' })).toBe(false)
    expect(handlers.device!({ deviceType: 'serial', origin: 'file://' })).toBe(false)
  })
})
