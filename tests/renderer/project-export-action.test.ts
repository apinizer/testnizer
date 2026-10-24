/**
 * Issue #208 — one project-export action for every entry point.
 *
 * Before the fix every project-level Export wrote Testnizer JSON only; the
 * Postman / OpenAPI / Insomnia handlers existed in main but no renderer code
 * called them, and their `skipped` list (issue #197) was never shown.
 * `exportProjectAs` is the single action the tree root, File → Export,
 * Settings → Storage / Data and the Home card now share:
 *  - each format reaches its own IPC (Testnizer → save.exportProject, others →
 *    importExport.export* + saveFile with a format-specific file name);
 *  - items the format cannot hold become a warning toast, after the file is
 *    written;
 *  - both cancel shapes are silent: `{ success:false, error:'Cancelled' }`
 *    from save.exportProject and `{ success:true, data:null }` from saveFile.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

import { mockWindowApi } from './screens/_mount'
import {
  exportProjectAs,
  projectExportFileName,
  PROJECT_EXPORT_FORMATS,
} from '../../src/renderer/lib/project-export'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { ExportSkippedItem } from '../../src/shared/collection-export'
import type { Project } from '../../src/renderer/types'

const PID = 'proj-208'
const MCP_SKIPPED: ExportSkippedItem = {
  name: 'Ping MCP',
  protocol: 'mcp',
  reason: 'unsupported-protocol',
}

let exportProject: ReturnType<typeof vi.fn>
let exportPostman: ReturnType<typeof vi.fn>
let exportOpenApi: ReturnType<typeof vi.fn>
let exportInsomnia: ReturnType<typeof vi.fn>
let exportPostmanV3Json: ReturnType<typeof vi.fn>
let exportPostmanV3Folder: ReturnType<typeof vi.fn>
let saveFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  setLocale('en')
  for (const fn of Object.values(toastMock)) fn.mockReset()
  exportProject = vi.fn(async () => ({
    success: true,
    data: { path: '/tmp/My API-2026-10-16.json' },
  }))
  exportPostman = vi.fn(async () => ({ success: true, data: '{"info":{}}', skipped: [] }))
  exportOpenApi = vi.fn(async () => ({ success: true, data: '{"openapi":"3.0.3"}', skipped: [] }))
  exportInsomnia = vi.fn(async () => ({ success: true, data: '{"resources":[]}', skipped: [] }))
  exportPostmanV3Json = vi.fn(async () => ({
    success: true,
    data: '{"$kind":"collection"}',
    skipped: [],
    notes: [],
  }))
  exportPostmanV3Folder = vi.fn(async () => ({
    success: true,
    data: '/tmp/out/My API',
    skipped: [],
    notes: [],
  }))
  saveFile = vi.fn(async (_content: string, name: string) => ({
    success: true,
    data: `/tmp/${name}`,
  }))
  mockWindowApi({
    save: { exportProject },
    importExport: {
      exportPostman,
      exportOpenApi,
      exportInsomnia,
      exportPostmanV3Json,
      exportPostmanV3Folder,
      saveFile,
    },
  })
  useWorkspaceStore.setState({
    projects: [{ id: PID, name: 'my-api', display_name: 'My API' } as Project],
  })
})

describe('exportProjectAs — each format reaches its own IPC (issue #208)', () => {
  it('lists the six formats in picker order (Postman v3 folder + JSON since issue #277)', () => {
    expect(PROJECT_EXPORT_FORMATS.map((f) => f.id)).toEqual([
      'testnizer',
      'postman',
      'postman-v3-folder',
      'postman-v3',
      'openapi',
      'insomnia',
    ])
  })

  it('testnizer → save.exportProject (main opens the dialog), success toast names the file', async () => {
    await expect(exportProjectAs(PID, 'testnizer')).resolves.toBe(true)
    expect(exportProject).toHaveBeenCalledWith(PID)
    expect(exportPostman).not.toHaveBeenCalled()
    expect(saveFile).not.toHaveBeenCalled()
    // Issue #208 follow-up: the title carries only the file name; the full
    // path is a one-line (truncated) description, so the toast never wraps
    // over the Settings modal's footer.
    expect(toastMock.success).toHaveBeenCalledWith(
      'Exported My API-2026-10-16.json',
      expect.objectContaining({ description: '/tmp/My API-2026-10-16.json' }),
    )
  })

  it.each([
    ['postman', () => exportPostman, '{"info":{}}', 'My API.postman_collection.json'],
    ['openapi', () => exportOpenApi, '{"openapi":"3.0.3"}', 'My API.openapi.json'],
    ['insomnia', () => exportInsomnia, '{"resources":[]}', 'My API.insomnia.json'],
    [
      'postman-v3',
      () => exportPostmanV3Json,
      '{"$kind":"collection"}',
      'My API.postman_collection.v3.json',
    ],
  ] as const)(
    '%s → its export IPC, then saveFile with a format-specific name',
    async (format, exporter, content, fileName) => {
      await expect(exportProjectAs(PID, format)).resolves.toBe(true)
      expect(exporter()).toHaveBeenCalledWith(PID)
      expect(saveFile).toHaveBeenCalledWith(content, fileName)
      expect(exportProject).not.toHaveBeenCalled()
      expect(toastMock.success).toHaveBeenCalledWith(
        `Exported ${fileName}`,
        expect.objectContaining({ description: `/tmp/${fileName}` }),
      )
      expect(toastMock.warning).not.toHaveBeenCalled()
    },
  )

  it('a Windows path also shows only the file name in the title', async () => {
    exportProject.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:\\Users\\me\\Documents\\billing.json' },
    })
    await exportProjectAs(PID, 'testnizer')
    expect(toastMock.success).toHaveBeenCalledWith(
      'Exported billing.json',
      expect.objectContaining({ description: 'C:\\Users\\me\\Documents\\billing.json' }),
    )
  })

  it('uses the caller-supplied project name over the store', async () => {
    await exportProjectAs(PID, 'postman', 'Billing / v2')
    expect(saveFile).toHaveBeenCalledWith('{"info":{}}', 'Billing - v2.postman_collection.json')
  })
})

describe('exportProjectAs — skipped items and cancel (issue #208)', () => {
  it('names items the format left out in a warning toast after the file is written', async () => {
    exportPostman.mockResolvedValueOnce({ success: true, data: '{}', skipped: [MCP_SKIPPED] })
    await exportProjectAs(PID, 'postman')
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    const msg = String(toastMock.warning.mock.calls[0]?.[0])
    expect(msg).toContain('Ping MCP (MCP)')
    expect(msg).toContain('Postman v2.1')
  })

  it('a dismissed save dialog on a collection format is silent — no success, no warning', async () => {
    exportInsomnia.mockResolvedValueOnce({ success: true, data: '{}', skipped: [MCP_SKIPPED] })
    saveFile.mockResolvedValueOnce({ success: true, data: null })
    await expect(exportProjectAs(PID, 'insomnia')).resolves.toBe(false)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.warning).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it("'Cancelled' from the Testnizer JSON export is silent", async () => {
    exportProject.mockResolvedValueOnce({ success: false, error: 'Cancelled' })
    await expect(exportProjectAs(PID, 'testnizer')).resolves.toBe(false)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('a failed build is reported and nothing is saved', async () => {
    exportOpenApi.mockResolvedValueOnce({ success: false, error: 'boom' })
    await expect(exportProjectAs(PID, 'openapi')).resolves.toBe(false)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('Export failed: boom')
  })
})

describe('projectExportFileName', () => {
  it('replaces characters a file system rejects and falls back to "project"', () => {
    expect(projectExportFileName('a:b*c?', 'postman')).toBe('a-b-c-.postman_collection.json')
    expect(projectExportFileName('   ', 'openapi')).toBe('project.openapi.json')
    expect(projectExportFileName(undefined, 'insomnia')).toBe('project.insomnia.json')
  })
})

describe('exportProjectAs — Postman v3 folder (issue #277)', () => {
  it('main picks the folder and writes it; the toast names the created folder', async () => {
    await expect(exportProjectAs(PID, 'postman-v3-folder')).resolves.toBe(true)
    expect(exportPostmanV3Folder).toHaveBeenCalledWith(PID)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toastMock.success).toHaveBeenCalledWith(
      'Exported My API',
      expect.objectContaining({ description: '/tmp/out/My API' }),
    )
    expect(toastMock.warning).not.toHaveBeenCalled()
  })

  it('a dismissed folder dialog is silent', async () => {
    exportPostmanV3Folder.mockResolvedValueOnce({ success: true, data: null })
    await expect(exportProjectAs(PID, 'postman-v3-folder')).resolves.toBe(false)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('what v3 could not carry becomes one warning toast', async () => {
    exportPostmanV3Folder.mockResolvedValueOnce({
      success: true,
      data: '/tmp/out/My API',
      skipped: [],
      notes: ['"Slow": the 5000 ms timeout has no Postman v3 field.'],
    })
    await exportProjectAs(PID, 'postman-v3-folder')
    expect(toastMock.warning).toHaveBeenCalledWith(
      '1 detail(s) could not be carried into Postman v3',
      expect.objectContaining({ description: expect.stringContaining('timeout') }),
    )
  })

  it('a failure is reported', async () => {
    exportPostmanV3Folder.mockResolvedValueOnce({ success: false, error: 'EACCES' })
    await expect(exportProjectAs(PID, 'postman-v3-folder')).resolves.toBe(false)
    expect(toastMock.error).toHaveBeenCalled()
  })
})
