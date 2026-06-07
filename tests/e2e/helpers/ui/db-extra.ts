/**
 * Extra DB-level helpers for MST-016 / MST-266 / MST-276 / MST-279 / MST-280 / MST-281.
 *
 * Kept in a separate file so the existing db-flow.ts is not modified.
 */
import type { Page } from '@playwright/test'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Get a project by ID from the IPC layer. */
export async function getProjectById(
  page: Page,
  projectId: string,
): Promise<{ id: string; name: string; save_mode: string } | null> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: {
        project?: { get: (id: string) => Promise<IpcResult<{ id: string; name: string; save_mode: string }>> }
      }
    }
    const res = await w.api?.project?.get(pid)
    if (!res?.success) return null
    return res.data ?? null
  }, projectId)
}

/** Create a project in the given workspace and return its ID. */
export async function createProjectIpc(
  page: Page,
  workspaceId: string,
  name: string,
  type = 'http',
): Promise<string> {
  return page.evaluate(
    async ({ wid, n, t }) => {
      const w = window as Window & {
        api?: {
          project?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> }
        }
      }
      const res = await w.api?.project?.create({ workspace_id: wid, name: n, type: t })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'project create failed')
      return res.data.id
    },
    { wid: workspaceId, n: name, t: type },
  )
}

/** Update a project's fields. */
export async function updateProjectIpc(
  page: Page,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await page.evaluate(
    async ({ pid, data }) => {
      const w = window as Window & {
        api?: { project?: { update: (id: string, p: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.project?.update(pid, data)
    },
    { pid: projectId, data: patch },
  )
  if (!res?.success) throw new Error(res?.error ?? 'project update failed')
}

/** Rename a DB branch (branch:rename IPC). */
export async function renameBranchIpc(
  page: Page,
  branchId: string,
  newName: string,
): Promise<void> {
  const res = await page.evaluate(
    async ({ id, name }) => {
      const w = window as Window & {
        api?: { branch?: { rename: (id: string, name: string) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.branch?.rename(id, name)
    },
    { id: branchId, name: newName },
  )
  if (!res?.success) throw new Error(res?.error ?? 'branch rename failed')
}

/** Retrieve save history for a project. */
export async function getSaveHistoryIpc(
  page: Page,
  projectId: string,
): Promise<Array<{ id: string; mode: string; path: string; message: string }>> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: {
        save?: {
          history: (id: string) => Promise<IpcResult<Array<{ id: string; mode: string; path: string; message: string }>>>
        }
      }
    }
    const res = await w.api?.save?.history(pid)
    if (!res?.success) throw new Error(res?.error ?? 'save history failed')
    return res.data ?? []
  }, projectId)
}

/** Write an arbitrary settings value (for test setup / teardown). */
export async function setSettingsValue(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  const res = await page.evaluate(
    async ({ k, v }) => {
      const w = window as Window & {
        api?: { settings?: { set: (k: string, v: unknown) => Promise<IpcResult<unknown>> } }
      }
      return w.api?.settings?.set(k, v)
    },
    { k: key, v: value },
  )
  if (!res?.success) throw new Error(res?.error ?? 'settings set failed')
}

/** Read a settings value. */
export async function getSettingsValue(
  page: Page,
  key: string,
): Promise<unknown> {
  const res = await page.evaluate(async (k) => {
    const w = window as Window & {
      api?: { settings?: { get: (k: string) => Promise<IpcResult<unknown>> } }
    }
    return w.api?.settings?.get(k)
  }, key)
  if (!res?.success) throw new Error(res?.error ?? 'settings get failed')
  return res?.data
}
