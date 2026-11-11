/**
 * Tester report 2026-11-11 — the project Proxy pane on Run and on Send.
 *
 *  1. Bypass list on Run: Send sent a bypassed host directly, Run sent it
 *     through the proxy (`inheritedNetworkFor` dropped `bypass`). Control: the
 *     same run without the bypass entry does reach the proxy — otherwise a run
 *     that ignored the proxy entirely would pass too.
 *  2. Cleared credentials: a username + password typed into the pane and then
 *     cleared left `{username:'', password:''}`, and every Send failed with
 *     "Invalid proxy authorization". Now no login is saved and Send goes
 *     through the proxy unauthenticated.
 *
 * The proxy is a real forward proxy in the test process; it answers itself
 * ("via-proxy") and records what it saw. The project's proxy setting is put
 * back after each test (the ui project shares one Electron instance).
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToFolder, sendAndWaitResponse } from '../helpers/ui/request-flow'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import {
  openCollectionRunner,
  readRunnerTabSummary,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import { localHttpBin } from '../helpers/test-servers'

interface ForwardProxy {
  port: number
  seen: Array<{ url: string; auth?: string }>
  close: () => Promise<void>
}

async function startForwardProxy(): Promise<ForwardProxy> {
  const seen: ForwardProxy['seen'] = []
  const server = http.createServer((req, res) => {
    const auth = req.headers['proxy-authorization']
    seen.push({ url: String(req.url), ...(typeof auth === 'string' ? { auth } : {}) })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('via-proxy')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

type SettingsApi = {
  settings: {
    get: (k: string) => Promise<{ data?: unknown }>
    set: (k: string, v: unknown) => Promise<unknown>
  }
  folder: { delete: (id: string) => Promise<unknown> }
  savedRequest: {
    list: (pid: string) => Promise<{ data?: Array<{ id: string; name: string }> }>
    delete: (id: string) => Promise<unknown>
  }
}

async function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (k) => {
    const { api } = window as unknown as { api: SettingsApi }
    return (await api.settings.get(k)).data
  }, key)
}

/** Project Detail → Proxy → Custom proxy, filled through the pane's own inputs, then Save. */
async function saveProjectProxy(
  page: Page,
  p: { port: number; bypass?: string; typeThenClearLogin?: boolean },
): Promise<void> {
  await page.getByTestId('nav-settings').click()
  const modal = page.getByTestId('project-detail-modal')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  await modal.getByTestId('project-detail-tab-proxy').click()
  await modal.getByRole('button', { name: /Custom proxy|Özel proxy/i }).click()
  await modal.getByTestId('project-proxy-host').fill('127.0.0.1')
  await modal.getByTestId('project-proxy-port').fill(String(p.port))
  await modal.getByTestId('project-proxy-bypass').fill(p.bypass ?? '')
  if (p.typeThenClearLogin) {
    const user = modal.getByTestId('project-proxy-username')
    const pass = modal.getByTestId('project-proxy-password')
    await user.fill('e2e-user')
    await pass.fill('e2e-pass')
    await user.fill('')
    await pass.fill('')
  }
  await modal.getByRole('button', { name: /^(Save changes|Değişiklikleri kaydet)$/i }).click()
  await expect(modal).toBeHidden({ timeout: 8_000 })
}

const uid = (): string => String(Date.now()).slice(-8)

uiTest.describe('Project proxy settings on Run and Send', () => {
  let proxy: ForwardProxy
  let projectId = ''
  let projectKey = ''
  let saved: Record<string, unknown> | undefined
  const folders: string[] = []

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
    proxy = await startForwardProxy()
    projectId = await getActiveProjectId(window)
    projectKey = `project.${projectId}.settings`
    saved = (await readSetting(window, projectKey)) as Record<string, unknown> | undefined
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
    await window.evaluate(
      async ({ key, prev, ids, pid }) => {
        const { api } = window as unknown as { api: SettingsApi }
        // `proxy: null` = follow the app setting again (the delete marker).
        await api.settings.set(key, { ...(prev ?? {}), proxy: prev?.proxy ?? null })
        const rows = (await api.savedRequest.list(pid)).data ?? []
        for (const r of rows)
          if (r.name.startsWith('Bypass run ') || r.name.startsWith('Socks run '))
            await api.savedRequest.delete(r.id)
        for (const id of ids) await api.folder.delete(id)
      },
      { key: projectKey, prev: saved, ids: folders.splice(0), pid: projectId },
    )
    await proxy.close()
  })

  uiTest('Run: a target on the bypass list goes out directly', async ({ window }) => {
    const stamp = uid()
    const folderName = `Proxy69 ${stamp}`
    folders.push(await createFolder(window, projectId, folderName))
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?e2e69=${stamp}`)
    await saveRequestToFolder(window, `Bypass run ${stamp}`, folderName)
    await closeAllTabs(window)

    const proxiedThisRun = (): number => proxy.seen.filter((s) => s.url.includes(stamp)).length
    const results = window.getByTestId('workbench').getByTestId('runner-results-list')

    // 127.0.0.1 is on the bypass list: the run must not touch the proxy.
    await saveProjectProxy(window, { port: proxy.port, bypass: '127.0.0.1' })
    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp)
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window)
    await expect(results).toContainText('200')
    expect(proxiedThisRun()).toBe(0)
    await closeAllTabs(window)

    // Control: the same run without the entry does go through the proxy.
    await saveProjectProxy(window, { port: proxy.port, bypass: 'other.host' })
    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp)
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window)
    await expect(results).toContainText('200')
    expect(proxiedThisRun()).toBe(1)
  })

  uiTest('Run: a saved SOCKS proxy fails the row, nothing leaves', async ({ window }) => {
    // A target of our own, so a direct request would be counted too.
    const direct: string[] = []
    const target = http.createServer((req, res) => {
      direct.push(String(req.url))
      res.end('direct')
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    try {
      const stamp = uid()
      const folderName = `Proxy69s ${stamp}`
      folders.push(await createFolder(window, projectId, folderName))
      await openHttpRequestTab(window)
      const port = (target.address() as AddressInfo).port
      await fillUrl(window, `http://127.0.0.1:${port}/get?e2e69=socks-${stamp}`)
      await saveRequestToFolder(window, `Socks run ${stamp}`, folderName)
      await closeAllTabs(window)

      // The pane no longer offers SOCKS; a project saved by an older build holds it.
      await window.evaluate(
        async ({ key, prev, p }) => {
          const { api } = window as unknown as { api: SettingsApi }
          await api.settings.set(key, {
            ...(prev ?? {}),
            proxy: { mode: 'custom', host: '127.0.0.1', port: p, proxyType: 'socks' },
          })
        },
        { key: projectKey, prev: saved, p: proxy.port },
      )
      // The pane shows it as unsupported and keeps it through its own Save.
      await window.getByTestId('nav-settings').click()
      const modal = window.getByTestId('project-detail-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await modal.getByTestId('project-detail-tab-proxy').click()
      await expect(modal.getByTestId('project-proxy-type')).toHaveValue('socks')
      await modal.getByRole('button', { name: /^(Save changes|Değişiklikleri kaydet)$/i }).click()
      await expect(modal).toBeHidden({ timeout: 8_000 })
      const stored = (await readSetting(window, projectKey)) as { proxy?: { proxyType?: string } }
      expect(stored?.proxy?.proxyType).toBe('socks')

      await openCollectionRunner(window)
      await selectOnlyRunnerEndpoints(window, stamp)
      await startRunnerTabRun(window)
      await waitRunnerTabComplete(window)
      const wb = window.getByTestId('workbench')
      // The row's error shows in the detail pane (Response tab) once the row is picked.
      await wb.getByTestId('runner-results-list').getByText(`Socks run ${stamp}`).first().click()
      await expect(wb).toContainText(/SOCKS proxies are not supported/i)
      expect(await readRunnerTabSummary(window)).toEqual({ passed: 0, failed: 1 })
      expect(direct).toEqual([])
      expect(proxy.seen).toEqual([])
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()))
    }
  })

  uiTest('Send: credentials typed and cleared do not break the request', async ({ window }) => {
    const stamp = uid()
    await saveProjectProxy(window, { port: proxy.port, typeThenClearLogin: true })

    // The pane saved no empty login.
    const stored = (await readSetting(window, projectKey)) as { proxy?: Record<string, unknown> }
    expect(stored?.proxy).toMatchObject({ mode: 'custom', host: '127.0.0.1', port: proxy.port })
    expect(stored?.proxy).not.toHaveProperty('auth')

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?e2e69=send-${stamp}`)
    await sendAndWaitResponse(window)
    await expect(window.getByTestId('response-error')).toBeHidden()

    const hits = proxy.seen.filter((s) => s.url.includes(`send-${stamp}`))
    expect(hits).toHaveLength(1)
    expect(hits[0].auth).toBeUndefined()
  })
})
