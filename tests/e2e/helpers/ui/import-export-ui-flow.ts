import path from 'node:path'
import type { ElectronApplication } from '@playwright/test'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')

/**
 * Make the native open-file dialog return an import fixture, so the real
 * `import:openFile` IPC (and the ImportModal that calls it) runs end to end.
 *
 * The dialog is patched in the MAIN process: a renderer-side stub of
 * `window.api.importExport.openFile` is a no-op in the production build
 * (contextBridge objects are frozen), so the click would hit the real OS
 * dialog. Returns a restore function — call it in `finally`.
 */
export async function stubImportOpenFile(
  app: ElectronApplication,
  fixtureFile: string,
): Promise<() => Promise<void>> {
  const filePath = path.join(FIXTURES, fixtureFile)
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__origImportStub) d.__origImportStub = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__origImportStub) {
        d.showOpenDialog = d.__origImportStub
        delete d.__origImportStub
      }
    })
  }
}
