/**
 * The canary scan on the production build: a proxy password and a connection init
 * token go through real connections, then every file under userData, both web
 * storages and the screen are searched. Only the proxy and the target may see them.
 * Files because a unit test only sees the sinks someone thought of.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { fillMonaco } from '../helpers/ui/monaco'
import { startConnectProxy } from '../../helpers/connect-proxy'

type Api = {
  settings: {
    get: (k: string) => Promise<{ data?: unknown }>
    set: (k: string, v: unknown) => Promise<unknown>
  }
  secureStorage: { status: () => Promise<{ data?: { encrypted: boolean } }> }
}

const api = (page: Page) => ({
  get: (k: string) =>
    page.evaluate(async (key) => (window as unknown as { api: Api }).api.settings.get(key), k),
  set: (k: string, v: unknown) =>
    page.evaluate(
      async ({ key, value }) => (window as unknown as { api: Api }).api.settings.set(key, value),
      { key: k, value: v },
    ),
  encrypted: () =>
    page.evaluate(async () => {
      const res = await (window as unknown as { api: Api }).api.secureStorage.status()
      return res.data?.encrypted === true
    }),
})

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? filesUnder(full) : [full]
  })
}

uiTest.describe('Credentials of the proxy and of connection init', () => {
  uiTest('reach no file, storage or screen', async ({ window, app }) => {
    const PASSWORD = `CANARY-proxy-${randomUUID()}`
    const TOKEN = `CANARY-init-${randomUUID()}`
    const BASIC = Buffer.from(`e2e-user:${PASSWORD}`).toString('base64')
    const canaries = [PASSWORD, TOKEN, BASIC]

    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)

    const { ws, graphql } = getTestServerUrls()
    const settings = api(window)
    const proxy = await startConnectProxy()
    const saved = (await settings.get('proxy')).data
    try {
      await settings.set('proxy', proxy.setting({ username: 'e2e-user', password: PASSWORD }))

      await openNewDropdownItem(window, /WebSocket/i)
      await window.getByTestId('ws-url').fill(ws)
      await window.getByTestId('ws-connect').click()
      await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
      expect(proxy.connects.at(-1)?.authorization).toBe(`Basic ${BASIC}`)
      await window.getByTestId('ws-disconnect').click()

      await openNewDropdownItem(window, /GraphQL/i)
      await window.getByTestId('graphql-url').fill(graphql)
      await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')
      await window.getByTestId('graphql-connection-init-toggle').click()
      await fillMonaco(
        window,
        'graphql-connection-init-editor',
        JSON.stringify({ authorization: TOKEN }),
      )
      await window.getByTestId('graphql-subscribe').click()
      await expect(window.getByTestId('graphql-subscription-event').first()).toBeVisible({
        timeout: 15_000,
      })
      await window.getByTestId('graphql-unsubscribe').click()

      // A proxy that refuses: the failure text is a sink too.
      proxy.answer = '407'
      await openNewDropdownItem(window, /WebSocket/i)
      await window.getByTestId('ws-url').fill(ws)
      await window.getByTestId('ws-connect').click()
      await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 15_000 })

      // Past the store's write debounce, so the web storages hold the draft.
      await window.waitForTimeout(1_500)

      const web = await window.evaluate(() => {
        const dump = (s: Storage) =>
          Object.keys(s)
            .map((k) => `${k}=${s.getItem(k) ?? ''}`)
            .join('\n')
        return `${dump(localStorage)}\n${dump(sessionStorage)}\n${document.body.innerText}`
      })
      for (const canary of canaries) expect(web).not.toContain(canary)

      const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      // With no OS keychain the app stores this one field as text and says so.
      const skip = (await settings.encrypted()) ? null : 'settings.json'
      const hits = filesUnder(userData).filter((file) => {
        if (skip && path.basename(file) === skip) return false
        let bytes: Buffer
        try {
          bytes = fs.readFileSync(file)
        } catch {
          return false // a file Chromium holds open or just removed
        }
        return canaries.some((canary) => bytes.includes(canary))
      })
      expect(hits).toEqual([])
    } finally {
      await closeAllTabs(window)
      await settings.set('proxy', saved ?? { mode: 'system' })
      await proxy.close()
    }
  })
})
