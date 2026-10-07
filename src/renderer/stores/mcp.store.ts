import { create } from 'zustand'
import type { KeyValuePair } from '../types'
import type {
  McpBridge,
  McpCapabilityTab,
  McpConnectRequest,
  McpConnectionClosedEvent,
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
  McpReadResourceResult,
  McpResource,
  McpResourceTemplate,
  McpSecurityScanRequest,
  McpTool,
  McpTransport,
} from '../types/mcp'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { getMcpApi } from '../lib/mcp-api'
import { parseCommandLine } from '../lib/mcp-command-line'
import { tabUrlForServer, type ParsedMcpServer } from '../lib/mcp-config'
import {
  blankRow,
  generateExampleArgs,
  hasUnexpandedTemplate,
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

export type { McpTransport, McpTool } from '../types/mcp'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Right-pane section ids (`McpEditor` tabs; extra ids come from `mcp/sections.ts`). */
export const MCP_EXPLORER_SECTION = 'explorer'
export const MCP_OAUTH_SECTION = 'oauth'
export const MCP_SECURITY_SECTION = 'security'

export interface TabMcpState extends McpSecurityTabState {
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
  /** The last connect failed with HTTP 401 — the OAuth section offers itself (issue #141). */
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
  /** Opt-in for the rate-limit probe (persisted per tab, not part of Ctrl+S). */
  setSecurityRateLimitProbe: (v: boolean) => void
  /** Run the MCP Security Scan against this tab's server (issue #142). */
  startSecurityScan: () => Promise<void>
  cancelSecurityScan: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  listTools: () => Promise<void>
  listResources: () => Promise<void>
  listPrompts: () => Promise<void>
  callTool: () => Promise<void>
  readResource: () => Promise<void>
  getPrompt: () => Promise<void>
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
}

/** Configuration + per-tab UI state — survives disconnect. */
type McpConfigKeys =
  | 'transport'
  | 'url'
  | 'customHeaders'
  | 'envVars'
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
    selectedTool: null,
    toolArgs: '{}',
    result: null,
    resultError: null,
    isInvoking: false,
    selectedResourceUri: null,
    resourceUriDraft: '',
    resourceContent: null,
    resourceError: null,
    isReadingResource: false,
    selectedPrompt: null,
    promptArgs: {},
    promptResult: null,
    promptError: null,
    isGettingPrompt: false,
    _pendingConnectId: undefined,
    unauthorized: false,
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
    capabilityTab: 'tools',
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
  }
}

function extractState(s: TabMcpState): TabMcpState {
  return {
    transport: s.transport,
    url: s.url,
    customHeaders: s.customHeaders,
    envVars: s.envVars,
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

function handleConnectionClosed(evt: McpConnectionClosedEvent): void {
  if (!evt || typeof evt.connectionId !== 'string') return
  orphanLogs.delete(evt.connectionId)
  patchConnection(evt.connectionId, {
    ...disconnectedPatch(),
    connectionState: evt.reason ? 'error' : 'disconnected',
    errorMessage: evt.reason ?? null,
  })
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
  if (api.onOauthStep) unsubscribers.push(api.onOauthStep(handleOAuthStep))
  if (api.onOauthDone) unsubscribers.push(api.onOauthDone(handleOAuthDone))
  if (api.onSecurityProgress) {
    unsubscribers.push(api.onSecurityProgress(securityEvents.onProgress))
  }
  if (api.onSecurityFinding) unsubscribers.push(api.onSecurityFinding(securityEvents.onFinding))
  if (api.onSecurityDone) unsubscribers.push(api.onSecurityDone(securityEvents.onDone))
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

function activeVars(): Record<string, string> {
  return useEnvironmentStore.getState().getActiveVariables()
}

const errText = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : fallback

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
    const tool = selectedTool ? get().tools.find((t) => t.name === selectedTool) : undefined
    const example = tool?.inputSchema ? generateExampleArgs(tool.inputSchema) : {}
    const toolArgs = JSON.stringify(example, null, 2)
    set({ selectedTool, toolArgs, result: null, resultError: null })
  },
  setToolArgs: (toolArgs) => set({ toolArgs }),
  selectResource: (key) => {
    const { resources, resourceTemplates } = get()
    const resource = resources.find((r) => r.uri === key)
    const template = resource ? undefined : resourceTemplates.find((t) => t.uriTemplate === key)
    set({
      selectedResourceUri: key,
      resourceUriDraft: resource?.uri ?? template?.uriTemplate ?? '',
      resourceContent: null,
      resourceError: null,
    })
  },
  setResourceUriDraft: (resourceUriDraft) => set({ resourceUriDraft }),
  setSelectedPrompt: (selectedPrompt) =>
    set({ selectedPrompt, promptArgs: {}, promptResult: null, promptError: null }),
  setPromptArg: (name, value) => set((s) => ({ promptArgs: { ...s.promptArgs, [name]: value } })),
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
    const { oauthFlowId, oauthSummary, oauthSessionId, connectionState } = get()
    if (!oauthFlowId || !oauthSummary) return
    if (oauthSessionId !== oauthFlowId) forgetOAuthSessions([oauthSessionId])
    set({ oauthSessionId: oauthFlowId })
    if (connectionState === 'connected' || connectionState === 'connecting') {
      await get().disconnect()
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
      options: { rateLimitProbe: st.securityRateLimitProbe },
    }
    // The tab's current headers and OAuth token session — main strips the
    // credentials for the unauthenticated probes; the token never comes here.
    const headers = kvRowsToRecord(st.customHeaders, vars)
    if (Object.keys(headers).length > 0) request.headers = headers
    if (st.oauthSessionId) request.oauthSessionId = st.oauthSessionId
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
      customHeaders,
      envVars,
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
        errorMessage: 'API not available',
        _pendingConnectId: undefined,
      })
      return
    }
    // Resolve `{{var}}` placeholders in the server URL the same way HTTP /
    // SOAP / GraphQL do — otherwise users can't parameterise local stdio /
    // SSE endpoints via environments.
    const vars = activeVars()
    const resolvedUrl = resolveVariables(url, vars)
    const request: McpConnectRequest = { transport, url: resolvedUrl, _pendingId: pendingConnectId }
    if (transport === 'stdio') {
      // The URL field holds the command line; split it here (quote-aware) so
      // an argument containing a space survives — the engine only splits the
      // `command` string on whitespace, `args` pass through untouched.
      const { command, args } = parseCommandLine(resolvedUrl)
      if (command) {
        request.command = command
        request.args = args
      }
      const env = kvRowsToRecord(envVars, vars)
      if (Object.keys(env).length > 0) request.env = env
    } else {
      // Custom headers (issue #137): enabled rows with a key, `{{var}}`
      // resolved in both key and value. stdio has no HTTP layer.
      const headers = kvRowsToRecord(customHeaders, vars)
      if (Object.keys(headers).length > 0) request.headers = headers
      // OAuth 2.1 (issue #141): main injects the session's token; we only name it.
      if (oauthSessionId) request.oauthSessionId = oauthSessionId
    }
    let res: Awaited<ReturnType<McpBridge['connect']>>
    try {
      res = await api.connect(request)
    } catch (e) {
      res = { success: false, error: errText(e, 'Connection failed') }
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
      })
      await loadCapabilities(d.connectionId, d.capabilities)
    } else {
      // A 401 opens the OAuth 2.1 section, like Postman does (issue #141).
      const unauthorized = !!res.unauthorized
      patchTab(ownerTabId, {
        connectionState: 'error',
        errorMessage: res.error ?? 'Connection failed',
        _pendingConnectId: undefined,
        unauthorized,
        ...(unauthorized ? { section: MCP_OAUTH_SECTION } : {}),
      })
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

  callTool: async () => {
    const { connectionId, selectedTool, toolArgs } = get()
    if (!connectionId || !selectedTool) return
    const api = getMcpApi()
    if (!api) return
    // Resolve `{{var}}` in the JSON text before parsing so users can put
    // env / global / dynamic placeholders anywhere in the args body.
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(resolveVariables(toolArgs, activeVars()))
    } catch {
      set({ resultError: 'Invalid JSON in arguments', result: null })
      return
    }
    set({ isInvoking: true, result: null, resultError: null })
    const ws = useWorkspaceStore.getState()
    let res: Awaited<ReturnType<McpBridge['callTool']>>
    try {
      res = await api.callTool(connectionId, selectedTool, args, {
        workspaceId: ws.activeWorkspaceId || undefined,
        projectId: ws.activeProjectId || undefined,
      })
    } catch (e) {
      res = { success: false, error: errText(e, 'Tool call failed') }
    }
    patchConnection(connectionId, (s) =>
      s.selectedTool !== selectedTool
        ? { isInvoking: false }
        : res.success
          ? { result: res.data, resultError: null, isInvoking: false }
          : { result: null, resultError: res.error ?? 'Tool call failed', isInvoking: false },
    )
  },

  readResource: async () => {
    const { connectionId, resourceUriDraft, selectedResourceUri } = get()
    if (!connectionId) return
    const api = getMcpApi()
    const uri = resolveVariables(resourceUriDraft.trim(), activeVars())
    if (!uri) return
    if (hasUnexpandedTemplate(uri)) {
      set({
        resourceError: 'Replace the {placeholders} in the URI template first',
        resourceContent: null,
      })
      return
    }
    if (!api?.readResource) {
      set({ resourceError: 'resources/read is not available', resourceContent: null })
      return
    }
    set({ isReadingResource: true, resourceContent: null, resourceError: null })
    let res: Awaited<ReturnType<NonNullable<McpBridge['readResource']>>>
    try {
      res = await api.readResource(connectionId, uri)
    } catch (e) {
      res = { success: false, error: errText(e, 'Read failed') }
    }
    patchConnection(connectionId, (s) =>
      s.selectedResourceUri !== selectedResourceUri
        ? { isReadingResource: false }
        : res.success && res.data
          ? { resourceContent: res.data, resourceError: null, isReadingResource: false }
          : {
              resourceContent: null,
              resourceError: res.error ?? 'Read failed',
              isReadingResource: false,
            },
    )
  },

  getPrompt: async () => {
    const { connectionId, selectedPrompt, promptArgs, prompts } = get()
    if (!connectionId || !selectedPrompt) return
    const api = getMcpApi()
    const def = prompts.find((p) => p.name === selectedPrompt)
    const vars = activeVars()
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(promptArgs)) {
      if (v !== '') args[k] = resolveVariables(v, vars)
    }
    const missing = (def?.arguments ?? []).filter((a) => a.required && !args[a.name])
    if (missing.length > 0) {
      set({ promptError: `Missing required argument: ${missing.map((a) => a.name).join(', ')}` })
      return
    }
    if (!api?.getPrompt) {
      set({ promptError: 'prompts/get is not available', promptResult: null })
      return
    }
    set({ isGettingPrompt: true, promptResult: null, promptError: null })
    let res: Awaited<ReturnType<NonNullable<McpBridge['getPrompt']>>>
    try {
      res = await api.getPrompt(connectionId, selectedPrompt, args)
    } catch (e) {
      res = { success: false, error: errText(e, 'Get prompt failed') }
    }
    patchConnection(connectionId, (s) =>
      s.selectedPrompt !== selectedPrompt
        ? { isGettingPrompt: false }
        : res.success && res.data
          ? { promptResult: res.data, promptError: null, isGettingPrompt: false }
          : {
              promptResult: null,
              promptError: res.error ?? 'Get prompt failed',
              isGettingPrompt: false,
            },
    )
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
    // Close the tab's connection whether it is the live slice or a cached one.
    const tab = s._currentTabId === tabId ? extractState(s) : s._tabStates.get(tabId)
    const cid = tab?.connectionId
    // The tab's OAuth tokens die with it, and so does a running scan.
    if (tab) forgetOAuthSessions([tab.oauthFlowId, tab.oauthSessionId])
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

attachTabbedPersist(
  useMcpStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistable,
)

ensureMcpEventSubscriptions()
