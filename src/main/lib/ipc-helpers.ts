/**
 * Tiny helpers that compress the IPC-handler boilerplate the codebase
 * grew over time. Every handler returns the same `{success, data?, error?}`
 * shape — without a helper, every handler hand-rolled the try/catch and
 * each one drifted slightly. These helpers are deliberately minimal so the
 * call sites stay readable.
 *
 * Usage pattern:
 *
 *   ipcMain.handle('foo:bar', async (_e, payload) => ipcResult(() => {
 *     return doTheWork(payload)
 *   }))
 *
 * Sync handlers can use `ipcResultSync`. Both honor a thrown Error and
 * return its `.message` as `error`.
 */
export interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export function ipcOk<T>(data?: T): IpcResult<T> {
  return { success: true, data }
}

export function ipcFail(error: unknown): IpcResult<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }
}

export async function ipcResult<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return ipcOk(await fn())
  } catch (e) {
    return ipcFail(e)
  }
}

export function ipcResultSync<T>(fn: () => T): IpcResult<T> {
  try {
    return ipcOk(fn())
  } catch (e) {
    return ipcFail(e)
  }
}
