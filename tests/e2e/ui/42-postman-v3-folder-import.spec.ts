/**
 * Issue #276 part 2 — a Postman v3 collection folder through the Import UI:
 * Postman card → "Import folder…" → the folder summary → destination folder
 * → Import. The requests land in the tree with their kinds and order, the
 * saved example comes along, and the HTTP request is sendable.
 *
 * The folder is CONSTRUCTED here, in a temp dir (nothing third-party): a
 * collection definition, an HTTP request with an example under
 * `.resources/<request>.resources/examples`, and a sub-folder holding a
 * WebSocket and a GraphQL request whose `order` fields reverse their names.
 *
 * The folder is picked through the REAL `import:pickPostmanFolder` IPC: the
 * main process's `dialog.showOpenDialog` is patched to return the temp path.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import {
  finishImportWizard,
  openImportDropdown,
  refreshWorkspaceTree,
} from '../helpers/ui/import-flow'
import { getActiveProjectId, listEndpointsByProject } from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeOpenNode, treeSearch } from '../helpers/ui/tree'
import { sendAndReadBody } from '../helpers/ui/http-extra'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}`.slice(-7) + Math.random().toString(36).slice(2, 5)

/** Make the next open dialog return `dir`; returns the restore function. */
async function pickDirWithDialog(
  app: ElectronApplication,
  dir: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig276v3) d.__orig276v3 = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, dir)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig276v3) {
        d.showOpenDialog = d.__orig276v3
        delete d.__orig276v3
      }
    })
  }
}

function write(root: string, rel: string, text: string): void {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}

/** A constructed v3 collection folder; returns its path. */
function constructCollection(name: string, pingName: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-276v3-'))
  const root = path.join(parent, name)
  write(root, '.resources/definition.yaml', `$kind: collection\nname: ${name}\n`)
  write(
    root,
    `${pingName}.request.yaml`,
    [
      '$kind: http-request',
      `url: '${localHttpBin()}/get?src=v3'`,
      'method: GET',
      'queryParams:',
      '  - key: src',
      '    value: v3',
      'headers:',
      '  X-From: postman-v3',
      `examples: .resources/${pingName}.resources/examples`,
      'order: 1000',
      '',
    ].join('\n'),
  )
  write(
    root,
    `.resources/${pingName}.resources/examples/OK.example.yaml`,
    [
      '$kind: http-example',
      'name: OK',
      'response:',
      '  statusCode: 200',
      '  statusText: OK',
      '  body:',
      '    type: json',
      `    content: '{"ok":true}'`,
      'order: 1000',
      '',
    ].join('\n'),
  )
  write(root, 'Live/.resources/definition.yaml', '$kind: collection\norder: 2000\n')
  // `order` puts "Zeta socket" before "Alpha graph".
  write(
    root,
    'Live/Zeta socket.request.yaml',
    "$kind: websocket-request\nurl: 'wss://ws.example.test/feed'\norder: 1000\n",
  )
  write(
    root,
    'Live/Alpha graph.request.yaml',
    "$kind: graphql-request\nurl: 'https://gql.example.test/graphql'\nquery: '{ ping }'\norder: 2000\n",
  )
  return root
}

uiTest.describe('Issue #276 — Postman v3 folder through the Import UI', () => {
  const createdFolders: string[] = []
  const tmpDirs: string[] = []

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
        async ({ pid, names }) => {
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
          const res = await api.folder.list(pid)
          for (const f of res.data ?? []) if (names.includes(f.name)) await api.folder.delete(f.id)
        },
        { pid: projectId, names: createdFolders },
      )
    }
    for (const d of tmpDirs) fs.rmSync(path.dirname(d), { recursive: true, force: true })
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
  })

  uiTest(
    'Import folder… → summary → Import: kinds, order and the example land; HTTP sends',
    async ({ app, window }) => {
      const id = uid()
      const collection = `V3 Collection ${id}`
      const pingName = `v3ping${id}`
      const folderName = `PM v3 ${id}`
      const dir = constructCollection(collection, pingName)
      tmpDirs.push(dir)
      createdFolders.push(folderName)
      const projectId = await getActiveProjectId(window)

      const restore = await pickDirWithDialog(app, dir)
      try {
        await openImportDropdown(window, /Postman/i)
        const modal = window.getByTestId('import-modal')
        await modal.getByTestId('import-postman-folder').click()
        const summary = modal.getByTestId('import-postman-folder-summary')
        await expect(summary).toBeVisible({ timeout: 15_000 })
        await expect(summary).toContainText(collection)
        await expect(summary).toContainText('3')
        await modal.getByPlaceholder('Folder name').fill(folderName)
        await modal.getByRole('button', { name: /^Import$/i }).click()
        await finishImportWizard(window)
      } finally {
        await restore()
      }

      type Row = {
        id: string
        name: string
        protocol: string
        folder_id: string | null
        sort_order: number
      }
      const rows = (await listEndpointsByProject(window, projectId)) as Row[]
      const ping = rows.find((r) => r.name === pingName)
      const zeta = rows.find(
        (r) => r.name === 'Zeta socket' && r.folder_id && r.folder_id !== ping?.folder_id,
      )
      expect(ping?.protocol).toBe('http')
      expect(zeta?.protocol).toBe('websocket')
      const alpha = rows.find((r) => r.name === 'Alpha graph' && r.folder_id === zeta?.folder_id)
      expect(alpha?.protocol).toBe('graphql')
      // `order`, not the name, decides the order inside "Live".
      expect(zeta!.sort_order).toBeLessThan(alpha!.sort_order)

      // The saved example came along (owner = the HTTP endpoint).
      const examples = await window.evaluate(async (pid) => {
        const api = (
          window as unknown as {
            api: {
              savedResponse: {
                listByProject: (
                  p: string,
                ) => Promise<{ data?: Array<{ owner_id: string; name: string }> }>
              }
            }
          }
        ).api
        return (await api.savedResponse.listByProject(pid)).data ?? []
      }, projectId)
      expect(examples.filter((e) => e.owner_id === ping!.id).map((e) => e.name)).toEqual(['OK'])

      // In the tree, and the HTTP request is sendable with its query + header.
      await refreshWorkspaceTree(window)
      await treeSearch(window, folderName)
      await expect(
        window.getByTestId('tree-node').filter({ hasText: folderName }).first(),
      ).toBeVisible({
        timeout: 15_000,
      })
      await treeOpenNode(window, pingName)
      await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
      const { status } = await sendAndReadBody(window)
      expect(status).toBe(200)
      await expect(window.getByTestId('res-body-content')).toContainText('"src": "v3"', {
        timeout: 15_000,
      })
      await treeClearSearch(window)
    },
  )

  uiTest(
    'a folder that is not a Postman v3 folder is refused in the modal',
    async ({ app, window }) => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-276v3-empty-'))
      const inner = path.join(empty, 'nothing-here')
      fs.mkdirSync(inner)
      fs.writeFileSync(path.join(inner, 'readme.txt'), 'not postman')
      tmpDirs.push(inner)
      const restore = await pickDirWithDialog(app, inner)
      try {
        await openImportDropdown(window, /Postman/i)
        const modal = window.getByTestId('import-modal')
        await modal.getByTestId('import-postman-folder').click()
        // Main checked the folder before any destination step: the reason shows
        // in the modal and nothing moves on to the summary.
        await expect(modal.getByText(/is not a Postman v3 collection or workspace/)).toBeVisible({
          timeout: 15_000,
        })
        await expect(modal.getByTestId('import-postman-folder-summary')).toHaveCount(0)
        await window.keyboard.press('Escape')
      } finally {
        await restore()
      }
    },
  )
})
