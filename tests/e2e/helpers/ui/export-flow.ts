import type { Page } from '@playwright/test'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function exportPostmanIpc(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { importExport?: { exportPostman: (id: string) => Promise<IpcResult<string>> } }
    }
    const res = await w.api?.importExport?.exportPostman(pid)
    if (!res?.success || !res.data) throw new Error(res?.error ?? 'export postman failed')
    return res.data
  }, projectId)
}

export async function exportInsomniaIpc(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { importExport?: { exportInsomnia: (id: string) => Promise<IpcResult<string>> } }
    }
    const res = await w.api?.importExport?.exportInsomnia(pid)
    if (!res?.success || !res.data) throw new Error(res?.error ?? 'export insomnia failed')
    return res.data
  }, projectId)
}

export async function exportOpenApiIpc(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { importExport?: { exportOpenApi: (id: string) => Promise<IpcResult<string>> } }
    }
    const res = await w.api?.importExport?.exportOpenApi(pid)
    if (!res?.success || res.data == null) throw new Error(res?.error ?? 'export openapi failed')
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }, projectId)
}

export async function exportCurlIpc(
  page: Page,
  request: { method: string; url: string; headers?: { key: string; value: string; enabled: boolean }[] },
): Promise<string> {
  return page.evaluate(async (req) => {
    const w = window as Window & {
      api?: { importExport?: { exportCurl: (r: unknown) => Promise<IpcResult<string>> } }
    }
    const res = await w.api?.importExport?.exportCurl(req)
    if (!res?.success || !res.data) throw new Error(res?.error ?? 'export curl failed')
    return res.data
  }, request)
}

export async function importProjectFromContent(
  page: Page,
  workspaceId: string,
  content: string,
  name?: string,
): Promise<string> {
  return page.evaluate(
    async ({ wid, json, n }) => {
      const w = window as Window & {
        api?: {
          save?: {
            importProjectFromContent: (p: unknown) => Promise<IpcResult<{ projectId: string }>>
          }
        }
      }
      const res = await w.api?.save?.importProjectFromContent({ workspaceId: wid, content: json, name: n })
      if (!res?.success || !res.data?.projectId) throw new Error(res?.error ?? 'import project failed')
      return res.data.projectId
    },
    { wid: workspaceId, json: content, n: name },
  )
}

export async function importLocalProjectFile(
  page: Page,
  filePath: string,
  projectId: string,
): Promise<IpcResult<unknown>> {
  return page.evaluate(
    async ({ fp, pid }) => {
      const w = window as Window & {
        api?: { save?: { importLocal: (p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return (await w.api?.save?.importLocal({ filePath: fp, projectId: pid })) as IpcResult<unknown>
    },
    { fp: filePath, pid: projectId },
  )
}
