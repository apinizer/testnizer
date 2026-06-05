import type { Page } from '@playwright/test'
import { sendRequest, parseJsonBody, type ApiResponse } from '../api'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getActiveProjectId(page: Page, projectName = 'E2E Test Project'): Promise<string> {
  return page.evaluate(async (name) => {
    const w = window as Window & {
      api?: {
        workspace?: { list: () => Promise<IpcResult<Array<{ id: string }>>> }
        project?: { list: (wsId: string) => Promise<IpcResult<Array<{ id: string; name: string }>>> }
      }
    }
    const wsRes = await w.api?.workspace?.list()
    const wsId = wsRes?.data?.[0]?.id
    if (!wsId) throw new Error('no workspace')
    const projRes = await w.api?.project?.list(wsId)
    const slug = name.replace(/\s+/g, '-').toLowerCase()
    const projects = projRes?.data ?? []
    const project =
      projects.find((p) => p.name === name || p.name === slug) ??
      (projects[0] as { id: string } | undefined)
    if (!project?.id) throw new Error(`project ${name} not found`)
    return project.id
  }, projectName)
}

export async function listEnvironmentsByProject(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & { api?: { environment?: { listByProject: (id: string) => Promise<IpcResult<unknown[]>> } } }
    const res = await w.api?.environment?.listByProject(pid)
    if (!res?.success) throw new Error(res?.error ?? 'list environments failed')
    return res.data ?? []
  }, projectId)
}

export async function listEndpointsByProject(page: Page, projectId: string) {
  return listSavedRequestsByProject(page, projectId)
}

export async function listSavedRequestsByProject(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { savedRequest?: { list: (id: string, branchId?: string | null) => Promise<IpcResult<unknown[]>> } }
    }
    const res = await w.api?.savedRequest?.list(pid)
    if (!res?.success) throw new Error(res?.error ?? 'list saved requests failed')
    return res.data ?? []
  }, projectId)
}

export async function getEndpoint(page: Page, id: string) {
  return getSavedRequest(page, id)
}

export async function getSavedRequest(page: Page, id: string) {
  return page.evaluate(async (eid) => {
    const w = window as Window & { api?: { savedRequest?: { get: (id: string) => Promise<IpcResult<unknown>> } } }
    const res = await w.api?.savedRequest?.get(eid)
    if (!res?.success) throw new Error(res?.error ?? 'get saved request failed')
    return res.data
  }, id)
}

/** Send HTTP via IPC with env resolution in renderer (same path as UI send). */
export async function sendViaIpc(
  page: Page,
  opts: { method: string; url: string; headers?: { key: string; value: string }[] },
): Promise<ApiResponse> {
  return sendRequest(page, {
    method: opts.method,
    url: opts.url,
    headers: opts.headers?.map((h, i) => ({ id: `h-${i}`, key: h.key, value: h.value, enabled: true })),
  })
}

export async function listTestSuitesByProject(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { testSuite?: { list: (id: string) => Promise<IpcResult<unknown[]>> } }
    }
    const res = await w.api?.testSuite?.list(pid)
    if (!res?.success) throw new Error(res?.error ?? 'list test suites failed')
    return res.data ?? []
  }, projectId)
}

export async function listSuiteItems(page: Page, suiteId: string) {
  return page.evaluate(async (sid) => {
    const w = window as Window & {
      api?: {
        testSuite?: {
          listEndpoints: (id: string) => Promise<
            IpcResult<{ items: Array<{ id: string; name: string; url: string | null; assertions: string | null }> }>
          >
        }
      }
    }
    const res = await w.api?.testSuite?.listEndpoints(sid)
    if (!res?.success || !res.data) throw new Error(res?.error ?? 'list suite items failed')
    return res.data.items ?? []
  }, suiteId)
}

export async function findSuiteIdByName(page: Page, projectId: string, name: string): Promise<string> {
  const suites = (await listTestSuitesByProject(page, projectId)) as Array<{ id: string; name: string }>
  const suite = suites.find((s) => s.name === name)
  if (!suite?.id) throw new Error(`suite not found: ${name}`)
  return suite.id
}

export function assertJsonField(res: ApiResponse, path: string, expected: unknown): void {
  const body = parseJsonBody(res) as Record<string, unknown>
  const parts = path.split('.')
  let cur: unknown = body
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') throw new Error(`path ${path} missing at ${p}`)
    cur = (cur as Record<string, unknown>)[p]
  }
  if (JSON.stringify(cur) !== JSON.stringify(expected)) {
    throw new Error(`expected ${path}=${JSON.stringify(expected)} got ${JSON.stringify(cur)}`)
  }
}
