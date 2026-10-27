/**
 * Issue #276 follow-up — a Postman .zip through the Import UI: Postman card →
 * "Click to select a Postman file" → the archive summary → destination
 * folder → Import → the report → the request sends.
 *
 * The zip is BUILT HERE with archiver (nothing third-party): a data-export
 * layout with two v2.1 collections under `collection/`, an environment under
 * `environment/` without the `_postman_variable_scope` key, and a
 * `readme.txt` that is not Postman (so the report lists it).
 *
 * The file is picked through the REAL `import:openFile` IPC: the main
 * process's `dialog.showOpenDialog` is patched to return the temp path; main
 * reads the zip in memory and hands the modal a one-time handle.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import archiver from 'archiver'
import { expect, type ElectronApplication } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import { openImportDropdown, refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { getActiveProjectId, listEndpointsByProject } from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeOpenNode, treeSearch } from '../helpers/ui/tree'
import { sendAndReadBody } from '../helpers/ui/http-extra'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}`.slice(-7) + Math.random().toString(36).slice(2, 5)

/** Make the next open dialog return `file`; returns the restore function. */
async function pickFileWithDialog(
  app: ElectronApplication,
  file: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig276zip) d.__orig276zip = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, file)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig276zip) {
        d.showOpenDialog = d.__orig276zip
        delete d.__orig276zip
      }
    })
  }
}

async function zipOf(files: Array<{ name: string; data: string }>): Promise<Buffer> {
  const zip = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  zip.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve())
    zip.on('error', reject)
  })
  for (const f of files) zip.append(f.data, { name: f.name })
  await zip.finalize()
  await done
  return Buffer.concat(chunks)
}

function collection(name: string, requestName: string, query: string): string {
  return JSON.stringify({
    info: {
      name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: requestName,
        request: {
          method: 'GET',
          header: [{ key: 'X-From', value: 'postman-zip' }],
          url: {
            raw: `${localHttpBin()}/get?src=${query}`,
            query: [{ key: 'src', value: query }],
          },
        },
      },
    ],
  })
}

uiTest.describe('Issue #276 — a Postman .zip through the Import UI', () => {
  const createdFolders: string[] = []
  const createdEnvs: string[] = []
  const tmpFiles: string[] = []

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest.afterAll(async ({ window }) => {
    await closeAllTabs(window).catch(() => {})
    const projectId = await getActiveProjectId(window).catch(() => '')
    if (projectId) {
      await window.evaluate(
        async ({ pid, folders, envs }) => {
          const api = (
            window as unknown as {
              api: {
                folder: {
                  list: (p: string) => Promise<{ data?: Array<{ id: string; name: string }> }>
                  delete: (id: string) => Promise<unknown>
                }
                environment: {
                  listByProject: (
                    p: string,
                  ) => Promise<{ data?: Array<{ id: string; name: string }> }>
                  delete: (id: string) => Promise<unknown>
                }
              }
            }
          ).api
          const fs = await api.folder.list(pid)
          for (const f of fs.data ?? []) if (folders.includes(f.name)) await api.folder.delete(f.id)
          const es = await api.environment.listByProject(pid)
          for (const e of es.data ?? [])
            if (envs.includes(e.name)) await api.environment.delete(e.id)
        },
        { pid: projectId, folders: createdFolders, envs: createdEnvs },
      )
    }
    for (const f of tmpFiles) fs.rmSync(f, { force: true })
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
  })

  uiTest(
    'select a .zip → archive summary → Import: report, both collections, environment; the request sends',
    async ({ app, window }) => {
      const id = uid()
      const folderName = `PM zip ${id}`
      const envName = `Zip env ${id}`
      const pingName = `zipping${id}`
      createdFolders.push(folderName)
      createdEnvs.push(envName)
      const file = path.join(os.tmpdir(), `testnizer-276zip-${id}.zip`)
      tmpFiles.push(file)
      fs.writeFileSync(
        file,
        await zipOf([
          { name: 'collection/1-shop.json', data: collection(`Shop ${id}`, pingName, 'zip') },
          { name: 'collection/2-status.json', data: collection(`Status ${id}`, 'Health', 'h') },
          {
            name: 'environment/e1.json',
            data: JSON.stringify({
              id: 'e1',
              name: envName,
              values: [{ key: 'echoHost', value: localHttpBin(), enabled: true }],
            }),
          },
          { name: 'readme.txt', data: 'not postman' },
        ]),
      )
      const projectId = await getActiveProjectId(window)

      const restore = await pickFileWithDialog(app, file)
      try {
        await openImportDropdown(window, /Postman/i)
        const modal = window.getByTestId('import-modal')
        await modal.getByRole('button', { name: /Click to select a/i }).click()
        const summary = modal.getByTestId('import-postman-folder-summary')
        await expect(summary).toBeVisible({ timeout: 15_000 })
        await expect(summary).toContainText('Ready to import archive:')
        await expect(summary).toContainText(path.basename(file))
        await expect(summary).toContainText('2 collection(s) · 2 request(s) · 1 environment(s)')
        await modal.getByPlaceholder('Folder name').fill(folderName)
        await modal.getByRole('button', { name: /^Import$/i }).click()

        // The report lists what the archive held and was not imported.
        await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 60_000 })
        await window.getByTestId('import-warnings-toggle').click()
        await expect(window.getByTestId('import-warnings-list')).toContainText(
          /Found in the archive and not imported: readme\.txt/,
        )
        await window.getByTestId('import-result-done').click()
        await expect(modal).toBeHidden({ timeout: 10_000 })
      } finally {
        await restore()
      }

      // Each collection in its own folder under the chosen one.
      type Row = { id: string; name: string; folder_id: string | null }
      const rows = (await listEndpointsByProject(window, projectId)) as Row[]
      const ping = rows.find((r) => r.name === pingName)
      const health = rows.find((r) => r.name === 'Health' && r.folder_id !== ping?.folder_id)
      expect(ping, 'request from the first collection').toBeTruthy()
      expect(health, 'request from the second collection').toBeTruthy()

      // The environment (no `_postman_variable_scope` key in the export) came along.
      const envNames = await window.evaluate(async (pid) => {
        const api = (
          window as unknown as {
            api: {
              environment: {
                listByProject: (p: string) => Promise<{ data?: Array<{ name: string }> }>
              }
            }
          }
        ).api
        return ((await api.environment.listByProject(pid)).data ?? []).map((e) => e.name)
      }, projectId)
      expect(envNames).toContain(envName)

      await refreshWorkspaceTree(window)
      await treeSearch(window, pingName)
      await treeOpenNode(window, pingName)
      await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
      const { status } = await sendAndReadBody(window)
      expect(status).toBe(200)
      await expect(window.getByTestId('res-body-content')).toContainText('"src": "zip"', {
        timeout: 15_000,
      })
      await treeClearSearch(window)
    },
  )

  uiTest('an unsafe .zip is refused in the modal with its reason', async ({ app, window }) => {
    // archiver strips "../", so this one is written by hand: one stored
    // entry named "../evil.json".
    const name = Buffer.from('../evil.json')
    const data = Buffer.from('{}')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(0xa3a6bf43, 14) // CRC-32 of "{}"
    local.writeUInt32LE(2, 18)
    local.writeUInt32LE(2, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(0xa3a6bf43, 16)
    central.writeUInt32LE(2, 20)
    central.writeUInt32LE(2, 24)
    central.writeUInt16LE(name.length, 28)
    const cdOffset = local.length + name.length + data.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 8)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(central.length + name.length, 12)
    eocd.writeUInt32LE(cdOffset, 16)
    const file = path.join(os.tmpdir(), `testnizer-276zip-evil-${uid()}.zip`)
    tmpFiles.push(file)
    fs.writeFileSync(file, Buffer.concat([local, name, data, central, name, eocd]))

    const restore = await pickFileWithDialog(app, file)
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByText(/climbs out of the archive/)).toBeVisible({ timeout: 15_000 })
      await expect(modal.getByTestId('import-postman-folder-summary')).toHaveCount(0)
      await window.keyboard.press('Escape')
    } finally {
      await restore()
    }
  })
})
