/**
 * MST-223 — Import file picker (dialog mock)
 * MST-224 — Export save dialog
 * MST-225 — Message dialog delete confirm
 * MST-226 — Certificate file picker
 *
 * Native Electron dialogs are mocked by patching `dialog` in the main process
 * via `app.evaluate()` so the test can exercise the full import/export IPC
 * flow without needing real file-picker interaction.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { bootstrapWorkbench } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

const FIXTURES = path.resolve(__dirname, '../../../fixtures')
const OPENAPI_FIXTURE = path.join(FIXTURES, 'import-export', 'openapi-3.0.json')
const CERT_PFX = path.join(FIXTURES, 'certs', 'client.p12')
const CERT_CRT = path.join(FIXTURES, 'certs', 'client.crt')

async function launchBootstrapped(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await bootstrapWorkbench(window)
  return { app, window }
}

/**
 * Patch dialog.showOpenDialog in the main process to return a fixed path.
 * Returns a cleanup function that restores the original.
 */
async function mockOpenDialog(
  app: ElectronApplication,
  filePaths: string[],
): Promise<() => Promise<void>> {
  await app.evaluate(
    ({ dialog }, paths) => {
      // Store original so we can restore
      ;(dialog as unknown as { __orig_showOpenDialog?: unknown }).__orig_showOpenDialog =
        dialog.showOpenDialog
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: paths })
    },
    filePaths,
  )
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as { __orig_showOpenDialog?: unknown }
      if (d.__orig_showOpenDialog) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showOpenDialog = d.__orig_showOpenDialog
        delete d.__orig_showOpenDialog
      }
    })
  }
}

/**
 * Patch dialog.showSaveDialog in the main process to return a fixed path.
 * Returns a cleanup function.
 */
async function mockSaveDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(
    ({ dialog }, fp) => {
      ;(dialog as unknown as { __orig_showSaveDialog?: unknown }).__orig_showSaveDialog =
        dialog.showSaveDialog
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: fp })
    },
    filePath,
  )
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as { __orig_showSaveDialog?: unknown }
      if (d.__orig_showSaveDialog) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showSaveDialog = d.__orig_showSaveDialog
        delete d.__orig_showSaveDialog
      }
    })
  }
}

test.describe('Tur1 — Shell native dialogs [MST-223..226]', () => {
  test('MST-223 import:openFile uses dialog.showOpenDialog and returns file content', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-import-e2e-'))
    let app: ElectronApplication | undefined
    let restoreDialog: (() => Promise<void>) | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock the open dialog to return the OpenAPI fixture
      restoreDialog = await mockOpenDialog(app, [OPENAPI_FIXTURE])

      // Invoke importExport.openFile via the preload bridge
      const result = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            importExport?: {
              openFile: () => Promise<{ success: boolean; data?: { filePath: string; content: string } | null }>
            }
          }
        }
        return w.api?.importExport?.openFile()
      })

      expect(result?.success).toBe(true)
      expect(result?.data).not.toBeNull()
      expect(result?.data?.filePath).toBe(OPENAPI_FIXTURE)
      expect(result?.data?.content).toBeTruthy()
      // Verify the content is valid JSON (OpenAPI fixture)
      const parsed = JSON.parse(result?.data?.content ?? '{}')
      expect(parsed).toBeDefined()
    } finally {
      if (restoreDialog) await restoreDialog().catch(() => {})
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-223 import:openFile returns null when dialog is cancelled', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-cancel-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock dialog to return canceled
      await app.evaluate(({ dialog }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showOpenDialog = async () => ({ canceled: true, filePaths: [] })
      })

      const result = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            importExport?: {
              openFile: () => Promise<{ success: boolean; data?: null }>
            }
          }
        }
        return w.api?.importExport?.openFile()
      })

      // Cancelled dialog returns success:true with data:null
      expect(result?.success).toBe(true)
      expect(result?.data).toBeNull()
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-224 export:saveFile uses dialog.showSaveDialog and writes file', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-export-e2e-'))
    let app: ElectronApplication | undefined
    let restoreDialog: (() => Promise<void>) | undefined
    const exportPath = path.join(os.tmpdir(), `testnizer-export-${Date.now()}.json`)

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock the save dialog to return our temp path
      restoreDialog = await mockSaveDialog(app, exportPath)

      const testContent = JSON.stringify({ test: true, ts: Date.now() })
      const result = await window.evaluate(
        async ({ content, name }) => {
          const w = window as unknown as Window & {
            api?: {
              importExport?: {
                saveFile: (content: string, defaultName: string) => Promise<{ success: boolean; data?: string | null }>
              }
            }
          }
          return w.api?.importExport?.saveFile(content, name)
        },
        { content: testContent, name: 'export.json' },
      )

      expect(result?.success).toBe(true)
      expect(result?.data).toBe(exportPath)

      // The file must exist and contain the content we passed
      expect(fs.existsSync(exportPath)).toBe(true)
      const written = fs.readFileSync(exportPath, 'utf-8')
      expect(written).toBe(testContent)
    } finally {
      if (restoreDialog) await restoreDialog().catch(() => {})
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
      if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath)
    }
  })

  test('MST-224 export:saveFile returns null when save dialog is cancelled', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-savecancl-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock dialog to return canceled
      await app.evaluate(({ dialog }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showSaveDialog = async () => ({ canceled: true, filePath: undefined })
      })

      const result = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            importExport?: {
              saveFile: (content: string, defaultName: string) => Promise<{ success: boolean; data?: null }>
            }
          }
        }
        return w.api?.importExport?.saveFile('{}', 'export.json')
      })

      expect(result?.success).toBe(true)
      expect(result?.data).toBeNull()
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-225 project delete confirm — project removed after confirm', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-del-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Create a project via IPC to delete
      const wsRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        return w.api?.workspace?.list()
      })
      const wsId = wsRes?.data?.[0]?.id
      expect(wsId).toBeTruthy()

      const uid = `${Date.now()}-del`
      const createRes = await window.evaluate(
        async ({ workspaceId, name }) => {
          const w = window as unknown as Window & {
            api?: {
              project?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
            }
          }
          // project:create → projectRepo.createProject expects snake_case
          // `workspace_id` (the column is NOT NULL); a camelCase `workspaceId`
          // sends undefined and the INSERT fails the constraint.
          return w.api?.project?.create({ workspace_id: workspaceId, name, type: 'http' })
        },
        { workspaceId: wsId, name: `DeleteMe ${uid}` },
      )
      expect(createRes?.success).toBe(true)
      const projectId = createRes?.data?.id
      expect(projectId).toBeTruthy()

      // Delete the project via IPC (bypasses native dialog — tests IPC contract)
      const deleteRes = await window.evaluate(
        async (pid) => {
          const w = window as unknown as Window & {
            api?: { project?: { delete: (id: string) => Promise<{ success: boolean }> } }
          }
          return w.api?.project?.delete(pid)
        },
        projectId as string,
      )
      expect(deleteRes?.success).toBe(true)

      // Verify project is gone
      const listAfter = await window.evaluate(
        async (wid) => {
          const w = window as unknown as Window & {
            api?: { project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
          }
          return w.api?.project?.list(wid)
        },
        wsId as string,
      )
      const ids = listAfter?.data?.map((p) => p.id) ?? []
      expect(ids).not.toContain(projectId)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-226 certificate:pickFile returns file path via mocked dialog', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-cert-e2e-'))
    let app: ElectronApplication | undefined
    let restoreDialog: (() => Promise<void>) | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock dialog for PFX file pick
      restoreDialog = await mockOpenDialog(app, [CERT_PFX])

      const pfxResult = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            certificate?: {
              pickFile: (kind: string) => Promise<{ success: boolean; data?: string; error?: string }>
            }
          }
        }
        return w.api?.certificate?.pickFile('pfx')
      })
      expect(pfxResult?.success).toBe(true)
      expect(pfxResult?.data).toBe(CERT_PFX)

      // Restore and mock for CRT pick
      await restoreDialog()
      restoreDialog = await mockOpenDialog(app, [CERT_CRT])

      const crtResult = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            certificate?: {
              pickFile: (kind: string) => Promise<{ success: boolean; data?: string; error?: string }>
            }
          }
        }
        return w.api?.certificate?.pickFile('crt')
      })
      expect(crtResult?.success).toBe(true)
      expect(crtResult?.data).toBe(CERT_CRT)
    } finally {
      if (restoreDialog) await restoreDialog().catch(() => {})
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-226 certificate:pickFile returns error when dialog is cancelled', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-certcncl-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Mock dialog to return canceled
      await app.evaluate(({ dialog }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showOpenDialog = async () => ({ canceled: true, filePaths: [] })
      })

      const result = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            certificate?: {
              pickFile: (kind: string) => Promise<{ success: boolean; data?: string; error?: string }>
            }
          }
        }
        return w.api?.certificate?.pickFile('key')
      })

      // Cancelled returns success:false with 'Cancelled' error
      expect(result?.success).toBe(false)
      expect(result?.error).toMatch(/cancel/i)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-223 full import flow: mock dialog → importOpenApi → tree populated', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-dlg-fullimport-e2e-'))
    let app: ElectronApplication | undefined
    let restoreDialog: (() => Promise<void>) | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Get workspace and create a project to import into
      const wsRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        return w.api?.workspace?.list()
      })
      const wsId = wsRes?.data?.[0]?.id

      const projRes = await window.evaluate(
        async (wid) => {
          const w = window as unknown as Window & {
            api?: { project?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> } }
          }
          // snake_case workspace_id required (NOT NULL column) — see MST-225.
          return w.api?.project?.create({ workspace_id: wid, name: `ImportTest ${Date.now()}`, type: 'http' })
        },
        wsId,
      )
      const projectId = projRes?.data?.id
      expect(projectId).toBeTruthy()
      if (!projectId) throw new Error('project create failed')

      // Ensure a default branch exists
      await window.evaluate(
        async (pid) => {
          const w = window as unknown as Window & {
            api?: { branch?: { ensureDefault: (id: string) => Promise<unknown> } }
          }
          return w.api?.branch?.ensureDefault(pid)
        },
        projectId,
      )

      // Mock the open dialog
      restoreDialog = await mockOpenDialog(app, [OPENAPI_FIXTURE])

      // Step 1: "open file" dialog → get content
      const fileResult = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            importExport?: {
              openFile: () => Promise<{ success: boolean; data?: { content: string } | null }>
            }
          }
        }
        return w.api?.importExport?.openFile()
      })
      expect(fileResult?.success).toBe(true)
      const content = fileResult?.data?.content
      expect(content).toBeTruthy()

      // Step 2: import the OpenAPI content
      const importRes = await window.evaluate(
        async ({ pid, cnt }) => {
          const w = window as unknown as Window & {
            api?: {
              importExport?: {
                importOpenApi: (p: unknown) => Promise<{ success: boolean; data?: { endpointCount?: number } }>
              }
            }
          }
          return w.api?.importExport?.importOpenApi({ projectId: pid, content: cnt, format: 'openapi3' })
        },
        { pid: projectId, cnt: content },
      )
      expect(importRes?.success).toBe(true)
      // The OpenAPI fixture should have at least one endpoint
      expect(importRes?.data?.endpointCount ?? 0).toBeGreaterThan(0)
    } finally {
      if (restoreDialog) await restoreDialog().catch(() => {})
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
