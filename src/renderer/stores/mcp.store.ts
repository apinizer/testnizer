import { create } from 'zustand'
import type { KeyValuePair } from '../types'
import type {
  McpAuthConfig,
  McpBridge,
  McpCapabilityTab,
  McpConfigTab,
  McpConnectRequest,
  McpConnectionClosedEvent,
  McpElicitAnswer,
  McpFrame,
  McpFrameEvent,
  McpGetPromptResult,
  McpNotification,
  McpNotificationEvent,
  McpOAuthDoneEvent,
  McpOAuthStartRequest,
  McpOAuthStep,
  McpOAuthStepEvent,
  McpOAuthSummary,
  McpPrompt,
  McpProtocolChoice,
  McpReadResourceResult,
  McpResource,
  McpResourceTemplate,
  McpSecurityScanRequest,
  McpSubscriptionStateEvent,
  McpTool,
  McpTransport,
} from '../types/mcp'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { getMcpApi } from '../lib/mcp-api'
import {
  sendConnectParams,
  sendPromptCall,
  sendResourceUri,
  sendToolCall,
} from '../lib/mcp-send-request'
import { tabUrlForServer, type ParsedMcpServer } from '../lib/mcp-config'
import {
  blankRow,
  generateExampleArgs,
  kvRowsToRecord,
  pushCapped,
  recordToRows,
} from '../lib/mcp-store-helpers'
// Shared dirty-flag helper — an edit flips the active tab's unsaved dot so
// Ctrl+S has something to persist (same as the SSE / WS stores, issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'
import {
  claimSecurityOrphans,
  securityEventHandlers,
  securityIdle,
  type McpSecurityTabState,
} from './mcp-security.slice'
import { defaultMcpAuth, resolveMcpAuth } from './mcp-auth.slice'
import {
  eraDefaults,
  eraFromConnect,
  eraIdle,
  inputRequiredOf,
  subscriptionEventPatch,
  toolLegPatch,
  type McpEraTabState,
} from './mcp-era.slice'
import { normalizeMcpProtocol } from '../lib/mcp-protocol'
import {
  callIdle,
  callMetaOf,
  outcomeOfAction,
  outcomeOfResponses,
  savedCallDefaults,
  type McpCallKind,
  type McpCallTabState,
  type McpPendingElicitation,
  type McpSavedCall,
} from './mcp-call.slice'
import { getMcpCallApi, type McpCallReply, type McpElicitationEvent } from '../lib/mcp-call-api'
import { loadArgsView, planArgsForm, prepareToolArgs, validateArgs } from '../lib/mcp-args-form'
import {
  beginMcpScripts,
  flushMcpScriptLogs,
  mcpSendVars,
  runMcpPostChecks,
  runMcpPreScripts,
  type McpScriptContext,
  type McpTestRun,
} from '../lib/mcp-send-scripts'
import type { McpCallOutcome } from '../../shared/mcp-response'
import { t } from '../lib/i18n'

export type { McpTransport, McpTool } from '../types/mcp'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Right-pane section ids (`McpEditor` tabs; extra ids come from `mcp/sections.ts`). */
export const MCP_EXPLORER_SECTION = 'explorer'
export const MCP_SECURITY_SECTION = 'security'

export interface TabMcpState extends McpSecurityTabState, McpEraTabState, McpCallTabState {
  transport: McpTransport
  /** Server URL — for stdio, the command line (`npx -y @scope/server …`). */
  url: string
  /**
   * Custom HTTP headers sent on the http / sse handshake and every request
   * after it (issue #137) — e.g. `Authorization: Bearer …` or API-gateway
   * `X-…` headers. Ignored for stdio. `{{var}}` resolves at Connect time.
   */
  customHeaders: KeyValuePair[]
  /** Extra environment for a stdio server process (issue #139). `{{var}}` resolves at Connect. */
  envVars: KeyValuePair[]
  /**
   * Authorization tab (MCP Auth): No Auth / Basic / Bearer / API Key /
   * OAuth 2.1. Persisted and part of the Ctrl+S snapshot like the headers;
   * `{{var}}` resolves at Connect. Ignored for stdio.
   */
  auth: McpAuthConfig
  /** Active tab of the config strip under the connection bar. Persisted, not saved. */
  configTab: McpConfigTab
  /** The config strip's panel is folded away. Persisted, not saved. */
  configCollapsed: boolean
  connectionId: string | null
  connectionState: ConnectionState
  serverName: string | null
  serverVersion: string | null
  protocolVersion: string | null
  capabilities: Record<string, unknown> | null
  instructions: string | null
  errorMessage: string | null
  tools: McpTool[]
  resources: McpResource[]
  resourceTemplates: McpResourceTemplate[]
  prompts: McpPrompt[]
  capabilityTab: McpCapabilityTab
  search: string
  selectedTool: string | null
  toolArgs: string
  result: unknown
  resultError: string | null
  isInvoking: boolean
  /** Key of the selected list item — a resource `uri` or a template `uriTemplate`. */
  selectedResourceUri: string | null
  /** Concrete URI the Read button sends (a template is edited into one here). */
  resourceUriDraft: string
  resourceContent: McpReadResourceResult | null
  resourceError: string | null
  isReadingResource: boolean
  selectedPrompt: string | null
  promptArgs: Record<string, string>
  promptResult: McpGetPromptResult | null
  promptError: string | null
  isGettingPrompt: boolean
  /** Server notifications for this tab's connection (ring buffer, MCP_LOG_LIMIT). */
  notifications: McpNotification[]
  /** Raw JSON-RPC frames for this tab's connection (ring buffer, MCP_LOG_LIMIT). */
  frames: McpFrame[]
  /** Renderer-supplied id so a stalled handshake can be cancelled. */
  _pendingConnectId?: string
  /** The last connect failed with HTTP 401 — the Authorization tab offers OAuth 2.1 (issue #141). */
  unauthorized: boolean
  /** Right-pane section: `MCP_EXPLORER_SECTION` or an `MCP_EXTRA_SECTIONS` id. Not persisted. */
  section: string
  // ── OAuth 2.1 debugger (issue #141) ──
  oauthClientId: string
  /**
   * Write-only: handed to main for the token request and never persisted —
   * `persistable()` blanks it (CLAUDE.md "Anahtar materyali" discipline).
   */
  oauthClientSecret: string
  oauthScope: string
  /** Flow running / last run on this tab — routes `mcp:oauth:*` events here. Not persisted. */
  oauthFlowId: string | null
  /**
   * Token session `connect()` authenticates with (set by "Connect with token").
   * Tokens live in main and die with the process, so this is never persisted
   * and never part of the Ctrl+S snapshot.
   */
  oauthSessionId: string | null
  oauthSteps: McpOAuthStep[]
  oauthSummary: McpOAuthSummary | null
  oauthRunning: boolean
  oauthError: string | null
  /** The probe got a 2xx — the server needs no authorization. */
  oauthNoAuthRequired: boolean
}

interface McpStore extends TabMcpState {
  _tabStates: Map<string, TabMcpState>
  _currentTabId: string | null

  setTransport: (t: McpTransport) => void
  /** Protocol era negotiation for the next Connect (issue #152). Marks the tab dirty. */
  setProtocol: (protocol: McpProtocolChoice) => void
  setUrl: (url: string) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  /** Replace the header list outright. Used by snapshot/restore paths. */
  setHeaders: (headers: KeyValuePair[]) => void
  addEnvVar: () => void
  updateEnvVar: (id: string, updates: Partial<KeyValuePair>) => void
  removeEnvVar: (id: string) => void
  /** Replace the stdio env list outright. Used by snapshot/restore paths. */
  setEnvVars: (envVars: KeyValuePair[]) => void
  /** Replace the Authorization config (type + fields). Marks the tab dirty. */
  setAuth: (auth: McpAuthConfig) => void
  /** Select a config tab (and unfold the panel). Not part of Ctrl+S. */
  setConfigTab: (tab: McpConfigTab) => void
  setConfigCollapsed: (collapsed: boolean) => void
  /** "Authorize…" after a 401: Authorization tab, type OAuth 2.1, panel unfolded. */
  openOAuthAuthorization: () => void
  /** Fill transport / url (command) / env / headers from a pasted host config. */
  applyServerConfig: (server: ParsedMcpServer) => void
  setCapabilityTab: (tab: McpCapabilityTab) => void
  setSearch: (search: string) => void
  setSelectedTool: (name: string | null) => void
  setToolArgs: (args: string) => void
  selectResource: (key: string | null) => void
  setResourceUriDraft: (uri: string) => void
  setSelectedPrompt: (name: string | null) => void
  setPromptArg: (name: string, value: string) => void
  clearNotifications: () => void
  clearFrames: () => void
  setSection: (section: string) => void
  setOAuthClientId: (v: string) => void
  setOAuthClientSecret: (v: string) => void
  setOAuthScope: (v: string) => void
  /** Run the OAuth 2.1 debugger flow against this tab's server (issue #141). */
  startOAuth: () => Promise<void>
  cancelOAuth: () => Promise<void>
  /** Drop this tab's tokens in main and clear the flow state. */
  forgetOAuth: () => Promise<void>
  /** Use the last flow's token for this tab and (re)connect with it. */
  connectWithOAuth: () => Promise<void>
  /** Opt-in for the active probes — rate-limit burst + tool calls (persisted per tab, not Ctrl+S). */
  setSecurityRateLimitProbe: (v: boolean) => void
  /** Run the MCP Security Scan against this tab's server (issue #142). */
  startSecurityScan: () => Promise<void>
  cancelSecurityScan: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  listTools: () => Promise<void>
  listResources: () => Promise<void>
  listPrompts: () => Promise<void>
  /** `force` skips the form view's pre-Invoke validation ("Invoke anyway", issue #162). */
  callTool: (opts?: { force?: boolean }) => Promise<void>
  /**
   * Answer the pending `input_required` round (2026-07-28 MRTR): the same
   * tool + arguments again with `inputResponses` keyed like `inputRequests`
   * and the `requestState` echoed. May open the next round.
   */
  respondInput: (responses: Record<string, McpElicitAnswer>) => Promise<void>
  /** Drop the pending input card without answering. */
  dismissInput: () => void
  readResource: () => Promise<void>
  getPrompt: () => Promise<void>
  /**
   * Cancel this tab's running call of `kind` (issue #163). The tab is freed
   * at once; main's late reply for that call id is ignored.
   */
  cancelCall: (kind: McpCallKind) => Promise<void>
  /** Ctrl/Cmd+Enter (issue #165): Invoke / Read / Get for the active capability tab. */
  runPrimaryAction: () => void
  /** Answer a pending 2025-era elicitation (issue #168). */
  respondElicitation: (
    elicitationId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ) => Promise<void>
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
}

/** Configuration + per-tab UI state — survives disconnect. */
type McpConfigKeys =
  | 'transport'
  | 'protocol'
  | 'url'
  | 'customHeaders'
  | 'envVars'
  | 'auth'
  | 'configTab'
  | 'configCollapsed'
  | 'capabilityTab'
  | 'search'
  | 'notifications'
  | 'frames'
  | 'section'
  | 'oauthClientId'
  | 'oauthClientSecret'
  | 'oauthScope'
  | 'oauthFlowId'
  | 'oauthSessionId'
  | 'oauthSteps'
  | 'oauthSummary'
  | 'oauthRunning'
  | 'oauthError'
  | 'oauthNoAuthRequired'
  // The call (issue #159): saved with the request, so it outlives the connection.
  | 'selectedTool'
  | 'toolArgs'
  | 'selectedResourceUri'
  | 'resourceUriDraft'
  | 'selectedPrompt'
  | 'promptArgs'
  | keyof McpSecurityTabState
type ConnectionSlice = Omit<TabMcpState, McpConfigKeys>

/** Everything tied to a live connection — reset on disconnect / close. */
function disconnectedPatch(): ConnectionSlice {
  return {
    connectionId: null,
    connectionState: 'disconnected',
    serverName: null,
    serverVersion: null,
    protocolVersion: null,
    capabilities: null,
    instructions: null,
    errorMessage: null,
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    result: null,
    resultError: null,
    isInvoking: false,
    resourceContent: null,
    resourceError: null,
    isReadingResource: false,
    promptResult: null,
    promptError: null,
    isGettingPrompt: false,
    _pendingConnectId: undefined,
    unauthorized: false,
    ...eraIdle(),
    ...callIdle(),
  }
}

/** OAuth flow / token state — transient: tokens live in main and die with the process. */
function oauthIdle(): Pick<
  TabMcpState,
  | 'oauthFlowId'
  | 'oauthSessionId'
  | 'oauthSteps'
  | 'oauthSummary'
  | 'oauthRunning'
  | 'oauthError'
  | 'oauthNoAuthRequired'
> {
  return {
    oauthFlowId: null,
    oauthSessionId: null,
    oauthSteps: [],
    oauthSummary: null,
    oauthRunning: false,
    oauthError: null,
    oauthNoAuthRequired: false,
  }
}

function emptyState(): TabMcpState {
  return {
    transport: 'http',
    url: '',
    customHeaders: [blankRow()],
    envVars: [blankRow()],
    auth: defaultMcpAuth(),
    configTab: 'auth',
    configCollapsed: false,
    ...savedCallDefaults(),
    search: '',
    notifications: [],
    frames: [],
    section: MCP_EXPLORER_SECTION,
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScope: '',
    ...oauthIdle(),
    securityRateLimitProbe: false,
    ...securityIdle(),
    ...disconnectedPatch(),
    ...eraDefaults(),
  }
}

function extractState(s: TabMcpState): TabMcpState {
  return {
    transport: s.transport,
    url: s.url,
    customHeaders: s.customHeaders,
    envVars: s.envVars,
    auth: s.auth,
    configTab: s.configTab,
    configCollapsed: s.configCollapsed,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    serverName: s.serverName,
    serverVersion: s.serverVersion,
    protocolVersion: s.protocolVersion,
    capabilities: s.capabilities,
    instructions: s.instructions,
    errorMessage: s.errorMessage,
    tools: s.tools,
    resources: s.resources,
    resourceTemplates: s.resourceTemplates,
    prompts: s.prompts,
    capabilityTab: s.capabilityTab,
    search: s.search,
    selectedTool: s.selectedTool,
    toolArgs: s.toolArgs,
    result: s.result,
    resultError: s.resultError,
    isInvoking: s.isInvoking,
    selectedResourceUri: s.selectedResourceUri,
    resourceUriDraft: s.resourceUriDraft,
    resourceContent: s.resourceContent,
    resourceError: s.resourceError,
    isReadingResource: s.isReadingResource,
    selectedPrompt: s.selectedPrompt,
    promptArgs: s.promptArgs,
    promptResult: s.promptResult,
    promptError: s.promptError,
    isGettingPrompt: s.isGettingPrompt,
    notifications: s.notifications,
    frames: s.frames,
    _pendingConnectId: s._pendingConnectId,
    unauthorized: s.unauthorized,
    section: s.section,
    oauthClientId: s.oauthClientId,
    oauthClientSecret: s.oauthClientSecret,
    oauthScope: s.oauthScope,
    oauthFlowId: s.oauthFlowId,
    oauthSessionId: s.oauthSessionId,
    oauthSteps: s.oauthSteps,
    oauthSummary: s.oauthSummary,
    oauthRunning: s.oauthRunning,
    oauthError: s.oauthError,
    oauthNoAuthRequired: s.oauthNoAuthRequired,
    securityScanId: s.securityScanId,
    securityRunning: s.securityRunning,
    securityProgress: s.securityProgress,
    securityFindings: s.securityFindings,
    securityReport: s.securityReport,
    securityError: s.securityError,
    securityRateLimitProbe: s.securityRateLimitProbe,
    protocol: s.protocol,
    era: s.era,
    discover: s.discover,
    subscription: s.subscription,
    pendingInput: s.pendingInput,
    toolCallId: s.toolCallId,
    resourceCallId: s.resourceCallId,
    promptCallId: s.promptCallId,
    toolMeta: s.toolMeta,
    resourceMeta: s.resourceMeta,
    promptMeta: s.promptMeta,
    inputOutcome: s.inputOutcome,
    pendingElicitations: s.pendingElicitations,
    argsProblems: s.argsProblems,
    hiddenArgs: s.hiddenArgs,
    toolTests: s.toolTests,
    resourceTests: s.resourceTests,
    promptTests: s.promptTests,
  }
}

/**
 * On-disk view of a tab: configuration only. Connections, lists, results and
 * the notification / frame logs are transient — writing 500 frames to
 * localStorage on every frame would be wasteful, and a restored connectionId
 * would point at a connection that no longer exists.
 */
function persistable(s: TabMcpState): TabMcpState {
  return {
    ...s,
    ...disconnectedPatch(),
    notifications: [],
    frames: [],
    section: MCP_EXPLORER_SECTION,
    // Write-only secret and the token session never reach localStorage.
    oauthClientSecret: '',
    ...oauthIdle(),
    // Scan results are transient; only the rate-limit opt-in survives.
    ...securityIdle(),
  }
}

const STORAGE_KEY = 'testnizer-mcp'
const persisted = loadTabbedState<TabMcpState>(STORAGE_KEY, emptyState)

// ─── Tab / connection routing (issue #76 discipline) ────────────────────────
// Async results and server events land on the tab that OWNS them — found by
// tab id (connect) or by connectionId (everything after) — never on whichever
// tab happens to be active when they resolve.

type Patch = Partial<TabMcpState> | ((s: TabMcpState) => Partial<TabMcpState>)

const applyPatch = (s: TabMcpState, patch: Patch): Partial<TabMcpState> =>
  typeof patch === 'function' ? patch(s) : patch

/** Patch the tab `tabId` — the live slice when it is current, else its cached state. */
function patchTab(tabId: string | null, patch: Patch): void {
  const s = useMcpStore.getState()
  if (s._currentTabId === tabId) {
    useMcpStore.setState(applyPatch(extractState(s), patch))
    return
  }
  const cached = tabId ? s._tabStates.get(tabId) : undefined
  if (!tabId || !cached) return
  const map = new Map(s._tabStates)
  map.set(tabId, { ...cached, ...applyPatch(cached, patch) })
  useMcpStore.setState({ _tabStates: map })
}

function readTab(tabId: string | null): TabMcpState | undefined {
  const s = useMcpStore.getState()
  if (s._currentTabId === tabId) return extractState(s)
  return tabId ? s._tabStates.get(tabId) : undefined
}

/** The tab whose slice holds `connectionId` (live slice first), or undefined. */
function findConnectionTab(connectionId: string): { tabId: string | null } | undefined {
  const s = useMcpStore.getState()
  if (s.connectionId === connectionId) return { tabId: s._currentTabId }
  for (const [tabId, st] of s._tabStates) {
    if (tabId !== s._currentTabId && st.connectionId === connectionId) return { tabId }
  }
  return undefined
}

/** Patch the tab that owns `connectionId`; false when no tab does (closed / unknown). */
function patchConnection(connectionId: string, patch: Patch): boolean {
  const owner = findConnectionTab(connectionId)
  if (!owner) return false
  patchTab(owner.tabId, patch)
  return true
}

// Events that arrive before `connect()` has resolved (the `initialize`
// round-trip) cannot be routed yet — the connectionId is not on any tab. They
// wait here, bounded, and are drained into the tab when connect resolves.
const ORPHAN_CONNECTION_LIMIT = 16
const orphanLogs = new Map<string, { notifications: McpNotification[]; frames: McpFrame[] }>()

function stashOrphan(connectionId: string, entry: { n?: McpNotification; f?: McpFrame }): void {
  let bucket = orphanLogs.get(connectionId)
  if (!bucket) {
    bucket = { notifications: [], frames: [] }
    orphanLogs.set(connectionId, bucket)
    if (orphanLogs.size > ORPHAN_CONNECTION_LIMIT) {
      const oldest = orphanLogs.keys().next().value
      if (oldest !== undefined) orphanLogs.delete(oldest)
    }
  }
  if (entry.n) bucket.notifications = pushCapped(bucket.notifications, entry.n)
  if (entry.f) bucket.frames = pushCapped(bucket.frames, entry.f)
}

function takeOrphans(connectionId: string): {
  notifications: McpNotification[]
  frames: McpFrame[]
} {
  const bucket = orphanLogs.get(connectionId)
  orphanLogs.delete(connectionId)
  return bucket ?? { notifications: [], frames: [] }
}

// `…/list_changed` notifications re-fetch that list for the owning tab.
const LIST_CHANGED: Record<string, (cid: string) => Promise<void>> = {
  'notifications/tools/list_changed': (cid) => loadTools(cid),
  'notifications/resources/list_changed': (cid) => loadResources(cid),
  'notifications/prompts/list_changed': (cid) => loadPrompts(cid),
}

function handleNotification(evt: McpNotificationEvent): void {
  if (!evt || typeof evt.connectionId !== 'string' || typeof evt.method !== 'string') return
  const entry: McpNotification = {
    id: makeId(),
    ts: typeof evt.ts === 'number' ? evt.ts : Date.now(),
    method: evt.method,
    ...(evt.params !== undefined ? { params: evt.params } : {}),
  }
  const routed = patchConnection(evt.connectionId, (s) => ({
    notifications: pushCapped(s.notifications, entry),
  }))
  if (!routed) {
    stashOrphan(evt.connectionId, { n: entry })
    return
  }
  const refresh = LIST_CHANGED[evt.method]
  if (refresh) void refresh(evt.connectionId)
}

function handleFrame(evt: McpFrameEvent): void {
  if (!evt || typeof evt.connectionId !== 'string') return
  const entry: McpFrame = {
    id: makeId(),
    ts: typeof evt.ts === 'number' ? evt.ts : Date.now(),
    direction: evt.direction === 'out' ? 'out' : 'in',
    message: evt.message,
    ...(evt.truncated ? { truncated: true } : {}),
  }
  const routed = patchConnection(evt.connectionId, (s) => ({ frames: pushCapped(s.frames, entry) }))
  if (!routed) stashOrphan(evt.connectionId, { f: entry })
}

/** 2026-07-28 `subscriptions/listen` opened / ended — shown in the Messages pane header. */
function handleSubscriptionState(evt: McpSubscriptionStateEvent): void {
  if (!evt || typeof evt.connectionId !== 'string') return
  if (evt.state !== 'open' && evt.state !== 'closed') return
  // The `open` ack also rides the connect result, so an event that beats the
  // connect reply (no owner yet) loses nothing.
  patchConnection(evt.connectionId, subscriptionEventPatch(evt))
}

function handleConnectionClosed(evt: McpConnectionClosedEvent): void {
  if (!evt || typeof evt.connectionId !== 'string') return
  orphanLogs.delete(evt.connectionId)
  patchConnection(evt.connectionId, {
    ...disconnectedPatch(),
    connectionState: evt.reason ? 'error' : 'disconnected',
    errorMessage: evt.reason ?? null,
  })
}

/** Answer elicitations nobody will fill in (call cancelled, tab closed) so the server never hangs. */
function answerElicitations(
  connectionId: string,
  list: readonly McpPendingElicitation[],
  action: 'decline' | 'cancel',
): void {
  const api = getMcpCallApi()
  if (!api?.respondElicitation) return
  for (const e of list) {
    api.respondElicitation(connectionId, e.elicitationId, { action }).catch(() => {})
  }
}

/**
 * `mcp:elicitation` (2025 era, issue #168) → the tab that owns the
 * connection, live or cached, so a background tab keeps it pending. Nobody
 * owns it (tab closed mid-call) → cancel it at once: main is holding the
 * server's request open until it is answered.
 */
function handleElicitation(evt: McpElicitationEvent): void {
  if (!evt || typeof evt.connectionId !== 'string' || typeof evt.elicitationId !== 'string') return
  const entry: McpPendingElicitation = {
    elicitationId: evt.elicitationId,
    message: typeof evt.message === 'string' ? evt.message : '',
    requestedSchema:
      evt.requestedSchema && typeof evt.requestedSchema === 'object' ? evt.requestedSchema : {},
    ...(typeof evt.serverName === 'string' && evt.serverName ? { serverName: evt.serverName } : {}),
  }
  const routed = patchConnection(evt.connectionId, (s) => ({
    pendingElicitations: [
      ...s.pendingElicitations.filter((e) => e.elicitationId !== entry.elicitationId),
      entry,
    ],
  }))
  if (!routed) answerElicitations(evt.connectionId, [entry], 'cancel')
}

// ─── OAuth 2.1 debugger events (issue #141) — routed by flow id ─────────────

function findOAuthTab(flowId: string): { tabId: string | null } | undefined {
  const s = useMcpStore.getState()
  if (s.oauthFlowId === flowId) return { tabId: s._currentTabId }
  for (const [tabId, st] of s._tabStates) {
    if (tabId !== s._currentTabId && st.oauthFlowId === flowId) return { tabId }
  }
  return undefined
}

function patchOAuthFlow(flowId: string, patch: Patch): boolean {
  const owner = findOAuthTab(flowId)
  if (!owner) return false
  patchTab(owner.tabId, patch)
  return true
}

function upsertStep(steps: McpOAuthStep[], step: McpOAuthStep): McpOAuthStep[] {
  const next = steps.filter((s) => s.id !== step.id)
  next.push(step)
  return next.sort((a, b) => a.index - b.index)
}

function oauthDonePatch(evt: McpOAuthDoneEvent): Partial<TabMcpState> {
  return {
    oauthRunning: false,
    oauthSummary: evt.ok && evt.summary ? evt.summary : null,
    oauthError: evt.ok ? null : (evt.error ?? 'OAuth flow failed'),
    oauthNoAuthRequired: !!evt.noAuthRequired,
  }
}

// Steps can race the `oauthStart` reply that names the flow — park them here.
const OAUTH_ORPHAN_LIMIT = 8
const oauthOrphans = new Map<string, { steps: McpOAuthStep[]; done?: McpOAuthDoneEvent }>()

function oauthOrphan(flowId: string): { steps: McpOAuthStep[]; done?: McpOAuthDoneEvent } {
  let bucket = oauthOrphans.get(flowId)
  if (!bucket) {
    bucket = { steps: [] }
    oauthOrphans.set(flowId, bucket)
    if (oauthOrphans.size > OAUTH_ORPHAN_LIMIT) {
      const oldest = oauthOrphans.keys().next().value
      if (oldest !== undefined) oauthOrphans.delete(oldest)
    }
  }
  return bucket
}

function handleOAuthStep(evt: McpOAuthStepEvent): void {
  if (
    !evt ||
    typeof evt.oauthSessionId !== 'string' ||
    !evt.step ||
    typeof evt.step.id !== 'string'
  ) {
    return
  }
  const routed = patchOAuthFlow(evt.oauthSessionId, (s) => ({
    oauthSteps: upsertStep(s.oauthSteps, evt.step),
  }))
  if (!routed) {
    const bucket = oauthOrphan(evt.oauthSessionId)
    bucket.steps = upsertStep(bucket.steps, evt.step)
  }
}

function handleOAuthDone(evt: McpOAuthDoneEvent): void {
  if (!evt || typeof evt.oauthSessionId !== 'string') return
  if (!patchOAuthFlow(evt.oauthSessionId, oauthDonePatch(evt))) {
    oauthOrphan(evt.oauthSessionId).done = evt
  }
}

function forgetOAuthSessions(ids: Array<string | null | undefined>): void {
  const api = getMcpApi()
  if (!api?.oauthForget) return
  for (const id of new Set(ids.filter((v): v is string => !!v))) {
    api.oauthForget(id).catch(() => {})
  }
}

// ─── Security Scan events (issue #142) — routed by scan id ──────────────────

function findSecurityTab(scanId: string): { tabId: string | null } | undefined {
  const s = useMcpStore.getState()
  if (s.securityScanId === scanId) return { tabId: s._currentTabId }
  for (const [tabId, st] of s._tabStates) {
    if (tabId !== s._currentTabId && st.securityScanId === scanId) return { tabId }
  }
  return undefined
}

const securityEvents = securityEventHandlers<TabMcpState>({
  findTab: findSecurityTab,
  patchTab: (tabId, patch) => patchTab(tabId, patch),
})

let subscribedApi: McpBridge | null = null
let unsubscribers: Array<() => void> = []

/**
 * Subscribe ONCE to the bridge's event streams. Idempotent per bridge
 * object: called at module load and again on every Connect, so a bridge
 * installed after this module loaded (tests, HMR) is still picked up.
 */
export function ensureMcpEventSubscriptions(): void {
  const api = getMcpApi()
  if (!api || api === subscribedApi) return
  for (const unsub of unsubscribers) {
    try {
      unsub()
    } catch {
      /* the old bridge is gone */
    }
  }
  unsubscribers = []
  subscribedApi = api
  if (api.onNotification) unsubscribers.push(api.onNotification(handleNotification))
  if (api.onFrame) unsubscribers.push(api.onFrame(handleFrame))
  if (api.onConnectionClosed) unsubscribers.push(api.onConnectionClosed(handleConnectionClosed))
  if (api.onSubscriptionState) {
    unsubscribers.push(api.onSubscriptionState(handleSubscriptionState))
  }
  if (api.onOauthStep) unsubscribers.push(api.onOauthStep(handleOAuthStep))
  if (api.onOauthDone) unsubscribers.push(api.onOauthDone(handleOAuthDone))
  if (api.onSecurityProgress) {
    unsubscribers.push(api.onSecurityProgress(securityEvents.onProgress))
  }
  if (api.onSecurityFinding) unsubscribers.push(api.onSecurityFinding(securityEvents.onFinding))
  if (api.onSecurityDone) unsubscribers.push(api.onSecurityDone(securityEvents.onDone))
  // Newer contract member (issue #168) — absent on an older preload / test bridge.
  const callApi = getMcpCallApi()
  if (callApi?.onElicitation) unsubscribers.push(callApi.onElicitation(handleElicitation))
}

// ─── Capability loaders (routed by connectionId) ────────────────────────────

async function loadTools(cid: string): Promise<void> {
  const api = getMcpApi()
  if (!api) return
  try {
    const res = await api.listTools(cid)
    if (res.success && res.data) patchConnection(cid, { tools: res.data })
  } catch {
    /* best-effort — the list stays as it was */
  }
}

async function loadResources(cid: string): Promise<void> {
  const api = getMcpApi()
  if (!api?.listResources) return
  try {
    const res = await api.listResources(cid)
    if (res.success && res.data) {
      patchConnection(cid, {
        resources: res.data.resources ?? [],
        resourceTemplates: res.data.templates ?? [],
      })
    }
  } catch {
    /* best-effort */
  }
}

async function loadPrompts(cid: string): Promise<void> {
  const api = getMcpApi()
  if (!api?.listPrompts) return
  try {
    const res = await api.listPrompts(cid)
    if (res.success && res.data) patchConnection(cid, { prompts: res.data })
  } catch {
    /* best-effort */
  }
}

/** Auto-load after connect; skips what the server's capabilities rule out. */
function loadCapabilities(
  cid: string,
  caps: Record<string, unknown> | undefined,
): Promise<unknown> {
  const has = (key: string): boolean => !caps || key in caps
  return Promise.all([
    has('tools') ? loadTools(cid) : null,
    has('resources') ? loadResources(cid) : null,
    has('prompts') ? loadPrompts(cid) : null,
  ])
}

/**
 * The OAuth token session Connect / Scan name — only while the Authorization
 * tab is set to OAuth 2.1, so switching to Bearer (say) really stops sending
 * the debugger's token instead of having it silently override the new type.
 */
function oauthSessionFor(st: Pick<TabMcpState, 'auth' | 'oauthSessionId'>): string | null {
  return st.auth.type === 'oauth2' ? st.oauthSessionId : null
}

function activeVars(): Record<string, string> {
  return useEnvironmentStore.getState().getActiveVariables()
}

/** Workspace / project of a tools/call — main resolves `{{var}}` in mock templates with it. */
function callContext(): { workspaceId?: string; projectId?: string } {
  const ws = useWorkspaceStore.getState()
  return {
    workspaceId: ws.activeWorkspaceId || undefined,
    projectId: ws.activeProjectId || undefined,
  }
}

const errText = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : fallback

/** The arguments form (not the raw JSON) is what the user edits for this schema (issue #162). */
const formShown = (schema: Record<string, unknown>): boolean =>
  loadArgsView() === 'form' && planArgsForm(schema).ok

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

/** Start time of each running call — the cancelled pill still shows how long it ran. */
const callStarts = new Map<string, number>()

function elapsedSince(callId: string): number {
  const started = callStarts.get(callId)
  callStarts.delete(callId)
  return started === undefined ? 0 : now() - started
}

const CALL_ID_KEY = {
  tool: 'toolCallId',
  resource: 'resourceCallId',
  prompt: 'promptCallId',
} as const

/** What a cancelled call of `kind` leaves on its tab: idle, "Cancelled", no error. */
function cancelledPatch(
  kind: McpCallKind,
  elapsedMs: number,
  res: McpCallReply = { success: false, cancelled: true },
): Partial<TabMcpState> {
  const meta = callMetaOf({ ...res, cancelled: true }, elapsedMs)
  if (kind === 'tool') {
    return {
      toolCallId: null,
      isInvoking: false,
      result: null,
      resultError: null,
      pendingInput: null,
      toolMeta: meta,
      toolTests: null,
    }
  }
  if (kind === 'resource') {
    return {
      resourceCallId: null,
      isReadingResource: false,
      resourceContent: null,
      resourceError: null,
      resourceMeta: meta,
      resourceTests: null,
    }
  }
  return {
    promptCallId: null,
    isGettingPrompt: false,
    promptResult: null,
    promptError: null,
    promptMeta: meta,
    promptTests: null,
  }
}

// ─── Scripts + Tests around a call (issue #160) ─────────────────────────────

/**
 * The script context of a tool call, kept across its `input_required` rounds
 * (the final round — via `respondInput` — runs the post-response checks).
 * Keyed by connection: one tool call per tab at a time, one tab per connection.
 * Each leg passes the context it STARTED with to `toolChecks`, which only
 * drops the entry when it is still that context — a cancelled call's late
 * reply must not delete the next call's context (review item 3).
 */
const toolScriptCtx = new Map<string, McpScriptContext>()

const CALL_ERROR_KEY = {
  tool: 'resultError',
  resource: 'resourceError',
  prompt: 'promptError',
} as const
const CALL_BUSY_KEY = {
  tool: 'isInvoking',
  resource: 'isReadingResource',
  prompt: 'isGettingPrompt',
} as const

/** The call still owns its tab (not cancelled / replaced / closed while a script ran). */
function callIsCurrent(tabId: string | null, kind: McpCallKind, callId: string): boolean {
  return readTab(tabId)?.[CALL_ID_KEY[kind]] === callId
}

/**
 * 2025-era elicitation cards when a call of `kind` ends (review item 6b):
 * they go once NO call of the tab is running any more — a card belongs to a
 * running request, and nothing answers it after the call is over. A call of
 * another kind still running (a tool call waiting on its card while a
 * resource read finishes) keeps them.
 */
function elicitationsAfterEnd(s: TabMcpState, kind: McpCallKind): Partial<TabMcpState> {
  if (s.pendingElicitations.length === 0) return {}
  const othersRunning = (Object.keys(CALL_ID_KEY) as McpCallKind[]).some(
    (k) => k !== kind && s[CALL_ID_KEY[k]] !== null,
  )
  return othersRunning ? {} : { pendingElicitations: [] }
}

/**
 * Apply the patch that ENDS (or may end) a call of `kind` on its tab: when
 * the patch frees the call slot, the tab's elicitation cards go too
 * (`elicitationsAfterEnd`) and main is told `cancel` for them, best effort —
 * so neither the card nor the server's request is left hanging.
 */
function patchEndingCall(
  tabId: string | null,
  kind: McpCallKind,
  patch: (s: TabMcpState) => Partial<TabMcpState>,
): void {
  let dropped: McpPendingElicitation[] = []
  let connectionId: string | null = null
  patchTab(tabId, (s) => {
    const p = patch(s)
    if (!(CALL_ID_KEY[kind] in p) || p[CALL_ID_KEY[kind]] !== null) return p
    const cards = elicitationsAfterEnd(s, kind)
    if (cards.pendingElicitations) {
      dropped = s.pendingElicitations
      connectionId = s.connectionId
    }
    return { ...p, ...cards }
  })
  if (connectionId && dropped.length > 0) answerElicitations(connectionId, dropped, 'cancel')
}

/** `patchEndingCall` on the tab that owns `connectionId`. */
function patchConnectionEndingCall(
  connectionId: string,
  kind: McpCallKind,
  patch: (s: TabMcpState) => Partial<TabMcpState>,
): void {
  const owner = findConnectionTab(connectionId)
  if (owner) patchEndingCall(owner.tabId, kind, patch)
}

/** End a call before it reached the server, with a message in its result area. */
function stopCall(tabId: string | null, kind: McpCallKind, callId: string, message: string): void {
  elapsedSince(callId)
  patchEndingCall(tabId, kind, (s) =>
    s[CALL_ID_KEY[kind]] === callId
      ? {
          [CALL_ID_KEY[kind]]: null,
          [CALL_BUSY_KEY[kind]]: false,
          [CALL_ERROR_KEY[kind]]: message,
        }
      : {},
  )
}

/**
 * Pre-request scripts of a call that has just taken its tab. `true` = go on
 * and call the server; `false` = the call ended here (a script threw, asked
 * to skip, or the user cancelled / switched the call away meanwhile).
 */
async function preScriptsAllow(
  ctx: McpScriptContext,
  kind: McpCallKind,
  callId: string,
): Promise<boolean> {
  const pre = await runMcpPreScripts(ctx)
  if (!callIsCurrent(ctx.tabId, kind, callId)) {
    flushMcpScriptLogs(ctx, '')
    return false
  }
  if (pre.ok) return true
  stopCall(
    ctx.tabId,
    kind,
    callId,
    pre.skipped
      ? t('mcp.script.skipped')
      : t('mcp.script.preError').replace('{error}', pre.message),
  )
  flushMcpScriptLogs(ctx, '')
  return false
}

/** Assertion rows + post-response scripts on a finished call (none on error / cancel / input). */
async function postChecksOf(
  ctx: McpScriptContext,
  outcome: McpCallOutcome,
): Promise<McpTestRun | null> {
  try {
    return await runMcpPostChecks(ctx, outcome)
  } finally {
    flushMcpScriptLogs(ctx, outcome.name)
  }
}

/** A call reply → the shared adapter's outcome (`src/shared/mcp-response.ts`). */
function outcomeOf(
  capability: McpCallOutcome['capability'],
  name: string,
  res: McpCallReply,
): McpCallOutcome {
  return {
    capability,
    name,
    ...(res.success ? { result: res.data } : { error: res.error ?? 'failed' }),
    ...(res.cancelled ? { cancelled: true } : {}),
    ...(res.timing ? { timing: res.timing } : {}),
  }
}

const isToolErrorResult = (data: unknown): boolean =>
  !!data && typeof data === 'object' && (data as { isError?: unknown }).isError === true

/**
 * A finished `tools/call` / `respondInput` leg on the tab that started it:
 * a cancelled reply is "Cancelled" (issue #163), an `input_required` one
 * (re)opens the input card, anything else ends the call with its meta (#164).
 */
function toolReplyPatch(
  s: TabMcpState,
  res: McpCallReply,
  call: { callId: string; toolName: string; args: Record<string, unknown>; round: number },
): Partial<TabMcpState> {
  const elapsed = elapsedSince(call.callId)
  // Cancelled, or a newer call took over this tab: the reply is stale.
  if (s.toolCallId !== call.callId) return {}
  if (res.cancelled) return cancelledPatch('tool', elapsed, res)
  if (s.selectedTool !== call.toolName) return { isInvoking: false, toolCallId: null }
  const leg = toolLegPatch(
    { ...res, ...(res.success ? {} : { error: res.error ?? t('mcp.error.toolCallFailed') }) },
    call,
  )
  return {
    ...leg,
    toolCallId: null,
    toolMeta: leg.pendingInput ? null : callMetaOf(res, elapsed, isToolErrorResult(res.data)),
  }
}

/**
 * The post-response checks of a tool leg — only when it FINISHED the call
 * (not an `input_required` round, an error or a cancel: the adapter returns
 * no response then) and the call still owns its tab. The script context is
 * dropped once the call is over.
 */
async function toolChecks(
  connectionId: string,
  toolName: string,
  callId: string,
  res: McpCallReply,
  ctx: McpScriptContext | undefined,
): Promise<McpTestRun | null> {
  const outcome = outcomeOf('tool', toolName, res)
  const owner = findConnectionTab(connectionId)
  const current = !!owner && readTab(owner.tabId)?.toolCallId === callId
  const pendingInput = res.success && !res.cancelled && inputRequiredOf(res.data) !== null
  // Only this call's own context — a newer call may have replaced it already.
  if (!pendingInput && ctx && toolScriptCtx.get(connectionId) === ctx) {
    toolScriptCtx.delete(connectionId)
  }
  if (!ctx || !current || pendingInput) return null
  return postChecksOf(ctx, outcome)
}

/** The tests go with the patch that ENDS the call (it carries the result meta). */
function withToolTests(
  patch: Partial<TabMcpState>,
  tests: McpTestRun | null,
): Partial<TabMcpState> {
  return 'toolMeta' in patch && patch.toolMeta?.status !== 'cancelled'
    ? { ...patch, toolTests: tests }
    : patch
}

/** History-hidden arg paths whose value in `toolArgs` is still empty (null when none are). */
function stillHidden(paths: readonly string[], toolArgs: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(toolArgs)
  } catch {
    return [...paths]
  }
  const left = paths.filter((p) => {
    const v = valueAtDottedPath(parsed, p)
    return v === undefined || v === ''
  })
  return left.length > 0 ? left : null
}

/** `a.b[0].c` → the value at that path (the paths `history-restore.ts` writes). */
function valueAtDottedPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const part of path.match(/[^.[\]]+/g) ?? []) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export const useMcpStore = create<McpStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  // transient — never restored from disk
  ...disconnectedPatch(),
  notifications: [],
  frames: [],

  setTransport: (transport) => {
    set({ transport })
    markActiveTabDirty()
  },
  setUrl: (url) => {
    set({ url })
    markActiveTabDirty()
  },
  setProtocol: (protocol) => {
    set({ protocol: normalizeMcpProtocol(protocol) })
    markActiveTabDirty()
  },
  addHeader: () => {
    set((state) => ({ customHeaders: [...state.customHeaders, blankRow()] }))
    markActiveTabDirty()
  },
  updateHeader: (id, updates) => {
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveTabDirty()
  },
  removeHeader: (id) => {
    set((state) => ({ customHeaders: state.customHeaders.filter((h) => h.id !== id) }))
    markActiveTabDirty()
  },
  setHeaders: (customHeaders) => {
    set({ customHeaders })
    markActiveTabDirty()
  },
  addEnvVar: () => {
    set((state) => ({ envVars: [...state.envVars, blankRow()] }))
    markActiveTabDirty()
  },
  updateEnvVar: (id, updates) => {
    set((state) => ({
      envVars: state.envVars.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }))
    markActiveTabDirty()
  },
  removeEnvVar: (id) => {
    set((state) => ({ envVars: state.envVars.filter((r) => r.id !== id) }))
    markActiveTabDirty()
  },
  setEnvVars: (envVars) => {
    set({ envVars })
    markActiveTabDirty()
  },
  setAuth: (auth) => {
    set({ auth })
    markActiveTabDirty()
  },
  // Layout only — not part of the Ctrl+S snapshot, so no dirty flag.
  setConfigTab: (configTab) => set({ configTab, configCollapsed: false }),
  setConfigCollapsed: (configCollapsed) => set({ configCollapsed }),
  openOAuthAuthorization: () => {
    const { auth } = get()
    set({ configTab: 'auth', configCollapsed: false })
    if (auth.type !== 'oauth2') get().setAuth({ ...auth, type: 'oauth2' })
  },
  applyServerConfig: (server) => {
    set({
      transport: server.transport,
      url: tabUrlForServer(server),
      customHeaders: recordToRows(server.transport === 'stdio' ? undefined : server.headers),
      envVars: recordToRows(server.transport === 'stdio' ? server.env : undefined),
    })
    markActiveTabDirty()
  },
  setCapabilityTab: (capabilityTab) => set({ capabilityTab }),
  setSearch: (search) => set({ search }),
  setSelectedTool: (selectedTool) => {
    // Re-selecting the selected tool keeps its (saved, edited) arguments —
    // only a different tool starts from the schema's example (issue #159).
    if (selectedTool === get().selectedTool) return
    const tool = selectedTool ? get().tools.find((t) => t.name === selectedTool) : undefined
    // Form view: only required fields + defaults (empty optionals are not sent).
    const example = tool?.inputSchema
      ? generateExampleArgs(tool.inputSchema, { requiredOnly: formShown(tool.inputSchema) })
      : {}
    const toolArgs = JSON.stringify(example, null, 2)
    set({
      selectedTool,
      toolArgs,
      result: null,
      resultError: null,
      pendingInput: null,
      toolMeta: null,
      inputOutcome: null,
      argsProblems: null,
      hiddenArgs: null,
    })
    // The selection (and the args it just reset) is saved with the request (issue #159).
    markActiveTabDirty()
  },
  setToolArgs: (toolArgs) => {
    set({ toolArgs })
    // A History-hidden arg the user has typed again loses its note.
    const hidden = get().hiddenArgs
    if (hidden && get().capabilityTab !== 'prompts') {
      set({ hiddenArgs: stillHidden(hidden, toolArgs) })
    }
    // Problems on screen follow the edit (a fixed field loses its marker).
    const { argsProblems, tools, selectedTool } = get()
    if (argsProblems) {
      const schema = tools.find((tool) => tool.name === selectedTool)?.inputSchema
      const prepared = prepareToolArgs(toolArgs, activeVars(), schema)
      const problems = prepared.error || !schema ? [] : validateArgs(prepared.raw, schema)
      set({ argsProblems: problems.length > 0 ? problems : null })
    }
    // Arguments are saved with the request (issue #159).
    markActiveTabDirty()
  },
  selectResource: (key) => {
    const { resources, resourceTemplates, selectedResourceUri } = get()
    // Re-selecting keeps the (saved, possibly edited) URI draft (issue #159).
    if (key === selectedResourceUri) return
    const resource = resources.find((r) => r.uri === key)
    const template = resource ? undefined : resourceTemplates.find((t) => t.uriTemplate === key)
    set({
      selectedResourceUri: key,
      resourceUriDraft: resource?.uri ?? template?.uriTemplate ?? '',
      resourceContent: null,
      resourceError: null,
      resourceMeta: null,
    })
    markActiveTabDirty()
  },
  setResourceUriDraft: (resourceUriDraft) => {
    set({ resourceUriDraft })
    markActiveTabDirty()
  },
  setSelectedPrompt: (selectedPrompt) => {
    if (selectedPrompt === get().selectedPrompt) return
    set({
      selectedPrompt,
      promptArgs: {},
      promptResult: null,
      promptError: null,
      promptMeta: null,
      hiddenArgs: null,
    })
    markActiveTabDirty()
  },
  setPromptArg: (name, value) => {
    set((s) => {
      // A History-hidden prompt arg the user has typed again loses its note.
      const left = value !== '' ? s.hiddenArgs?.filter((p) => p !== name) : s.hiddenArgs
      return {
        promptArgs: { ...s.promptArgs, [name]: value },
        hiddenArgs: left && left.length > 0 ? left : null,
      }
    })
    markActiveTabDirty()
  },
  clearNotifications: () => set({ notifications: [] }),
  clearFrames: () => set({ frames: [] }),
  setSection: (section) => set({ section }),
  // OAuth fields are not part of the Ctrl+S snapshot — no dirty flag.
  setOAuthClientId: (oauthClientId) => set({ oauthClientId }),
  setOAuthClientSecret: (oauthClientSecret) => set({ oauthClientSecret }),
  setOAuthScope: (oauthScope) => set({ oauthScope }),

  startOAuth: async () => {
    const st = get()
    if (st.oauthRunning) return
    if (st.transport === 'stdio') {
      set({ oauthError: 'OAuth applies to the Streamable HTTP and SSE transports only' })
      return
    }
    if (!st.url.trim()) return
    ensureMcpEventSubscriptions()
    const api = getMcpApi()
    if (!api?.oauthStart) {
      set({ oauthError: 'OAuth is not available' })
      return
    }
    const ownerTabId = st._currentTabId
    // A previous flow's token that is not the one Connect uses goes now.
    if (st.oauthFlowId !== st.oauthSessionId) forgetOAuthSessions([st.oauthFlowId])
    const vars = activeVars()
    const request: McpOAuthStartRequest = {
      url: resolveVariables(st.url, vars).trim(),
      transport: st.transport === 'sse' ? 'sse' : 'http',
    }
    const headers = kvRowsToRecord(st.customHeaders, vars)
    if (Object.keys(headers).length > 0) request.headers = headers
    const clientId = resolveVariables(st.oauthClientId.trim(), vars)
    if (clientId) request.clientId = clientId
    const secret = resolveVariables(st.oauthClientSecret, vars)
    if (secret) request.clientSecret = secret
    const scope = resolveVariables(st.oauthScope.trim(), vars)
    if (scope) request.scope = scope
    set({
      oauthRunning: true,
      oauthFlowId: null,
      oauthSteps: [],
      oauthSummary: null,
      oauthError: null,
      oauthNoAuthRequired: false,
    })
    let res: Awaited<ReturnType<McpBridge['oauthStart']>>
    try {
      res = await api.oauthStart(request)
    } catch (e) {
      res = { success: false, error: errText(e, 'OAuth flow failed to start') }
    }
    if (res.success && res.data) {
      const flowId = res.data.oauthSessionId
      const orphan = oauthOrphans.get(flowId)
      oauthOrphans.delete(flowId)
      patchTab(ownerTabId, (s) => ({
        oauthFlowId: flowId,
        oauthSteps: (orphan?.steps ?? []).reduce(upsertStep, s.oauthSteps),
        ...(orphan?.done ? oauthDonePatch(orphan.done) : {}),
      }))
    } else {
      patchTab(ownerTabId, {
        oauthRunning: false,
        oauthError: res.error ?? 'OAuth flow failed to start',
      })
    }
  },

  cancelOAuth: async () => {
    const { oauthFlowId, oauthRunning } = get()
    const api = getMcpApi()
    if (!oauthRunning || !oauthFlowId || !api?.oauthCancel) return
    try {
      await api.oauthCancel(oauthFlowId)
    } catch {
      /* the flow already finished */
    }
  },

  forgetOAuth: async () => {
    const { oauthFlowId, oauthSessionId } = get()
    set(oauthIdle())
    forgetOAuthSessions([oauthFlowId, oauthSessionId])
  },

  connectWithOAuth: async () => {
    const {
      oauthFlowId,
      oauthSummary,
      oauthSessionId,
      connectionState,
      auth,
      _currentTabId: ownerTabId,
    } = get()
    if (!oauthFlowId || !oauthSummary) return
    if (oauthSessionId !== oauthFlowId) forgetOAuthSessions([oauthSessionId])
    // The token only rides a connection whose Authorization type is OAuth 2.1.
    set({
      oauthSessionId: oauthFlowId,
      ...(auth.type !== 'oauth2' ? { auth: { ...auth, type: 'oauth2' as const } } : {}),
    })
    if (connectionState === 'connected' || connectionState === 'connecting') {
      await get().disconnect()
      // `connect()` works on the LIVE slice: if the user switched tabs while
      // the old connection closed, connecting now would connect the tab they
      // moved to (issue #154, #76 class). The owner keeps its token session
      // and connects on its next Connect.
      if (get()._currentTabId !== ownerTabId) return
    }
    await get().connect()
  },

  // Not part of the Ctrl+S snapshot — no dirty flag.
  setSecurityRateLimitProbe: (securityRateLimitProbe) => set({ securityRateLimitProbe }),

  startSecurityScan: async () => {
    const st = get()
    if (st.securityRunning) return
    if (st.transport === 'stdio') {
      set({
        securityError: 'The security scan applies to the Streamable HTTP and SSE transports only',
      })
      return
    }
    if (!st.url.trim()) return
    ensureMcpEventSubscriptions()
    const api = getMcpApi()
    if (!api?.securityScan) {
      set({ securityError: 'The security scan is not available' })
      return
    }
    const ownerTabId = st._currentTabId
    const vars = activeVars()
    const request: McpSecurityScanRequest = {
      url: resolveVariables(st.url, vars).trim(),
      transport: st.transport === 'sse' ? 'sse' : 'http',
      // One "active probes" opt-in drives both: the rate-limit burst and the
      // tool calls of `auth.request_state_tampering` (issue #152).
      options: {
        rateLimitProbe: st.securityRateLimitProbe,
        toolInvocationProbe: st.securityRateLimitProbe,
      },
    }
    // The tab's current headers and OAuth token session — main strips the
    // credentials for the unauthenticated probes; the token never comes here.
    const headers = kvRowsToRecord(st.customHeaders, vars)
    if (Object.keys(headers).length > 0) request.headers = headers
    // The Authorization tab, resolved exactly as Connect sends it (MCP Auth).
    const scanAuth = resolveMcpAuth(st.auth, vars)
    if (scanAuth) request.auth = scanAuth
    const scanSession = oauthSessionFor(st)
    if (scanSession) request.oauthSessionId = scanSession
    set({ ...securityIdle(), securityRunning: true })
    let res: Awaited<ReturnType<McpBridge['securityScan']>>
    try {
      res = await api.securityScan(request)
    } catch (e) {
      res = { success: false, error: errText(e, 'Security scan failed to start') }
    }
    if (res.success && res.data) {
      const scanId = res.data.scanId
      patchTab(ownerTabId, (s) => ({
        securityScanId: scanId,
        ...claimSecurityOrphans(scanId, s.securityFindings),
      }))
    } else {
      patchTab(ownerTabId, {
        securityRunning: false,
        securityError: res.error ?? 'Security scan failed to start',
      })
    }
  },

  cancelSecurityScan: async () => {
    const { securityScanId, securityRunning } = get()
    const api = getMcpApi()
    if (!securityRunning || !securityScanId || !api?.securityCancel) return
    try {
      await api.securityCancel(securityScanId)
    } catch {
      /* the scan already finished */
    }
  },

  connect: async () => {
    const {
      transport,
      url,
      protocol,
      customHeaders,
      envVars,
      auth,
      oauthSessionId,
      _currentTabId: ownerTabId,
    } = get()
    if (!url.trim()) return
    ensureMcpEventSubscriptions()
    const pendingConnectId = makeId()
    set({
      connectionState: 'connecting',
      errorMessage: null,
      unauthorized: false,
      _pendingConnectId: pendingConnectId,
      notifications: [],
      frames: [],
    })
    const api = getMcpApi()
    if (!api) {
      set({
        connectionState: 'error',
        errorMessage: t('mcp.error.apiUnavailable'),
        _pendingConnectId: undefined,
      })
      return
    }
    // Saved connection → connect options: `{{var}}` resolved in the URL /
    // command line, headers, env and the Authorization tab; stdio split
    // quote-aware. ONE implementation with Run (`src/shared/mcp-call.ts`
    // `buildMcpConnect`), so a request connects the same on Send and Run.
    const params = sendConnectParams(
      { transport, url, customHeaders, envVars, auth, protocol },
      activeVars(),
    )
    const request: McpConnectRequest = { ...params, _pendingId: pendingConnectId }
    // An explicit Connect of a stdio server trusts it for this project's
    // unattended runs on this computer (main, local settings only).
    if (transport === 'stdio') {
      const projectId = callContext().projectId
      if (projectId) request.projectId = projectId
    }
    // OAuth 2.1 (issue #141): main injects the session's token; we only name it.
    if (transport !== 'stdio') {
      const session = oauthSessionFor({ auth, oauthSessionId })
      if (session) request.oauthSessionId = session
    }
    let res: Awaited<ReturnType<McpBridge['connect']>>
    try {
      res = await api.connect(request)
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.connectionFailed')) }
    }
    // Cancelled / disconnected / re-connected while the handshake was in
    // flight: this result is stale. Close a connection nobody owns any more.
    if (readTab(ownerTabId)?._pendingConnectId !== pendingConnectId) {
      if (res.success && res.data) api.disconnect(res.data.connectionId).catch(() => {})
      return
    }
    if (res.success && res.data) {
      const d = res.data
      const orphans = takeOrphans(d.connectionId)
      patchTab(ownerTabId, {
        connectionId: d.connectionId,
        connectionState: 'connected',
        serverName: d.serverName ?? null,
        serverVersion: d.serverVersion ?? null,
        protocolVersion: d.protocolVersion ?? null,
        capabilities: d.capabilities ?? null,
        instructions: d.instructions ?? null,
        errorMessage: null,
        _pendingConnectId: undefined,
        notifications: orphans.notifications,
        frames: orphans.frames,
        ...eraFromConnect(d),
      })
      await loadCapabilities(d.connectionId, d.capabilities)
    } else {
      // A 401 opens the Authorization tab on OAuth 2.1, like Postman does
      // (issue #141). Only a tab with No Auth is switched to OAuth 2.1: a
      // configured Basic / Bearer / API key stays selected (the 401 is more
      // likely a wrong credential), and "Authorize…" switches explicitly.
      const unauthorized = !!res.unauthorized
      patchTab(ownerTabId, (s) => ({
        connectionState: 'error',
        errorMessage: res.error ?? t('mcp.error.connectionFailed'),
        _pendingConnectId: undefined,
        unauthorized,
        ...(unauthorized
          ? {
              configTab: 'auth' as const,
              configCollapsed: false,
              ...(s.auth.type === 'none' ? { auth: { ...s.auth, type: 'oauth2' as const } } : {}),
            }
          : {}),
      }))
    }
    // Console logging is handled by the main-process handler so every
    // protocol routes through the same `console:log` channel — see
    // src/main/ipc/mcp.handler.ts.
  },

  disconnect: async () => {
    const { connectionId, _pendingConnectId, connectionState } = get()
    // Tear the slice down FIRST: a connect() still in flight then sees its
    // pending id gone and drops (and closes) its result, and the close event
    // for this connection finds no owner. Configuration and the message log
    // are kept — only the live connection goes.
    set(disconnectedPatch())
    const api = getMcpApi()
    if (!api) return
    if (connectionState === 'connecting' && _pendingConnectId) {
      try {
        await api.cancelConnect(_pendingConnectId)
      } catch {
        // Engine already finished — the stale-result guard in connect() closes it.
      }
    }
    if (connectionId) {
      try {
        await api.disconnect(connectionId)
      } catch {
        /* already gone */
      }
    }
  },

  listTools: async () => {
    const { connectionId } = get()
    if (connectionId) await loadTools(connectionId)
  },
  listResources: async () => {
    const { connectionId } = get()
    if (connectionId) await loadResources(connectionId)
  },
  listPrompts: async () => {
    const { connectionId } = get()
    if (connectionId) await loadPrompts(connectionId)
  },

  callTool: async (opts) => {
    const { connectionId, selectedTool, toolArgs, tools, toolCallId, url } = get()
    const tabId = get()._currentTabId
    if (!connectionId || !selectedTool || toolCallId) return
    const api = getMcpCallApi()
    if (!api) return
    const schema = tools.find((tool) => tool.name === selectedTool)?.inputSchema
    // The form view checks the arguments first; "Invoke anyway" (force) and
    // the raw JSON view send as typed — negative tests stay possible. Checked
    // before the pre-request script, so invalid args never run it.
    const draft = prepareToolArgs(toolArgs, activeVars(), schema)
    if (!draft.error && !opts?.force && schema && formShown(schema)) {
      const problems = validateArgs(draft.raw, schema)
      if (problems.length > 0) {
        set({ argsProblems: problems })
        return
      }
    }
    const callId = makeId()
    callStarts.set(callId, now())
    // Captured NOW — the request store follows the active tab (issue #76).
    const scripts = beginMcpScripts(tabId, url, get().customHeaders)
    // The call owns the tab from here: Run turns into Cancel during the scripts too.
    set({
      isInvoking: true,
      result: null,
      resultError: null,
      pendingInput: null,
      toolCallId: callId,
      toolMeta: null,
      toolTests: null,
      inputOutcome: null,
      argsProblems: null,
    })
    const ctx = await scripts
    if (!(await preScriptsAllow(ctx, 'tool', callId))) return
    // `{{var}}` resolves in the JSON text (placeholders work anywhere) — with
    // the pre-request script's writes — then values typed into number /
    // boolean fields as `{{var}}` get their schema type back (issue #162).
    const prepared = sendToolCall(selectedTool, toolArgs, mcpSendVars(ctx), schema)
    if (prepared.error) {
      stopCall(tabId, 'tool', callId, t('mcp.error.invalidArgsJson'))
      return
    }
    const args = prepared.call.args
    toolScriptCtx.set(connectionId, ctx)
    let res: McpCallReply
    try {
      res = await api.callTool(connectionId, selectedTool, args, { ...callContext(), callId })
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.toolCallFailed')) }
    }
    const tests = await toolChecks(connectionId, selectedTool, callId, res, ctx)
    // A 2026-07-28 `input_required` answer opens the input card (MRTR).
    patchConnectionEndingCall(connectionId, 'tool', (s) =>
      withToolTests(
        toolReplyPatch(s, res, { callId, toolName: selectedTool, args, round: 1 }),
        tests,
      ),
    )
  },

  respondInput: async (responses) => {
    const { connectionId, pendingInput, toolCallId } = get()
    if (!connectionId || !pendingInput || toolCallId) return
    const api = getMcpCallApi()
    if (!api?.respondInput) {
      set({ pendingInput: { ...pendingInput, error: t('mcp.error.inputUnavailable') } })
      return
    }
    const { toolName, args, requestState, round } = pendingInput
    // The script context of the call this round continues (see `toolChecks`).
    const scriptCtx = toolScriptCtx.get(connectionId)
    // Same round, same card (its key is round + requestState): only the
    // previous attempt's error goes. A decline / cancel is remembered for the
    // note above the result (issue #175).
    const { error: _previous, ...retry } = pendingInput
    const callId = makeId()
    callStarts.set(callId, now())
    set({
      isInvoking: true,
      resultError: null,
      pendingInput: retry,
      toolCallId: callId,
      inputOutcome: outcomeOfResponses(responses),
    })
    let res: McpCallReply
    try {
      res = await api.respondInput(connectionId, toolName, args, requestState, responses, {
        ...callContext(),
        callId,
      })
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.toolCallFailed')) }
    }
    const tests = res.success
      ? await toolChecks(connectionId, toolName, callId, res, scriptCtx)
      : null
    patchConnectionEndingCall(connectionId, 'tool', (s) => {
      // A failed answer keeps the card and the typed answers for a retry
      // (issue #154) — `toolLegPatch` would close it.
      if (
        s.toolCallId === callId &&
        !res.success &&
        !res.cancelled &&
        s.selectedTool === toolName
      ) {
        elapsedSince(callId)
        return {
          isInvoking: false,
          toolCallId: null,
          inputOutcome: null,
          pendingInput: s.pendingInput
            ? { ...s.pendingInput, error: res.error ?? t('mcp.error.toolCallFailed') }
            : null,
        }
      }
      return withToolTests(
        toolReplyPatch(s, res, { callId, toolName, args, round: round + 1 }),
        tests,
      )
    })
  },

  dismissInput: () => set({ pendingInput: null }),

  readResource: async () => {
    const { connectionId, resourceUriDraft, selectedResourceUri, resourceCallId, url } = get()
    const tabId = get()._currentTabId
    if (!connectionId || resourceCallId) return
    const api = getMcpCallApi()
    const draft = resourceUriDraft.trim()
    if (!draft) return
    if (!api?.readResource) {
      set({ resourceError: t('mcp.error.readUnavailable'), resourceContent: null })
      return
    }
    const callId = makeId()
    callStarts.set(callId, now())
    const scripts = beginMcpScripts(tabId, url, get().customHeaders)
    set({
      isReadingResource: true,
      resourceContent: null,
      resourceError: null,
      resourceCallId: callId,
      resourceMeta: null,
      resourceTests: null,
    })
    const ctx = await scripts
    if (!(await preScriptsAllow(ctx, 'resource', callId))) return
    // `{{var}}` with the pre-request script's writes — the same rule Run
    // applies (`src/shared/mcp-call.ts`).
    const resolved = sendResourceUri(draft, mcpSendVars(ctx))
    if (resolved.error) {
      const key = resolved.error === 'template' ? 'mcp.error.uriTemplate' : 'mcp.error.uriEmpty'
      stopCall(tabId, 'resource', callId, t(key))
      return
    }
    const uri = resolved.uri
    let res: McpCallReply<McpReadResourceResult>
    try {
      // Scope ids too, so the History row lands in this project (issue #166).
      res = await api.readResource(connectionId, uri, { ...callContext(), callId })
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.readFailed')) }
    }
    const tests = callIsCurrent(tabId, 'resource', callId)
      ? await postChecksOf(ctx, outcomeOf('resource', uri, res))
      : null
    patchConnectionEndingCall(connectionId, 'resource', (s) => {
      const elapsed = elapsedSince(callId)
      if (s.resourceCallId !== callId) return {}
      if (res.cancelled) return cancelledPatch('resource', elapsed, res)
      const meta = callMetaOf(res, elapsed)
      if (s.selectedResourceUri !== selectedResourceUri) {
        return { isReadingResource: false, resourceCallId: null }
      }
      return res.success && res.data
        ? {
            resourceContent: res.data,
            resourceError: null,
            isReadingResource: false,
            resourceCallId: null,
            resourceMeta: meta,
            resourceTests: tests,
          }
        : {
            resourceContent: null,
            resourceError: res.error ?? t('mcp.error.readFailed'),
            isReadingResource: false,
            resourceCallId: null,
            resourceMeta: meta,
          }
    })
  },

  getPrompt: async () => {
    const { connectionId, selectedPrompt, promptArgs, prompts, promptCallId, url } = get()
    const tabId = get()._currentTabId
    if (!connectionId || !selectedPrompt || promptCallId) return
    const api = getMcpCallApi()
    const def = prompts.find((p) => p.name === selectedPrompt)
    const typed = Object.entries(promptArgs).filter(([, v]) => v !== '')
    const missing = (def?.arguments ?? []).filter(
      (a) => a.required && !typed.some(([k]) => k === a.name),
    )
    if (missing.length > 0) {
      set({
        promptError: t('mcp.error.promptMissingArg').replace(
          '{names}',
          missing.map((a) => a.name).join(', '),
        ),
      })
      return
    }
    if (!api?.getPrompt) {
      set({ promptError: t('mcp.error.promptUnavailable'), promptResult: null })
      return
    }
    const callId = makeId()
    callStarts.set(callId, now())
    const scripts = beginMcpScripts(tabId, url, get().customHeaders)
    set({
      isGettingPrompt: true,
      promptResult: null,
      promptError: null,
      promptCallId: callId,
      promptMeta: null,
      promptTests: null,
    })
    const ctx = await scripts
    if (!(await preScriptsAllow(ctx, 'prompt', callId))) return
    // `{{var}}` with the pre-request script's writes.
    const { args } = sendPromptCall(selectedPrompt, promptArgs, mcpSendVars(ctx))
    let res: McpCallReply<McpGetPromptResult>
    try {
      res = await api.getPrompt(connectionId, selectedPrompt, args, { ...callContext(), callId })
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.promptFailed')) }
    }
    const tests = callIsCurrent(tabId, 'prompt', callId)
      ? await postChecksOf(ctx, outcomeOf('prompt', selectedPrompt, res))
      : null
    patchConnectionEndingCall(connectionId, 'prompt', (s) => {
      const elapsed = elapsedSince(callId)
      if (s.promptCallId !== callId) return {}
      if (res.cancelled) return cancelledPatch('prompt', elapsed, res)
      const meta = callMetaOf(res, elapsed)
      if (s.selectedPrompt !== selectedPrompt) return { isGettingPrompt: false, promptCallId: null }
      return res.success && res.data
        ? {
            promptResult: res.data,
            promptError: null,
            isGettingPrompt: false,
            promptCallId: null,
            promptMeta: meta,
            promptTests: tests,
          }
        : {
            promptResult: null,
            promptError: res.error ?? t('mcp.error.promptFailed'),
            isGettingPrompt: false,
            promptCallId: null,
            promptMeta: meta,
          }
    })
  },

  cancelCall: async (kind) => {
    const s = get()
    const callId = s[CALL_ID_KEY[kind]]
    const { connectionId } = s
    if (!callId || !connectionId) return
    // Free THIS tab now — a server that ignores the cancel must not keep the
    // button stuck; main's reply for `callId` is then stale and dropped.
    // Elicitations the cancelled call was waiting on go with it (main
    // withdraws them too, `mcpCancelCall`).
    patchEndingCall(s._currentTabId, kind, () => cancelledPatch(kind, elapsedSince(callId)))
    const api = getMcpCallApi()
    try {
      await api?.cancelCall?.(connectionId, callId)
    } catch {
      /* the call already finished */
    }
  },

  runPrimaryAction: () => {
    const s = get()
    if (s.connectionState !== 'connected') return
    if (s.capabilityTab === 'resources') {
      if (s.selectedResourceUri !== null || s.resourceUriDraft.trim()) void s.readResource()
    } else if (s.capabilityTab === 'prompts') {
      void s.getPrompt()
    } else {
      void s.callTool()
    }
  },

  respondElicitation: async (elicitationId, action, content) => {
    const { connectionId, pendingElicitations } = get()
    const pending = pendingElicitations.find((e) => e.elicitationId === elicitationId)
    if (!connectionId || !pending || pending.sending) return
    const api = getMcpCallApi()
    if (!api?.respondElicitation) {
      set({
        pendingElicitations: pendingElicitations.map((e) =>
          e.elicitationId === elicitationId
            ? { ...e, error: t('mcp.error.elicitationUnavailable') }
            : e,
        ),
      })
      return
    }
    set({
      pendingElicitations: pendingElicitations.map((e) =>
        e.elicitationId === elicitationId ? { ...e, sending: true, error: undefined } : e,
      ),
    })
    const answer = action === 'accept' ? { action, content: content ?? {} } : { action }
    let res: { success: boolean; error?: string }
    try {
      res = await api.respondElicitation(connectionId, elicitationId, answer)
    } catch (e) {
      res = { success: false, error: errText(e, t('mcp.error.elicitationFailed')) }
    }
    // Main no longer holds it (answered, timed out, withdrawn, call over):
    // the card has nothing left to answer — drop it instead of an error.
    const gone = !res.success && /No pending elicitation/i.test(res.error ?? '')
    patchConnection(connectionId, (s) => {
      if (!s.pendingElicitations.some((e) => e.elicitationId === elicitationId)) return {}
      if (gone) {
        return {
          pendingElicitations: s.pendingElicitations.filter(
            (e) => e.elicitationId !== elicitationId,
          ),
        }
      }
      if (!res.success) {
        return {
          pendingElicitations: s.pendingElicitations.map((e) =>
            e.elicitationId === elicitationId
              ? { ...e, sending: false, error: res.error ?? t('mcp.error.elicitationFailed') }
              : e,
          ),
        }
      }
      const outcome = outcomeOfAction(action)
      return {
        pendingElicitations: s.pendingElicitations.filter((e) => e.elicitationId !== elicitationId),
        ...(outcome ? { inputOutcome: outcome } : {}),
      }
    })
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)
    if (state._currentTabId) tabStates.set(state._currentTabId, extractState(state))
    const target = tabStates.get(tabId) ?? emptyState()
    set({ ...target, _tabStates: tabStates, _currentTabId: tabId })
  },

  removeTabState: (tabId) => {
    const s = get()
    const isLive = s._currentTabId === tabId
    // Close the tab's connection whether it is the live slice or a cached one.
    const tab = isLive ? extractState(s) : s._tabStates.get(tabId)
    const cid = tab?.connectionId
    if (isLive) {
      // Tear the live slice down FIRST, like disconnect(): a connect() still in
      // flight then sees its pending id gone and closes its late result instead
      // of attaching it to a tab that no longer exists. `_currentTabId: null`
      // keeps the next switchToTab from caching the dead tab back.
      set({ ...disconnectedPatch(), ...securityIdle(), ...oauthIdle(), _currentTabId: null })
      if (tab?.connectionState === 'connecting' && tab._pendingConnectId) {
        getMcpApi()
          ?.cancelConnect(tab._pendingConnectId)
          .catch(() => {})
      }
    }
    // The tab's OAuth tokens die with it, and so does a running scan.
    if (tab) forgetOAuthSessions([tab.oauthFlowId, tab.oauthSessionId])
    // …and the elicitations it was asked (issue #168): the server is waiting.
    if (cid && tab && tab.pendingElicitations.length > 0) {
      answerElicitations(cid, tab.pendingElicitations, 'cancel')
    }
    if (tab?.securityRunning && tab.securityScanId) {
      getMcpApi()
        ?.securityCancel?.(tab.securityScanId)
        .catch(() => {})
    }
    if (cid) {
      getMcpApi()
        ?.disconnect(cid)
        .catch(() => {})
    }
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

/**
 * Put a saved call (issue #159) on the LIVE slice — reopen from the tree
 * (`restoreProtocolFromMetadata`) and from History (#166). Written with
 * `setState`, not the setters: those regenerate example args / reset the URI
 * draft from the (still empty) capability lists and flag the tab dirty, and
 * a restore is not an edit. Fields the snapshot lacks keep their value.
 */
export function restoreMcpCall(call: McpSavedCall): void {
  const patch: Partial<TabMcpState> = {}
  if (call.capabilityTab) patch.capabilityTab = call.capabilityTab
  if (call.selectedTool !== undefined) patch.selectedTool = call.selectedTool
  if (call.toolArgs !== undefined) patch.toolArgs = call.toolArgs
  if (call.selectedResourceUri !== undefined) patch.selectedResourceUri = call.selectedResourceUri
  if (call.resourceUriDraft !== undefined) patch.resourceUriDraft = call.resourceUriDraft
  if (call.selectedPrompt !== undefined) patch.selectedPrompt = call.selectedPrompt
  if (call.promptArgs !== undefined) patch.promptArgs = call.promptArgs
  useMcpStore.setState(patch)
}

attachTabbedPersist(
  useMcpStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistable,
)

ensureMcpEventSubscriptions()
