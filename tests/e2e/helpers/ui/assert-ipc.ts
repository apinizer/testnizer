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

export async function listEnvVariables(page: Page, environmentId: string) {
  return page.evaluate(async (eid) => {
    const w = window as Window & {
      api?: { envVariable?: { list: (id: string) => Promise<IpcResult<Array<{ key: string; value: string }>>> } }
    }
    const res = await w.api?.envVariable?.list(eid)
    if (!res?.success) throw new Error(res?.error ?? 'list env variables failed')
    return res.data ?? []
  }, environmentId)
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

/** Imported OpenAPI/Swagger rows live in `endpoints`; manual saves in `saved_requests`. */
export async function listEndpointsByProject(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: {
        endpoint?: { listByProject: (id: string) => Promise<IpcResult<unknown[]>> }
        savedRequest?: { list: (id: string, branchId?: string | null) => Promise<IpcResult<unknown[]>> }
      }
    }
    const [epRes, savedRes] = await Promise.all([
      w.api?.endpoint?.listByProject(pid),
      w.api?.savedRequest?.list(pid),
    ])
    if (!epRes?.success && !savedRes?.success) {
      throw new Error(epRes?.error ?? savedRes?.error ?? 'list endpoints failed')
    }
    return [...(epRes?.data ?? []), ...(savedRes?.data ?? [])]
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

export async function findSuiteIdByName(
  page: Page,
  projectId: string,
  name: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const suites = (await listTestSuitesByProject(page, projectId)) as Array<{ id: string; name: string }>
    const suite = suites.find((s) => s.name === name)
    if (suite?.id) return suite.id
    await page.waitForTimeout(250)
  }
  throw new Error(`suite not found: ${name}`)
}

/** Create an interval scheduled task via IPC and return its id. */
export async function createScheduledTask(
  page: Page,
  projectId: string,
  name: string,
): Promise<string> {
  return page.evaluate(
    async ({ pid, n }) => {
      const w = window as Window & {
        api?: {
          scheduler?: {
            create: (payload: unknown) => Promise<IpcResult<{ id: string }>>
          }
        }
      }
      const res = await w.api?.scheduler?.create({
        projectId: pid,
        name: n,
        endpointIds: [],
        intervalValue: 5,
        intervalUnit: 'minutes',
        scheduleType: 'interval',
      })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create scheduled task failed')
      return res.data.id
    },
    { pid: projectId, n: name },
  )
}

export async function listScheduledTasks(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { scheduler?: { list: (id: string) => Promise<IpcResult<Array<{ id: string; name: string }>>> } }
    }
    const res = await w.api?.scheduler?.list(pid)
    if (!res?.success) throw new Error(res?.error ?? 'list scheduled tasks failed')
    return res.data ?? []
  }, projectId)
}

/** Create a folder under the project root via IPC and return its id. */
export async function createFolder(page: Page, projectId: string, name: string): Promise<string> {
  return page.evaluate(
    async ({ pid, n }) => {
      const w = window as Window & {
        api?: { folder?: { create: (opts: { project_id: string; name: string }) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.folder?.create({ project_id: pid, name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create folder failed')
      return res.data.id
    },
    { pid: projectId, n: name },
  )
}

/** Move a saved request into a folder via IPC (mirrors tree drag-drop). */
export async function moveSavedRequest(
  page: Page,
  requestId: string,
  targetFolderId: string,
): Promise<void> {
  const res = await page.evaluate(
    async ({ id, folderId }) => {
      const w = window as Window & {
        api?: { tree?: { move: (p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.tree?.move({ nodeId: id, nodeType: 'request', targetFolderId: folderId })
    },
    { id: requestId, folderId: targetFolderId },
  )
  if (!res?.success) throw new Error(res?.error ?? 'tree move failed')
}

/** Create environment with a variable that has only initial_value (value empty). */
export async function createEnvInitialValueOnly(
  page: Page,
  projectId: string,
  envName: string,
  key: string,
  initialValue: string,
): Promise<string> {
  return page.evaluate(
    async ({ pid, name, k, iv }) => {
      const w = window as Window & {
        api?: {
          workspace?: { list: () => Promise<IpcResult<Array<{ id: string }>>> }
          environment?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> }
          envVariable?: { create: (p: unknown) => Promise<IpcResult<unknown>> }
        }
      }
      const wsRes = await w.api?.workspace?.list()
      const wsId = wsRes?.data?.[0]?.id
      if (!wsId) throw new Error('no workspace')
      const envRes = await w.api?.environment?.create({
        workspace_id: wsId,
        project_id: pid,
        name,
      })
      if (!envRes?.success || !envRes.data?.id) throw new Error(envRes?.error ?? 'env create failed')
      const eid = envRes.data.id
      const varRes = await w.api?.envVariable?.create({
        environment_id: eid,
        key: k,
        initial_value: iv,
        value: '',
      })
      if (!varRes?.success) throw new Error(varRes?.error ?? 'var create failed')
      return eid
    },
    { pid: projectId, name: envName, k: key, iv: initialValue },
  )
}

/** Create a saved HTTP request stamped to a specific branch. */
export async function createBranchScopedRequest(
  page: Page,
  opts: { projectId: string; branchId: string; name: string; url: string },
): Promise<string> {
  return page.evaluate(
    async ({ projectId, branchId, name, url }) => {
      const w = window as Window & {
        api?: {
          savedRequest?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
        }
      }
      const res = await w.api?.savedRequest?.create({
        project_id: projectId,
        branch_id: branchId,
        name,
        method: 'GET',
        url,
      })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create branch request failed')
      return res.data.id
    },
    opts,
  )
}

/** List git branches for active project via IPC. */
export async function listBranches(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { branch?: { list: (id: string) => Promise<IpcResult<Array<{ id: string; name: string }>>> } }
    }
    const res = await w.api?.branch?.list(pid)
    if (!res?.success) throw new Error(res?.error ?? 'list branches failed')
    return res.data ?? []
  }, projectId)
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
