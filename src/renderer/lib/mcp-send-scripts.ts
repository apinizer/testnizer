/**
 * Scripts and Tests around an MCP call on the Send path (issue #160) — the
 * renderer twin of the Runner's MCP step (`runner.handler.ts`, issue #161).
 *
 * Same pieces as HTTP Send (`request.store.ts#sendRequest`), not a third
 * script runtime: the per-tab request store's `preScript` / `postScript` /
 * `assertions`, the project → folder → request cascade (`resolveInheritance`),
 * `createPmApi` + `runScript` (the shared `src/shared/script/` runtime), the
 * assertion rows (`runAssertions`), and the ONE MCP result adapter both paths
 * use (`src/shared/mcp-response.ts`: `pm.response` + `pm.mcp`).
 *
 * Variable rules are HTTP's: pre-request writes resolve `{{var}}` in the
 * call's arguments (`varUpdates` local, not persisted; env / global writes go
 * through `applyScriptUpdates`), post-response env / global writes persist so
 * a later call can chain on them.
 */
import type { ApiResponse, ConsoleLog, TestAssertion, TestResult } from '../types'
import type { NormalizedResponse } from '../../shared/script'
import { mcpOutcomeToResponse, mcpScriptInfo, type McpCallOutcome } from '../../shared/mcp-response'
import {
  createPmApi,
  resolveAssertionVars,
  runAssertions,
  runScript,
  type ScriptRunResult,
} from './test-runner'
import { resolveInheritance } from './auth-inheritance'
import { resolveVariables } from './variable-resolver'
import { makeId } from './utils'
import { useRequestStore } from '../stores/request.store'
import { useTabsStore } from '../stores/tabs.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useEnvironmentStore } from '../stores/environment.store'
import { useConsoleStore } from '../stores/console.store'
import { mcpDisplayTarget } from '../../shared/mcp-call'

/** What the Test Results view of one call shows. */
export interface McpTestRun {
  results: TestResult[]
  /** An uncaught throw in a post-response script (its pm.test results so far still count). */
  scriptError?: string
}

/** Everything one Send's scripts share — captured when the call starts. */
export interface McpScriptContext {
  tabId: string | null
  requestName: string
  projectId?: string
  /** The server URL / command as typed — `pm.request.url` and the console line. */
  url: string
  /** Enabled custom headers as typed — `pm.request.headers` (Run's MCP step reads the same). */
  headers: Array<{ key: string; value: string }>
  preScripts: string[]
  postScripts: string[]
  assertions: TestAssertion[]
  /** This send's script writes (local > env > global, like `pm.variables.get`). */
  overrides: Record<string, string>
  logs: ConsoleLog[]
}

export type McpPreOutcome = { ok: true } | { ok: false; skipped: boolean; message: string }

const hasCode = (s: string | null | undefined): s is string => !!s && s.trim().length > 0

/**
 * Capture the tab's scripts + assertions NOW (synchronously, before the
 * caller's first await — the request store's live slice follows the active
 * tab), then resolve the folder / project cascade over IPC.
 */
export function beginMcpScripts(
  tabId: string | null,
  url: string,
  customHeaders: ReadonlyArray<{ key: string; value: string; enabled?: boolean }> = [],
): Promise<McpScriptContext> {
  const req = useRequestStore.getState()
  const own = tabId && req._currentTabId !== tabId ? (req._tabStates.get(tabId) ?? null) : req
  const preScript = own?.preScript ?? ''
  const postScript = own?.postScript ?? ''
  const assertions = own?.assertions ?? []
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
  const projectId = useWorkspaceStore.getState().activeProjectId || undefined
  const base = {
    tabId,
    requestName: tab?.name ?? '',
    projectId,
    url,
    headers: customHeaders
      .filter((h) => h.enabled !== false && h.key.trim())
      .map((h) => ({ key: h.key, value: h.value })),
    assertions,
    overrides: {},
    logs: [],
  }
  return resolveInheritance({
    projectId,
    endpointId: tab?.endpointId,
    savedRequestId: tab?.savedRequestId,
    // MCP has its own Authorization tab — only the script cascade is used here.
    requestAuth: { type: 'none' },
    requestPre: preScript,
    requestPost: postScript,
  }).then((inh) => ({
    ...base,
    preScripts: inh.preScripts.filter(hasCode),
    postScripts: inh.postScripts.filter(hasCode),
  }))
}

/** The variables a `{{var}}` in this send resolves against (env + script writes). */
export function mcpSendVars(ctx: McpScriptContext): Record<string, string> {
  return { ...useEnvironmentStore.getState().getActiveVariables(), ...ctx.overrides }
}

function globalVarMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const gv of useEnvironmentStore.getState().globalVariables || []) {
    if (gv.enabled) map.set(gv.key, gv.value || gv.initialValue || '')
  }
  return map
}

/** Fold a script's writes into the send and persist env / global ones (HTTP's rule). */
function absorb(ctx: McpScriptContext, r: ScriptRunResult): void {
  for (const log of r.consoleLogs) {
    const level = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : 'log'
    ctx.logs.push({ level, message: log.message, timestamp: log.timestamp })
  }
  Object.assign(ctx.overrides, r.globalUpdates, r.envUpdates, r.varUpdates)
  if (Object.keys(r.envUpdates).length > 0 || Object.keys(r.globalUpdates).length > 0) {
    void useEnvironmentStore.getState().applyScriptUpdates(r.envUpdates, r.globalUpdates)
  }
}

const EMPTY_RESPONSE = (): ApiResponse => ({
  requestId: makeId(),
  protocol: 'mcp',
  timing: { total: 0 },
})

/**
 * Pre-request scripts, cascade order. The first one that throws aborts the
 * call (HTTP / Runner rule); `pm.execution.skipRequest()` skips it.
 */
export async function runMcpPreScripts(ctx: McpScriptContext): Promise<McpPreOutcome> {
  let skipped = false
  for (const script of ctx.preScripts) {
    const envMap = new Map(Object.entries(mcpSendVars(ctx)))
    const pmApi = createPmApi(EMPTY_RESPONSE(), envMap, globalVarMap(), {
      eventName: 'prerequest',
      requestName: ctx.requestName,
      request: { method: 'MCP', url: ctx.url, headers: ctx.headers },
      projectId: ctx.projectId,
    })
    const r = await runScript(script, pmApi)
    absorb(ctx, r)
    if (r.scriptError) return { ok: false, skipped: false, message: r.scriptError }
    if (r.skipRequest) skipped = true
  }
  return skipped ? { ok: false, skipped: true, message: '' } : { ok: true }
}

/**
 * The shared adapter's response in the shape `createPmApi` / `runAssertions`
 * read. `request` becomes `pm.request` of the post-response script (method
 * `MCP`, the server URL and headers as typed — what Run's MCP step shows).
 */
export function mcpApiResponse(
  n: NormalizedResponse,
  request?: { url: string; headers: Array<{ key: string; value: string }> },
): ApiResponse {
  return {
    requestId: makeId(),
    protocol: 'mcp',
    status: n.code,
    statusText: n.statusText,
    headers: n.headers,
    body: n.body,
    bodySize: n.responseSize,
    cookies: [],
    timing: { total: n.responseTime },
    ...(request
      ? {
          actualRequest: {
            method: 'MCP',
            url: request.url,
            headers: Object.fromEntries(request.headers.map((h) => [h.key, h.value])),
          },
        }
      : {}),
  }
}

/**
 * Assertion rows, then post-response scripts (with `pm.mcp`) on a FINISHED
 * call. `null` when there is nothing to report: no result (error, cancel, an
 * input round — `mcpOutcomeToResponse` says so) or no checks at all.
 */
export async function runMcpPostChecks(
  ctx: McpScriptContext,
  outcome: McpCallOutcome,
): Promise<McpTestRun | null> {
  const normalized = mcpOutcomeToResponse(outcome)
  if (!normalized) return null
  const enabledRows = ctx.assertions.filter((a) => a.enabled)
  if (enabledRows.length === 0 && ctx.postScripts.length === 0) return null
  const response = mcpApiResponse(normalized, ctx)
  const vars = mcpSendVars(ctx)
  const results: TestResult[] = runAssertions(
    resolveAssertionVars(ctx.assertions, (t) => resolveVariables(t, vars)),
    response,
  )
  const mcp = mcpScriptInfo(outcome) ?? undefined
  let scriptError: string | undefined
  for (const script of ctx.postScripts) {
    const envMap = new Map(Object.entries(mcpSendVars(ctx)))
    const pmApi = createPmApi(response, envMap, globalVarMap(), {
      eventName: 'test',
      requestName: ctx.requestName,
      projectId: ctx.projectId,
    })
    const r = await runScript(script, pmApi, { mcp })
    results.push(...r.results)
    absorb(ctx, r)
    if (r.scriptError && !scriptError) scriptError = r.scriptError
  }
  // A post-script that only chains variables ran no test: no empty "0/0" view.
  if (results.length === 0 && !scriptError) return null
  return scriptError ? { results, scriptError } : { results }
}

/**
 * The server as the Console shows it — the shared History / Run masking
 * (`mcpDisplayTarget`): no `user:pass@`, credential query values and stdio
 * credential flags masked (review item 18). `pm.request` keeps the URL as typed.
 */
function consoleTarget(url: string): string {
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim())
  return mcpDisplayTarget(isUrl ? 'http' : 'stdio', url)
}

/** Script `console.*` output → the Console panel, like HTTP's "Script logs" entry. */
export function flushMcpScriptLogs(ctx: McpScriptContext, label: string): void {
  if (ctx.logs.length === 0) return
  const logs = ctx.logs.splice(0)
  const target = consoleTarget(ctx.url)
  useConsoleStore.getState().addFromResponse(
    {
      method: 'MCP',
      url: label ? `${target} ${label}` : target,
      tabId: ctx.tabId ?? undefined,
      protocol: 'mcp',
    },
    { ...EMPTY_RESPONSE(), consoleLogs: logs },
  )
}
