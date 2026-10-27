/**
 * Issue #294 — renderer hardening.
 *
 *  1. The window runs with the OS sandbox (`sandbox: true`), and the preload
 *     bridge still works under it: the built preload `require`s nothing but
 *     electron, `window.api` / `window.electron` / electron-log's bridge exist,
 *     a real Send succeeds and Settings → About reads the runtime versions.
 *  2. A PDF response is never rendered in an iframe of the app document;
 *     "Open in PDF viewer" writes the body to a private temp file and hands it
 *     to `shell.openPath` (stubbed here — no viewer pops up).
 *  3. Web permissions are deny-by-default. Measured before this change, Electron
 *     granted all of these: Notification.requestPermission → "granted",
 *     permissions.query for notifications / geolocation / camera / microphone →
 *     "granted", geolocation → error 3 (timeout, i.e. it was allowed to try).
 *     The allow-list (clipboard read/write for the app document) keeps working.
 *
 * getUserMedia is deliberately NOT asserted: on a machine without a usable
 * capture device it neither resolves nor rejects within seconds, before AND
 * after the change, so it cannot tell the two apart.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { fillUrl, clickSend, waitForResponseStatus } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'
import { decidePermission, isAppDocumentUrl } from '../../../src/main/lib/permission-policy'

/** A one-page PDF with a correct xref table. */
function minimalPdf(): Buffer {
  const stream = 'BT /F1 24 Tf 40 100 Td (Sandbox PDF) Tj ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

uiTest.describe('Renderer sandbox [issue #294]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('the window runs sandboxed, isolated, without Node integration', async ({ app }) => {
    const prefs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => {
        const p = w.webContents.getLastWebPreferences()
        return {
          sandbox: p?.sandbox,
          contextIsolation: p?.contextIsolation,
          nodeIntegration: p?.nodeIntegration,
        }
      }),
    )
    expect(prefs.length).toBeGreaterThan(0)
    for (const p of prefs) {
      expect(p).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    }

    // The OS-level answer. `sandboxed` is reported on macOS and Windows only.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const tabs = await app.evaluate(({ app: a }) =>
        a
          .getAppMetrics()
          .filter((m) => m.type === 'Tab')
          .map((m) => m.sandboxed),
      )
      expect(tabs.length).toBeGreaterThan(0)
      expect(tabs.every((s) => s === true)).toBe(true)
    }
  })

  uiTest('the built preload is one bundle that only requires electron', async () => {
    const built = fs.readFileSync(path.resolve(__dirname, '../../../out/preload/index.js'), 'utf8')
    const requires = [...built.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
    expect([...new Set(requires)]).toEqual(['electron'])
    // CommonJS, not ESM — a sandboxed preload cannot be an ES module.
    expect(built).not.toMatch(/^\s*import\s/m)
  })

  uiTest('the bridges exist and the renderer has no Node globals', async ({ window }) => {
    const seen = await window.evaluate(() => {
      const w = window as unknown as {
        api?: Record<string, unknown>
        electron?: { process?: { versions?: Record<string, string>; platform?: string } }
        __electronLog?: unknown
      }
      return {
        api: Object.keys(w.api ?? {}).length,
        electronVersion: w.electron?.process?.versions?.electron,
        platform: w.electron?.process?.platform,
        electronLog: typeof w.__electronLog,
        process: typeof (globalThis as { process?: unknown }).process,
        require: typeof (globalThis as { require?: unknown }).require,
      }
    })
    expect(seen.api).toBeGreaterThan(40)
    expect(seen.electronVersion).toMatch(/^44\./)
    expect(seen.platform).toBe(process.platform)
    expect(seen.electronLog).toBe('object')
    expect(seen.process).toBe('undefined')
    expect(seen.require).toBe('undefined')
  })

  uiTest('Send and Settings → About still work through the sandboxed preload', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get`)
    await clickSend(window)
    expect(await waitForResponseStatus(window, 20_000)).toBe(200)

    await window.getByTestId('nav-settings').click()
    const modal = window.getByTestId('project-detail-modal')
    await expect(modal).toBeVisible({ timeout: 8_000 })
    await window.getByTestId('project-detail-tab-about').click()
    // AboutPane reads window.electron.process.versions through the preload.
    await expect(modal.getByText(/^44\.\d+\.\d+$/).first()).toBeVisible({ timeout: 8_000 })
    await window.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5_000 })
  })

  uiTest('web permissions the app does not use are denied', async ({ window }) => {
    const result = await window.evaluate(async () => {
      const within = <T,>(p: Promise<T>, ms = 5000): Promise<T | 'TIMEOUT'> =>
        Promise.race([p, new Promise<'TIMEOUT'>((r) => setTimeout(() => r('TIMEOUT'), ms))])
      const query = async (name: string): Promise<string> => {
        try {
          const s = await within(navigator.permissions.query({ name: name as PermissionName }))
          return typeof s === 'string' ? s : s.state
        } catch (e) {
          return `error: ${(e as Error).message}`
        }
      }
      return {
        notificationRequest: await within(Notification.requestPermission()),
        notificationState: Notification.permission,
        notifications: await query('notifications'),
        geolocation: await query('geolocation'),
        camera: await query('camera'),
        microphone: await query('microphone'),
        geolocationCode: await within(
          new Promise<number>((resolve) =>
            navigator.geolocation.getCurrentPosition(
              () => resolve(0),
              (err) => resolve(err.code),
              { timeout: 4000 },
            ),
          ),
        ),
      }
    })
    expect(result).toEqual({
      notificationRequest: 'denied',
      notificationState: 'denied',
      notifications: 'denied',
      geolocation: 'denied',
      camera: 'denied',
      microphone: 'denied',
      // GeolocationPositionError.PERMISSION_DENIED
      geolocationCode: 1,
    })
  })

  uiTest('the clipboard allow-list still works for the app document', async ({ window }) => {
    const marker = `issue-294-${Date.now()}`
    const result = await window.evaluate(async (text) => {
      await navigator.clipboard.writeText(text)
      return {
        read: await navigator.clipboard.readText(),
        write: (await navigator.permissions.query({ name: 'clipboard-write' as PermissionName }))
          .state,
      }
    }, marker)
    expect(result).toEqual({ read: marker, write: 'granted' })

    // The live main-frame URL is what Electron reports as `requestingUrl`, so it
    // must be recognised as the app document — otherwise the mailto: link
    // (openExternal) and the video fullscreen button would be refused too.
    const doc = { indexHtmlPath: path.resolve(__dirname, '../../../out/renderer/index.html') }
    expect(isAppDocumentUrl(window.url(), doc)).toBe(true)
    expect(
      decidePermission(
        {
          permission: 'openExternal',
          isMainFrame: true,
          requestingUrl: window.url(),
          externalURL: 'mailto:sales@example.com',
        },
        doc,
      ),
    ).toBe(true)
    expect(
      decidePermission({ permission: 'fullscreen', isMainFrame: true, requestingUrl: window.url() }, doc),
    ).toBe(true)
  })

  uiTest('a PDF response opens in the system viewer, never in an iframe', async ({ app, window }) => {
    const pdf = minimalPdf()
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length })
      res.end(pdf)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port

    // Record shell.openPath instead of launching a real viewer.
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __openedPaths?: string[]; __realOpenPath?: unknown }
      g.__openedPaths = []
      g.__realOpenPath = shell.openPath
      shell.openPath = async (p: string) => {
        g.__openedPaths!.push(p)
        return ''
      }
    })
    try {
      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await fillUrl(window, `http://127.0.0.1:${port}/report.pdf`)
      await clickSend(window)
      expect(await waitForResponseStatus(window, 20_000)).toBe(200)
      await window.getByTestId('res-tab-body').click()

      const preview = window.getByTestId('res-binary-preview')
      await expect(preview.getByTestId('res-binary-pdf')).toBeVisible({ timeout: 10_000 })
      await expect(preview.locator('iframe')).toHaveCount(0)
      expect(window.frames().some((f) => f.url().startsWith('chrome-extension://'))).toBe(false)
      await expect(window.getByTestId('res-binary-download')).toBeVisible()

      await window.getByTestId('res-binary-open-pdf').click()
      await expect
        .poll(() =>
          app.evaluate(
            () => (globalThis as unknown as { __openedPaths: string[] }).__openedPaths.length,
          ),
        )
        .toBe(1)
      const opened = await app.evaluate(
        () => (globalThis as unknown as { __openedPaths: string[] }).__openedPaths[0],
      )
      expect(path.extname(opened)).toBe('.pdf')
      expect(path.basename(path.dirname(opened))).toMatch(/^testnizer-pdf-/)
      expect(fs.readFileSync(opened).equals(pdf)).toBe(true)
      if (process.platform !== 'win32') {
        expect(fs.statSync(opened).mode & 0o777).toBe(0o600)
      }
    } finally {
      await app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __realOpenPath?: typeof shell.openPath }
        if (g.__realOpenPath) shell.openPath = g.__realOpenPath
      })
      server.close()
    }
  })
})
