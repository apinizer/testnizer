/**
 * Extra helpers for WORKBENCH domain E2E tests.
 * Covers auth-advanced, tree-advanced, env-advanced, settings-advanced,
 * workspace-advanced, and ux-misc specs.
 *
 * Rules:
 * - All functions are side-effect-free utilities (no global state).
 * - IPC calls follow the { success, data?, error? } shape.
 * - Do NOT import from src/ — renderer and main types must be inlined.
 */
import type { Page } from '@playwright/test'

interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Change app password via IPC. Returns undefined if IPC not wired. */
export async function changePasswordViaIpc(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<IpcResult | undefined> {
  return page.evaluate(
    async ({ cur, next }) => {
      const w = window as Window & {
        api?: {
          auth?: {
            changePassword?: (p: {
              currentPassword: string
              newPassword: string
            }) => Promise<IpcResult>
          }
        }
      }
      return w.api?.auth?.changePassword?.({ currentPassword: cur, newPassword: next })
    },
    { cur: currentPassword, next: newPassword },
  )
}

/** Reset EULA consent (for MST-007 re-consent test). Returns undefined if IPC not wired. */
export async function resetEulaConsentViaIpc(page: Page): Promise<IpcResult | undefined> {
  return page.evaluate(async () => {
    const w = window as Window & {
      api?: { eula?: { resetConsent?: () => Promise<IpcResult> } }
    }
    return w.api?.eula?.resetConsent?.()
  })
}

/** Get current EULA consent state. */
export async function getEulaConsentViaIpc(
  page: Page,
): Promise<IpcResult<{ accepted: boolean }> | undefined> {
  return page.evaluate(async () => {
    const w = window as Window & {
      api?: {
        eula?: { getConsent?: () => Promise<IpcResult<{ accepted: boolean }>> }
      }
    }
    return w.api?.eula?.getConsent?.()
  })
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

/** Get project by id (for save-mode checks). */
export async function getProjectById(
  page: Page,
  projectId: string,
): Promise<IpcResult<Record<string, unknown>> | undefined> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: {
        project?: {
          get?: (id: string) => Promise<IpcResult<Record<string, unknown>>>
        }
      }
    }
    return w.api?.project?.get?.(pid)
  }, projectId)
}

/** Set a project-scoped variable (for MST-195). */
export async function setProjectVariable(
  page: Page,
  projectId: string,
  key: string,
  value: string,
): Promise<IpcResult | undefined> {
  return page.evaluate(
    async ({ pid, k, v }) => {
      const w = window as Window & {
        api?: {
          project?: {
            setVariable?: (p: {
              projectId: string
              key: string
              value: string
            }) => Promise<IpcResult>
          }
        }
      }
      return w.api?.project?.setVariable?.({ projectId: pid, key: k, value: v })
    },
    { pid: projectId, k: key, v: value },
  )
}

/** Get project-scoped variables (for MST-195). */
export async function getProjectVariables(
  page: Page,
  projectId: string,
): Promise<IpcResult<Array<{ key: string; value: string }>> | undefined> {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: {
        project?: {
          getVariables?: (id: string) => Promise<IpcResult<Array<{ key: string; value: string }>>>
        }
      }
    }
    return w.api?.project?.getVariables?.(pid)
  }, projectId)
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/** Get app settings object (for SSL verify, proxy mode assertions). */
export async function getAppSettings(
  page: Page,
): Promise<IpcResult<Record<string, unknown>> | undefined> {
  return page.evaluate(async () => {
    const w = window as Window & {
      api?: {
        settings?: {
          get?: () => Promise<IpcResult<Record<string, unknown>>>
        }
      }
    }
    return w.api?.settings?.get?.()
  })
}

/** Trigger updater check for updates. */
export async function checkForUpdatesViaIpc(
  page: Page,
): Promise<IpcResult | undefined> {
  return page.evaluate(async () => {
    const w = window as Window & {
      api?: {
        updater?: {
          checkForUpdates?: () => Promise<IpcResult>
        }
      }
    }
    return w.api?.updater?.checkForUpdates?.()
  })
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Import a Postman environment JSON string via IPC (for MST-066). */
export async function importPostmanEnvironmentViaIpc(
  page: Page,
  workspaceId: string,
  projectId: string,
  content: string,
): Promise<IpcResult<{ envId?: string }> | undefined> {
  return page.evaluate(
    async ({ wid, pid, c }) => {
      const w = window as Window & {
        api?: {
          importExport?: {
            importPostmanEnvironment?: (p: unknown) => Promise<IpcResult<{ envId?: string }>>
          }
        }
      }
      return w.api?.importExport?.importPostmanEnvironment?.({
        workspaceId: wid,
        projectId: pid,
        content: c,
      })
    },
    { wid: workspaceId, pid: projectId, c: content },
  )
}

/** Export a Postman environment by environment id via IPC (for MST-064). */
export async function exportPostmanEnvironmentViaIpc(
  page: Page,
  environmentId: string,
): Promise<IpcResult<string> | undefined> {
  return page.evaluate(async (eid) => {
    const w = window as Window & {
      api?: {
        importExport?: {
          exportPostmanEnvironment?: (id: string) => Promise<IpcResult<string>>
        }
      }
    }
    return w.api?.importExport?.exportPostmanEnvironment?.(eid)
  }, environmentId)
}
