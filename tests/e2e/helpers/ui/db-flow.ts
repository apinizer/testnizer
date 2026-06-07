import type { Page } from '@playwright/test'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getDefaultWorkspaceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as Window & {
      api?: { workspace?: { list: () => Promise<IpcResult<Array<{ id: string }>>> } }
    }
    const res = await w.api?.workspace?.list()
    const id = res?.data?.[0]?.id
    if (!id) throw new Error('no workspace')
    return id
  })
}

export async function createWorkspace(page: Page, name: string): Promise<string> {
  return page.evaluate(
    async (n) => {
      const w = window as unknown as Window & {
        api?: { workspace?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.workspace?.create({ name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'workspace create failed')
      return res.data.id
    },
    name,
  )
}

export async function deleteWorkspace(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (wid) => {
    const w = window as unknown as Window & { api?: { workspace?: { delete: (id: string) => Promise<IpcResult<unknown>> } } }
    return w.api?.workspace?.delete(wid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'workspace delete failed')
}

export async function deleteProject(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (pid) => {
    const w = window as unknown as Window & { api?: { project?: { delete: (id: string) => Promise<IpcResult<unknown>> } } }
    return w.api?.project?.delete(pid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'project delete failed')
}

export async function duplicateProject(
  page: Page,
  projectId: string,
  workspaceId: string,
  name?: string,
): Promise<string> {
  return page.evaluate(
    async ({ pid, wid, n }) => {
      const w = window as unknown as Window & {
        api?: { project?: { duplicate: (p: unknown) => Promise<IpcResult<{ projectId: string }>> } }
      }
      const res = await w.api?.project?.duplicate({ projectId: pid, workspaceId: wid, name: n })
      if (!res?.success || !res.data?.projectId) throw new Error(res?.error ?? 'duplicate failed')
      return res.data.projectId
    },
    { pid: projectId, wid: workspaceId, n: name },
  )
}

export async function createSavedRequestIpc(
  page: Page,
  opts: {
    projectId: string
    name: string
    url: string
    method?: string
    protocol?: string
    metadata?: string
    headers?: string
    body?: string
    auth?: string
    branchId?: string | null
    folderId?: string | null
  },
): Promise<string> {
  return page.evaluate(
    async (payload) => {
      const w = window as unknown as Window & {
        api?: { savedRequest?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.savedRequest?.create({
        project_id: payload.projectId,
        folder_id: payload.folderId ?? null,
        name: payload.name,
        method: payload.method ?? 'GET',
        protocol: payload.protocol ?? 'http',
        url: payload.url,
        metadata: payload.metadata,
        headers: payload.headers,
        body: payload.body,
        auth: payload.auth,
        branch_id: payload.branchId ?? null,
      })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'saved request create failed')
      return res.data.id
    },
    opts,
  )
}

export async function updateSavedRequestIpc(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await page.evaluate(
    async ({ rid, data }) => {
      const w = window as unknown as Window & {
        api?: { savedRequest?: { update: (id: string, p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.savedRequest?.update(rid, data)
    },
    { rid: id, data: patch },
  )
  if (!res?.success) throw new Error(res?.error ?? 'saved request update failed')
}

export async function createEnvironmentIpc(
  page: Page,
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<string> {
  return page.evaluate(
    async ({ wid, pid, n }) => {
      const w = window as unknown as Window & {
        api?: { environment?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.environment?.create({ workspace_id: wid, project_id: pid, name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'env create failed')
      return res.data.id
    },
    { wid: workspaceId, pid: projectId, n: name },
  )
}

export async function createEnvVariableIpc(
  page: Page,
  environmentId: string,
  key: string,
  value: string,
  initialValue?: string,
  secret?: boolean,
): Promise<void> {
  const res = await page.evaluate(
    async ({ eid, k, v, iv, sec }) => {
      const w = window as unknown as Window & {
        api?: { envVariable?: { create: (p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.envVariable?.create({
        environment_id: eid,
        key: k,
        value: v,
        initial_value: iv ?? v,
        secret: sec ?? false,
      })
    },
    { eid: environmentId, k: key, v: value, iv: initialValue, sec: secret },
  )
  if (!res?.success) throw new Error(res?.error ?? 'env variable create failed')
}

export async function addHistoryIpc(
  page: Page,
  payload: {
    workspace_id?: string
    project_id?: string
    protocol: string
    method?: string
    url: string
    status_code?: number
    duration_ms?: number
    request_snapshot: string
    response_snapshot?: string
  },
): Promise<string> {
  return page.evaluate(
    async (p) => {
      const w = window as unknown as Window & {
        api?: { history?: { add: (payload: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.history?.add(p)
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'history add failed')
      return res.data.id
    },
    payload,
  )
}

export async function listHistoryIpc(
  page: Page,
  opts: { workspace_id?: string; project_id?: string; limit?: number },
): Promise<unknown[]> {
  return page.evaluate(async (o) => {
    const w = window as unknown as Window & {
      api?: { history?: { list: (opts: unknown) => Promise<IpcResult<unknown[]>> } }
    }
    const res = await w.api?.history?.list(o)
    if (!res?.success) throw new Error(res?.error ?? 'history list failed')
    return res.data ?? []
  }, opts)
}

export async function clearHistoryIpc(
  page: Page,
  scope: { workspace_id?: string; project_id?: string },
): Promise<void> {
  const res = await page.evaluate(async (s) => {
    const w = window as unknown as Window & { api?: { history?: { clear: (s: unknown) => Promise<IpcResult<unknown>> } } }
    return w.api?.history?.clear(s)
  }, scope)
  if (!res?.success) throw new Error(res?.error ?? 'history clear failed')
}

export async function addCertificateIpc(
  page: Page,
  payload: {
    projectId: string
    kind: 'ca' | 'client'
    host?: string
    crtPath?: string
    keyPath?: string
    pfxPath?: string
    passphrase?: string
    enabled?: boolean
  },
): Promise<string> {
  return page.evaluate(
    async (p) => {
      const w = window as unknown as Window & {
        api?: { certificate?: { add: (payload: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.certificate?.add(p)
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'certificate add failed')
      return res.data.id
    },
    payload,
  )
}

export async function updateCertificateIpc(
  page: Page,
  id: string,
  patch: { enabled?: boolean },
): Promise<void> {
  const res = await page.evaluate(
    async ({ cid, data }) => {
      const w = window as unknown as Window & {
        api?: { certificate?: { update: (p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.certificate?.update({ id: cid, ...data })
    },
    { cid: id, data: patch },
  )
  if (!res?.success) throw new Error(res?.error ?? 'certificate update failed')
}

export async function deleteCertificateIpc(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (cid) => {
    const w = window as unknown as Window & {
      api?: { certificate?: { delete: (id: string) => Promise<IpcResult<unknown>> } }
    }
    return w.api?.certificate?.delete(cid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'certificate delete failed')
}

export async function listCertificatesIpc(page: Page, projectId: string): Promise<unknown[]> {
  return page.evaluate(async (pid) => {
    const w = window as unknown as Window & {
      api?: { certificate?: { list: (id: string) => Promise<IpcResult<unknown[]>> } }
    }
    const res = await w.api?.certificate?.list(pid)
    if (!res?.success) throw new Error(res?.error ?? 'certificate list failed')
    return res.data ?? []
  }, projectId)
}

export async function createMockServerIpc(
  page: Page,
  projectId: string,
  name: string,
  port: number,
): Promise<string> {
  return page.evaluate(
    async ({ pid, n, p }) => {
      const w = window as unknown as Window & {
        api?: { mock?: { server?: { create: (input: unknown) => Promise<IpcResult<{ id: string }>> } } }
      }
      const res = await w.api?.mock?.server?.create({ projectId: pid, name: n, port: p })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'mock server create failed')
      return res.data.id
    },
    { pid: projectId, n: name, p: port },
  )
}

export async function deleteMockServerIpc(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (sid) => {
    const w = window as unknown as Window & {
      api?: { mock?: { server?: { delete: (id: string) => Promise<IpcResult<unknown>> } } }
    }
    return w.api?.mock?.server?.delete(sid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'mock server delete failed')
}

export async function getMockServerIpc(page: Page, id: string): Promise<unknown> {
  return page.evaluate(async (sid) => {
    const w = window as unknown as Window & {
      api?: { mock?: { server?: { get: (id: string) => Promise<IpcResult<unknown>> } } }
    }
    const res = await w.api?.mock?.server?.get(sid)
    if (!res?.success) throw new Error(res?.error ?? 'mock server get failed')
    return res.data
  }, id)
}

export async function createTestSuiteIpc(page: Page, projectId: string, name: string): Promise<string> {
  return page.evaluate(
    async ({ pid, n }) => {
      const w = window as unknown as Window & {
        api?: { testSuite?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.testSuite?.create({ project_id: pid, name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'test suite create failed')
      return res.data.id
    },
    { pid: projectId, n: name },
  )
}

export async function deleteTestSuiteIpc(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (sid) => {
    const w = window as unknown as Window & {
      api?: { testSuite?: { delete: (id: string) => Promise<IpcResult<unknown>> } }
    }
    return w.api?.testSuite?.delete(sid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'test suite delete failed')
}

export async function createBranchIpc(page: Page, projectId: string, name: string): Promise<string> {
  return page.evaluate(
    async ({ pid, n }) => {
      const w = window as unknown as Window & {
        api?: { branch?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const res = await w.api?.branch?.create({ project_id: pid, name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'branch create failed')
      return res.data.id
    },
    { pid: projectId, n: name },
  )
}

export async function deleteBranchIpc(page: Page, id: string): Promise<void> {
  const res = await page.evaluate(async (bid) => {
    const w = window as unknown as Window & { api?: { branch?: { delete: (id: string) => Promise<IpcResult<unknown>> } } }
    return w.api?.branch?.delete(bid)
  }, id)
  if (!res?.success) throw new Error(res?.error ?? 'branch delete failed')
}

export async function createNestedFolders(
  page: Page,
  projectId: string,
  names: string[],
): Promise<string[]> {
  return page.evaluate(
    async ({ pid, chain }) => {
      const w = window as unknown as Window & {
        api?: { folder?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
      }
      const ids: string[] = []
      let parentId: string | null = null
      for (const name of chain) {
        const res: IpcResult<{ id: string }> | undefined = await w.api?.folder?.create({
          project_id: pid,
          parent_id: parentId,
          name,
        })
        if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'folder create failed')
        ids.push(res.data.id)
        parentId = res.data.id
      }
      return ids
    },
    { pid: projectId, chain: names },
  )
}
