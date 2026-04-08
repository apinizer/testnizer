import { ipcMain } from 'electron'
import { executeHttpRequest, HttpRequestOptions } from '../protocols/http.engine'

export function registerRequestHandlers(): void {
  ipcMain.handle('request:send', async (_event, options: HttpRequestOptions) => {
    try {
      const result = await executeHttpRequest(options)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('request:cancel', async (_event, _requestId: string) => {
    try {
      // TODO: Implement request cancellation via AbortController
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
