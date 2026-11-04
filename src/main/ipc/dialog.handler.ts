import { ipcMain, dialog, BrowserWindow } from 'electron'
import { assertNotFolder, openFileDialogOptions } from '../lib/open-dialog'
import { allowPickedBodyFiles } from '../lib/working-directory'
import { statSync } from 'fs'
import { basename } from 'path'

interface OpenFileOptions {
  title?: string
  filters?: Array<{ name: string; extensions: string[] }>
  multiSelections?: boolean
  /**
   * The picker is choosing a request body file for this project. Picking one
   * outside its working directory is consent to read such files. Other pickers
   * (TLS tool) leave it out, and so does a request with no project.
   */
  requestBodyProjectId?: string
}

interface OpenFileResult {
  filePath: string
  fileName: string
  size: number
}

export function registerDialogHandlers(): void {
  /**
   * Show a native open-file dialog and return the chosen file path(s) along
   * with derived metadata (basename, byte size). Used by the renderer for
   * multipart/form-data file fields, attachment pickers, etc.
   *
   * Returns `{ success: false, error: 'Cancelled' }` when the user cancels.
   */
  ipcMain.handle('dialog:openFile', async (_event, options: OpenFileOptions = {}) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(
        win!,
        openFileDialogOptions({
          properties: options.multiSelections ? ['openFile', 'multiSelections'] : ['openFile'],
          title: options.title ?? 'Select File',
          filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }],
        }),
      )

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      for (const fp of result.filePaths) assertNotFolder(fp)
      if (options.requestBodyProjectId) {
        // The pick still counts if this fails: Send then says what to turn on.
        await allowPickedBodyFiles(options.requestBodyProjectId, result.filePaths).catch((e) =>
          console.warn('[dialog] could not save the file read setting:', (e as Error).message),
        )
      }
      const files: OpenFileResult[] = result.filePaths.map((fp) => {
        let size = 0
        try {
          size = statSync(fp).size
        } catch {
          /* size unavailable */
        }
        return { filePath: fp, fileName: basename(fp), size }
      })

      // For single-selection mode return a single object for ergonomic usage.
      if (!options.multiSelections) {
        return { success: true, data: files[0] }
      }
      return { success: true, data: files }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
