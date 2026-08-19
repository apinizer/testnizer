import { ipcMain, Menu, BrowserWindow, clipboard, type MenuItemConstructorOptions } from 'electron'
import { buildContextMenuTemplate, type ContextTarget } from '../lib/context-menu'

/**
 * Pop the native right-click menu (issue #113).
 *
 * The renderer decides WHERE the click landed — it is the only side that can
 * tell that a click on a `.view-line` div belongs to a Monaco editor whose
 * hidden textarea holds the caret. `webContents`' own `context-menu` event
 * reports `isEditable: false` there, which is exactly how Monaco's broken
 * built-in menu ended up being the only one users ever saw.
 *
 * `canPaste` is read from the real clipboard here rather than trusted from the
 * renderer, which cannot read it.
 */
export function registerContextMenuHandlers(): void {
  ipcMain.handle(
    'contextMenu:show',
    async (
      event,
      target: Omit<ContextTarget, 'canPaste'> = { editable: false, hasSelection: false },
    ) => {
      try {
        const template = buildContextMenuTemplate({
          editable: !!target?.editable,
          hasSelection: !!target?.hasSelection,
          canPaste: clipboard.readText().length > 0,
        })
        if (template.length === 0) return { success: true, data: { shown: false } }

        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
        Menu.buildFromTemplate(template as MenuItemConstructorOptions[]).popup({ window: win })
        return { success: true, data: { shown: true } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
}
