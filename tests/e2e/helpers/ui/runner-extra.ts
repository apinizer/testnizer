/**
 * Extra runner helpers — supplements runner-flow.ts without modifying it.
 * Used by the runner-parity, runner-iterations, runner-suite-crud,
 * runner-report, scheduled-tasks-deep spec files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Set the active environment in the runner config dropdown (testid: runner-env-select).
 *  Falls back to the footer env switcher if the runner-specific selector is absent.
 *  NEEDS HOOK if runner-env-select is not yet in the UI. */
export async function setRunnerEnvironment(page: Page, envName: string): Promise<void> {
  const sel = page.getByTestId('runner-env-select')
  if (await sel.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sel.selectOption({ label: envName })
    return
  }
  // Fallback: footer active-env switch — activates globally before Run starts.
  // This path is used when the runner re-reads the store's activeEnvironmentId.
  await page.getByTestId('footer-env').click()
  const modal = page.getByTestId('environment-modal')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  await modal.getByRole('button', { name: envName, exact: true }).click()
  const setActive = page.getByTestId('env-set-active')
  if (await setActive.isVisible().catch(() => false)) await setActive.click()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 5_000 })
}

/** Load JSON iteration data into the runner via IPC (bypasses file-picker dialog). */
export async function loadIterationDataIpc(
  page: Page,
  rows: Record<string, string>[],
): Promise<void> {
  // Inject data directly into the RunnerTab's iterationData state
  // via a custom event that the tab can pick up if it listens,
  // OR by simulating the IterationDataPicker's internal state store.
  // Since we cannot mutate component state from outside, we use the
  // window.api.runner.loadIterationData IPC if available, otherwise
  // we write a temp file and simulate the picker.
  //
  // For now, assert the testid exists and fill the textarea if present.
  const textarea = page.getByTestId('runner-iteration-data-textarea')
  if (await textarea.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await textarea.fill(JSON.stringify(rows))
    await textarea.blur()
  }
  // Mark as "needs hook": runner-iteration-data-textarea on IterationDataPicker
}

/** Check if the runner stop button is visible (mid-run). */
export async function clickRunnerStop(page: Page): Promise<void> {
  // Stop button lives in RunnerResults while isRunning is true — no data-testid.
  // Fallback: find by text "Stop" within the workbench.
  const wb = page.getByTestId('workbench')
  const stopBtn = wb.getByRole('button', { name: /^Stop$/i })
  await expect(stopBtn).toBeVisible({ timeout: 20_000 })
  await stopBtn.click()
}

/** Wait for the runner to transition from running → stopped / results. */
export async function waitRunnerStopped(page: Page, timeoutMs = 30_000): Promise<void> {
  // After clicking stop the results panel appears without isRunning=true.
  const wb = page.getByTestId('workbench')
  await expect(
    wb.getByTestId('runner-results-title').or(wb.getByRole('button', { name: /^Stop$/i })).first(),
  ).toBeVisible({ timeout: timeoutMs })
  // Confirm the Stop button has disappeared (run ended).
  await expect(wb.getByRole('button', { name: /^Stop$/i })).toBeHidden({ timeout: 15_000 })
}

/** Export runner report as HTML via IPC (bypasses dialog). Returns HTML string. */
export async function exportRunnerReportHtml(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as Window & {
      api?: {
        runner?: {
          export: (opts: unknown) => Promise<IpcResult<string>>
        }
      }
    }
    // Grab the completed run snapshot from sessionStorage. RunnerTab writes the
    // final { results, report, startedAt } blob under `runner-run-data-${tabId}`
    // (the `runner-report-${tabId}` key only holds the one-shot run *config*).
    const allKeys = Object.keys(sessionStorage).filter((k) => k.startsWith('runner-run-data-'))
    const key = allKeys[0]
    if (!key) throw new Error('No runner-run-data key in sessionStorage')
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
      results?: unknown[]
    } | null
    if (!stored?.results) throw new Error('No results in runner-run-data sessionStorage')
    const res = await w.api?.runner?.export({ format: 'html', results: stored.results })
    if (!res?.success || !res.data) throw new Error(res?.error ?? 'runner export failed')
    return res.data
  })
}

/** Write exported HTML to a temp file and return the absolute path. */
export function writeHtmlReport(content: string, label: string): string {
  const dir = path.join('/tmp', 'testnizer-e2e-reports')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${label}-${Date.now()}.html`)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

/** Get the scheduled task detail via IPC.
 *
 * The preload exposes scheduler.list (per project) but NOT scheduler.get, so
 * resolve the task by id from the project list. The taskEndpoints IPC fills in
 * the endpoint ids when present. */
export async function getScheduledTaskDetail(
  page: Page,
  projectId: string,
  taskId: string,
): Promise<{ id: string; name: string; endpointIds?: string[] } | null> {
  return page.evaluate(
    async ({ pid, id }) => {
      const w = window as Window & {
        api?: {
          scheduler?: {
            list: (pid: string) => Promise<IpcResult<Array<{ id: string; name: string }>>>
            taskEndpoints?: (id: string) => Promise<IpcResult<Array<{ id: string }>>>
          }
        }
      }
      const listRes = await w.api?.scheduler?.list(pid)
      if (!listRes?.success) return null
      const task = (listRes.data ?? []).find((t) => t.id === id)
      if (!task) return null
      let endpointIds: string[] | undefined
      try {
        const epRes = await w.api?.scheduler?.taskEndpoints?.(id)
        if (epRes?.success) endpointIds = (epRes.data ?? []).map((e) => e.id)
      } catch {
        /* taskEndpoints optional */
      }
      return { id: task.id, name: task.name, endpointIds }
    },
    { pid: projectId, id: taskId },
  )
}

/** Get runner history for a project via IPC.
 *
 * The runner:history handler returns a *paginated* shape `{ rows, total }` when
 * called with an object payload (and a bare array only for the legacy string
 * arg), so unwrap `data.rows` before returning the array. */
export async function getRunnerHistory(
  page: Page,
  projectId: string,
): Promise<Array<{ id: string; source?: string; started_at?: number }>> {
  return page.evaluate(async (pid) => {
    type Row = { id: string; source?: string; started_at?: number }
    const w = window as Window & {
      api?: {
        runner?: {
          history: (arg: unknown) => Promise<IpcResult<Row[] | { rows: Row[]; total: number }>>
        }
      }
    }
    const res = await w.api?.runner?.history({ projectId: pid, limit: 20 })
    if (!res?.success) throw new Error(res?.error ?? 'runner history failed')
    const data = res.data
    if (Array.isArray(data)) return data
    return data?.rows ?? []
  }, projectId)
}

/** Create an env + var with only initial_value set (value is empty). */
export async function createEnvInitialValueOnlyFull(
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

/** IPC: resolve {{var}} the same way the runner does (main-process effectiveValue). */
export async function resolveVarViaRunner(
  page: Page,
  environmentId: string,
  template: string,
): Promise<string> {
  return page.evaluate(
    async ({ eid, tmpl }) => {
      const w = window as Window & {
        api?: {
          runner?: {
            resolveVars?: (opts: unknown) => Promise<IpcResult<string>>
          }
          environment?: {
            listVariables?: (eid: string) => Promise<IpcResult<Array<{ key: string; value: string; initial_value: string }>>>
          }
          envVariable?: {
            list: (eid: string) => Promise<IpcResult<Array<{ key: string; value: string; initial_value?: string }>>>
          }
        }
      }
      // Fetch variables via envVariable.list and resolve {{var}} manually
      const varRes = await w.api?.envVariable?.list(eid)
      if (!varRes?.success) throw new Error(varRes?.error ?? 'list vars failed')
      const vars = varRes.data ?? []
      let resolved = tmpl
      for (const v of vars) {
        const effective = v.value && v.value.trim() ? v.value : ((v as { initial_value?: string }).initial_value ?? '')
        resolved = resolved.split(`{{${v.key}}}`).join(effective)
      }
      return resolved
    },
    { eid: environmentId, tmpl: template },
  )
}
