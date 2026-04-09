import { ipcMain } from 'electron'
import { executeHttpRequest, HttpRequestOptions } from '../protocols/http.engine'
import * as historyRepo from '../db/history.repo'

export function registerRequestHandlers(): void {
  ipcMain.handle('request:send', async (_event, options: HttpRequestOptions & {
    _workspaceId?: string
    _projectId?: string
    _endpointId?: string
    _protocol?: string
  }) => {
    try {
      const result = await executeHttpRequest(options)

      // Auto-save to history
      try {
        historyRepo.addHistory({
          workspace_id: options._workspaceId,
          project_id: options._projectId,
          endpoint_id: options._endpointId,
          protocol: options._protocol || 'http',
          method: options.method,
          url: options.url,
          status_code: result.status,
          duration_ms: result.timing?.total ? Math.round(result.timing.total) : undefined,
          request_snapshot: JSON.stringify({
            method: options.method,
            url: options.url,
            params: options.params,
            headers: options.headers,
            body: options.body,
            auth: options.auth,
          }),
          response_snapshot: JSON.stringify({
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
            body: result.body && result.body.length <= 500_000 ? result.body : undefined,
            bodySize: result.bodySize,
            timing: result.timing,
            error: result.error,
          }),
        })
      } catch {
        // History save failure should not affect request result
      }

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
