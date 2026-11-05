/**
 * Files outside the working directory: an imported collection cannot upload a
 * file by absolute path until the user allows it for the project.
 *
 * Import through the real UI (the report names the path) → Send shows the
 * message and the server receives nothing → turn the setting on in Project
 * Settings → Send uploads the file. The server is this spec's own, so "received
 * nothing" is what the server saw.
 */
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import { openImportDropdown, refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeOpenNode } from '../helpers/ui/tree'

const CANARY = `CANARY-OUTSIDE-WD-${Date.now()}`
const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const REQUEST_NAME = `Steal key ${uid}`
const FOLDER_NAME = `Outside WD ${uid}`

/** Project settings as they are, written back at the end (one shared Electron). */
async function projectSettings(window: Page, pid: string): Promise<Record<string, unknown>> {
  return window.evaluate(async (id) => {
    const api = (
      window as unknown as {
        api: { settings: { get: (k: string) => Promise<{ data?: Record<string, unknown> }> } }
      }
    ).api
    return (await api.settings.get(`project.${id}.settings`)).data ?? {}
  }, pid)
}

async function writeProjectSettings(
  window: Page,
  pid: string,
  value: Record<string, unknown>,
): Promise<void> {
  await window.evaluate(
    async ({ id, v }) => {
      const api = (
        window as unknown as {
          api: { settings: { set: (k: string, val: unknown) => Promise<unknown> } }
        }
      ).api
      await api.settings.set(`project.${id}.settings`, v)
    },
    { id: pid, v: value },
  )
}

async function pickFileWithDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig63) d.__orig63 = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig63) {
        d.showOpenDialog = d.__orig63
        delete d.__orig63
      }
    })
  }
}

uiTest.describe('Files outside the working directory', () => {
  let server: http.Server
  let received = ''
  let canaryFile = ''
  let collectionFile = ''
  let projectId = ''
  let savedSettings: Record<string, unknown> = {}

  uiTest.beforeAll(async ({ window }) => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        req.on('data', (c) => (received += String(c)))
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        })
      })
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-63-'))
    canaryFile = path.join(dir, 'id_rsa')
    fs.writeFileSync(canaryFile, CANARY)
    collectionFile = path.join(dir, 'hostile.postman_collection.json')
    fs.writeFileSync(
      collectionFile,
      JSON.stringify({
        info: {
          name: 'Hostile',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: REQUEST_NAME,
            request: {
              method: 'POST',
              url: `${base}/upload`,
              body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: canaryFile }] },
            },
          },
        ],
      }),
    )
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    projectId = await getActiveProjectId(window)
    savedSettings = await projectSettings(window, projectId)
    // Another spec's real pick may have turned it on in this shared instance.
    await writeProjectSettings(window, projectId, {
      ...savedSettings,
      workingDirectory: '',
      readFilesOutsideWorkingDirectory: false,
    })
  })

  uiTest.afterAll(async ({ window }) => {
    await closeAllTabs(window).catch(() => {})
    await writeProjectSettings(window, projectId, savedSettings).catch(() => {})
    await window
      .evaluate(
        async ({ pid, folder }) => {
          const api = (
            window as unknown as {
              api: {
                folder: {
                  list: (p: string) => Promise<{ data?: Array<{ id: string; name: string }> }>
                  delete: (id: string) => Promise<unknown>
                }
              }
            }
          ).api
          for (const f of (await api.folder.list(pid)).data ?? []) {
            if (f.name === folder) await api.folder.delete(f.id)
          }
        },
        { pid: projectId, folder: FOLDER_NAME },
      )
      .catch(() => {})
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(path.dirname(canaryFile), { recursive: true, force: true })
  })

  uiTest(
    'the report names the path, Send is refused, the setting lets it through',
    async ({ app, window }) => {
      await navigateSidebar(window, 'apis')

      // ── Import: the report names the request and the path ──
      const restore = await pickFileWithDialog(app, collectionFile)
      try {
        await openImportDropdown(window, /Postman/i)
        const modal = window.getByTestId('import-modal')
        await modal.getByRole('button', { name: /Click to select a/i }).click()
        await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
        await modal.getByPlaceholder('Folder name').fill(FOLDER_NAME)
        await modal.getByRole('button', { name: /^Import$/i }).click()
        await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 30_000 })
        await window.getByTestId('import-warnings-toggle').click()
        const warnings = window.getByTestId('import-warnings-list')
        await expect(warnings).toContainText(REQUEST_NAME)
        await expect(warnings).toContainText(canaryFile)
        await window.getByTestId('import-result-done').click()
        await expect(modal).toBeHidden({ timeout: 10_000 })
      } finally {
        await restore()
      }

      // ── Send: refused with the message; the server saw nothing ──
      await refreshWorkspaceTree(window)
      await treeOpenNode(window, REQUEST_NAME)
      await window.getByTestId('send-btn').click()
      const errorPanel = window.getByTestId('response-error')
      await expect(errorPanel).toBeVisible({ timeout: 15_000 })
      await expect(errorPanel).toContainText('Read files outside the working directory')
      await expect(errorPanel).toContainText(canaryFile)
      expect(received).toBe('')

      // ── Project Settings: off by default here, turn it on ──
      await window.getByTestId('nav-settings').click()
      await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
      await window.getByTestId('project-detail-tab-general').click()
      const toggle = window.getByTestId('project-setting-read-files-outside')
      await expect(toggle).not.toBeChecked()
      await toggle.check()
      await window.getByRole('button', { name: /Save Changes|Değişiklikleri Kaydet/i }).click()
      await expect(window.getByTestId('project-detail-modal')).toBeHidden({ timeout: 8_000 })
      await expect
        .poll(
          async () => (await projectSettings(window, projectId)).readFilesOutsideWorkingDirectory,
        )
        .toBe(true)

      // ── Send: the file goes out ──
      await window.getByTestId('send-btn').click()
      // Same panel refused the Send above: its text says why, a status locator alone would not.
      await expect
        .poll(
          async () =>
            (await window.getByTestId('response-status').isVisible())
              ? await window.getByTestId('response-status').innerText()
              : ((await errorPanel.isVisible()) ? await errorPanel.innerText() : ''),
          { timeout: 15_000 },
        )
        .toContain('200')
      expect(received).toContain(CANARY)
      await treeClearSearch(window)
    },
  )
})
