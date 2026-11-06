/**
 * Issue #319: a mock server can start from a file, in the built app with the real
 * importer behind it. A spec is imported, and the mock answers its path; a file
 * that is not a spec, or one with nothing in it, leaves no server behind.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { randomMockPort } from '../helpers/ui/mock-flow'

const FIXTURE = join(process.cwd(), 'tests/fixtures/import-export/openapi-3.0.json')

type IpcResult<T> = { success: boolean; data?: T; error?: string }
type MockApi = {
  api: {
    mock: {
      server: {
        list: (p: string) => Promise<IpcResult<Array<{ id: string; name: string; port: number }>>>
        start: (id: string) => Promise<unknown>
        stop: (id: string) => Promise<unknown>
        delete: (id: string) => Promise<unknown>
      }
      endpoint: { list: (s: string) => Promise<IpcResult<Array<{ path: string; method: string }>>> }
    }
  }
}

const listServers = (page: Page, projectId: string) =>
  page.evaluate(async (pid) => {
    const w = window as unknown as MockApi
    return (await w.api.mock.server.list(pid)).data ?? []
  }, projectId)

const removeServers = (page: Page, projectId: string, port: number) =>
  page.evaluate(
    async ({ pid, p }) => {
      const w = window as unknown as MockApi
      for (const s of (await w.api.mock.server.list(pid)).data ?? []) {
        if (s.port !== p) continue
        await w.api.mock.server.stop(s.id).catch(() => {})
        await w.api.mock.server.delete(s.id)
      }
    },
    { pid: projectId, p: port },
  )

async function openImportOption(page: Page, port: number): Promise<void> {
  await navigateSidebar(page, 'mocks')
  await page.getByTestId('mock-new').click()
  await expect(page.getByTestId('mock-new-dialog')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('mock-new-type-http').click()
  await page.getByTestId('mock-new-preset-import').click()
  await page.getByTestId('mock-new-port').fill(String(port))
}

const pickFile = (page: Page, name: string, text: string): Promise<void> =>
  page.getByTestId('mock-new-import-input').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })

uiTest.describe('New mock server from a file (issue #319)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    await dismissOverlays(window)
  })

  uiTest('an OpenAPI file becomes a mock that answers its paths', async ({ window }) => {
    const port = randomMockPort()
    const projectId = await getActiveProjectId(window)
    try {
      await openImportOption(window, port)
      await pickFile(window, 'openapi-3.0.json', readFileSync(FIXTURE, 'utf8'))
      await expect(window.getByTestId('mock-new-import-summary')).toContainText('OpenAPI')
      await expect(window.getByTestId('mock-new-name')).toHaveValue(/^Petstore Lite/)
      await window.getByTestId('mock-new-create').click()
      await expect(window.getByTestId('mock-new-dialog')).toBeHidden({ timeout: 15_000 })

      // Its tab is open on the imported endpoints, with the bound path, not a URL.
      await expect(window.getByTestId('mock-add-endpoint')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('mock-endpoint-path')).toHaveValue(/^\/v1\/pets/)

      const server = (await listServers(window, projectId)).find((s) => s.port === port)
      expect(server?.name).toMatch(/^Petstore Lite/)
      await window.evaluate(async (id) => {
        await (window as unknown as MockApi).api.mock.server.start(id)
      }, server?.id ?? '')
      // The spec's server is https://petstore.example.com/v1: only the host changes.
      await expect
        .poll(async () => (await fetch(`http://127.0.0.1:${port}/v1/pets`)).status, {
          timeout: 10_000,
        })
        .toBe(200)
      expect((await fetch(`http://127.0.0.1:${port}/pets`)).status).toBe(404)
    } finally {
      await removeServers(window, projectId, port)
      await closeAllTabs(window)
    }
  })

  uiTest('a Postman v3 file imports, and what it lost is listed', async ({ window }) => {
    const port = randomMockPort()
    const projectId = await getActiveProjectId(window)
    const collection = {
      $kind: 'collection',
      name: 'Shop v3',
      items: [
        { $kind: 'http-request', name: 'Orders', method: 'GET', url: 'https://x.test/orders' },
        { $kind: 'websocket-request', name: 'Live feed', url: 'wss://x.test/feed' },
      ],
    }
    try {
      await openImportOption(window, port)
      await pickFile(window, 'shop.json', JSON.stringify(collection))
      await expect(window.getByTestId('mock-new-import-summary')).toContainText('Postman')
      await expect(window.getByTestId('mock-new-name')).toHaveValue('Shop v3')
      await window.getByTestId('mock-new-create').click()
      await expect(window.getByTestId('mock-new-dialog')).toBeHidden({ timeout: 15_000 })

      await expect(window.getByTestId('mock-endpoint-path')).toHaveValue('/orders')
      await expect(window.getByTestId('mock-import-warning')).toContainText('Live feed')
      await window.getByTestId('mock-import-toast-close').click()
      await expect(window.getByTestId('mock-import-toast')).toBeHidden()
    } finally {
      await removeServers(window, projectId, port)
      await closeAllTabs(window)
    }
  })

  uiTest(
    'a file the dialog accepts but the importer cannot use leaves no server, and a retry works',
    async ({ window }) => {
      // The two tests around this one stop at the dialog's own check, before any server is
      // made. This file passes that check (a path item with a $ref counts as one operation,
      // only main can follow it) and then fails in main, after the server exists. Only this
      // reaches the clean-up in createMockServerFromFile (F14).
      const port = randomMockPort()
      const projectId = await getActiveProjectId(window)
      const external = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'External only' },
        paths: { '/pets': { $ref: './pets-path.json' } },
      })
      try {
        await openImportOption(window, port)
        await window.getByTestId('mock-new-name').fill('Retry shop')
        await pickFile(window, 'external.json', external)
        await expect(window.getByTestId('mock-new-import-summary')).toContainText('OpenAPI')
        await expect(window.getByTestId('mock-new-import-error')).toBeHidden()

        await window.getByTestId('mock-new-create').click()
        await expect(window.getByTestId('mock-new-error')).toBeVisible({ timeout: 15_000 })
        await expect(window.getByTestId('mock-new-dialog')).toBeVisible()
        // Nothing is left holding the name and the port.
        await expect
          .poll(async () => (await listServers(window, projectId)).filter((s) => s.port === port))
          .toEqual([])
        expect((await listServers(window, projectId)).filter((s) => s.name === 'Retry shop')).toEqual([])

        // The same name and port, with a file that works.
        await pickFile(window, 'openapi-3.0.json', readFileSync(FIXTURE, 'utf8'))
        await expect(window.getByTestId('mock-new-name')).toHaveValue('Retry shop')
        await expect(window.getByTestId('mock-new-port')).toHaveValue(String(port))
        await window.getByTestId('mock-new-create').click()
        await expect(window.getByTestId('mock-new-dialog')).toBeHidden({ timeout: 15_000 })
        const made = (await listServers(window, projectId)).filter((s) => s.port === port)
        expect(made.map((s) => s.name)).toEqual(['Retry shop'])
      } finally {
        await removeServers(window, projectId, port)
        await closeAllTabs(window)
      }
    },
  )

  uiTest('a wrong or empty file leaves no server behind', async ({ window }) => {
    const port = randomMockPort()
    const projectId = await getActiveProjectId(window)
    try {
      await openImportOption(window, port)

      // Not a spec: told at once, Create says a file is still needed.
      await pickFile(window, 'notes.json', '{"a":1}')
      await expect(window.getByTestId('mock-new-import-error')).toBeVisible()
      await window.getByTestId('mock-new-create').click()
      await expect(window.getByTestId('mock-new-error')).toBeVisible()

      // A spec with no operations: same.
      await pickFile(window, 'empty.json', '{"openapi":"3.0.0","info":{},"paths":{}}')
      await expect(window.getByTestId('mock-new-import-error')).toBeVisible()
      await expect(window.getByTestId('mock-new-import-summary')).toBeHidden()

      expect((await listServers(window, projectId)).filter((s) => s.port === port)).toEqual([])
      await window.getByTestId('mock-new-cancel').click()
      await expect(window.getByTestId('mock-new-dialog')).toBeHidden()
    } finally {
      await removeServers(window, projectId, port)
    }
  })
})
