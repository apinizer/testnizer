import { create } from 'zustand'
import type {
  WsdlParseResult,
  WsdlService,
  WsdlPort,
  WsdlOperation,
  WsSecurityConfig,
  ApiResponse,
} from '../types'
import { useResponseStore } from './response.store'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { stripWsSecuritySecrets } from '../lib/key-material'
import { reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { cloneTabSlice } from '../lib/tab-clone'
import {
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { urlCredentialText } from '../lib/credential-text'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs, resolveAuth } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { soapMaskedSendError } from '../lib/masked-send-guard'
import { resolveInheritance } from '../lib/auth-inheritance'
// The SOAP editor's Auth tab is the shared request-store AuthTab (issue #298
// follow-up) — its auth is sent like HTTP Send's.
import { useRequestStore } from './request.store'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for SOAP, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'
import {
  soapTransportFromHeaders,
  soapVersionAndAction,
  withSoapTransportHeaders,
} from '../../shared/soap-transport'
import { isWsSecurityEnabled, resolveWsSecurityVariables } from '../../shared/soap-wsse'

/** SOAP metadata stored in endpoint request_schema.soap */
interface SoapEndpointMeta {
  wsdlUrl?: string
  serviceName?: string
  portName?: string
  operationName?: string
  soapAction?: string
  soapVersion?: 'soap11' | 'soap12'
  endpointUrl?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  exampleRequest?: string
  exampleResponse?: string
}

/** Snapshot of SOAP state for per-tab caching */
interface TabSoapState extends WithheldState {
  wsdlUrl: string
  parsedWsdl: WsdlParseResult | null
  selectedService: string | null
  selectedPort: string | null
  selectedOperation: string | null
  formValues: Record<string, string>
  rawXml: string
  bodyMode: 'form' | 'raw'
  wsSecurity: WsSecurityConfig
  endpointUrl: string
  /** Manual-mode SOAP Action + version — no WSDL operation to read them from
   *  (issue #17). Persisted per tab so they survive close/reopen. */
  manualSoapAction: string
  manualSoapVersion: 'soap11' | 'soap12'
  /** WSDL Import vs Manual editor mode — used to be component-local in
   *  SoapEditor, so every reopen landed on WSDL Import (issue #124). */
  mode: SoapMode
  /** Manual-form operation name/namespace feeding "Generate Envelope"; were
   *  component-local and reset to the sample defaults on reopen (issue #124). */
  manualOperationName: string
  manualOperationNamespace: string
}

export type SoapMode = 'wsdl' | 'manual'

interface SoapStore extends WithheldState {
  wsdlUrl: string
  parsedWsdl: WsdlParseResult | null
  isLoading: boolean
  parseError: string | null
  /** request:send IPC id for the in-flight SOAP call (used for cancel). */
  _inflightRequestId: string | null

  selectedService: string | null
  selectedPort: string | null
  selectedOperation: string | null

  formValues: Record<string, string>
  rawXml: string
  bodyMode: 'form' | 'raw'

  wsSecurity: WsSecurityConfig

  /** The resolved SOAP endpoint URL (for sending) */
  endpointUrl: string

  /** Manual-mode SOAP Action + version (issue #17) */
  manualSoapAction: string
  manualSoapVersion: 'soap11' | 'soap12'
  mode: SoapMode
  manualOperationName: string
  manualOperationNamespace: string

  /** Per-tab state cache */
  _tabStates: Map<string, TabSoapState>
  _currentTabId: string | null

  setWsdlUrl: (url: string) => void
  parseWsdl: () => Promise<void>
  selectService: (name: string) => void
  selectPort: (name: string) => void
  selectOperation: (name: string) => void
  setFormValue: (key: string, value: string) => void
  setFormValues: (values: Record<string, string>) => void
  setRawXml: (xml: string) => void
  setBodyMode: (mode: 'form' | 'raw') => void
  setEndpointUrl: (url: string) => void
  setManualSoapAction: (action: string) => void
  setManualSoapVersion: (v: 'soap11' | 'soap12') => void
  setMode: (mode: SoapMode) => void
  setManualOperationName: (name: string) => void
  setManualOperationNamespace: (ns: string) => void
  setWsSecurity: (config: Partial<WsSecurityConfig>) => void
  sendSoap: () => Promise<void>
  cancelSoap: () => Promise<void>
  reset: () => void

  /** Load SOAP data from an imported endpoint's request_schema */
  loadFromEndpoint: (data: {
    url: string
    body?: { type: string; content?: string }
    headers?: Array<{ key: string; value: string; enabled: boolean }>
    soap?: SoapEndpointMeta
  }) => void

  /** Switch active tab — saves current state and loads target tab state */
  /** Duplicate Tab: copy a tab's slice onto a new tab id, disconnected. */
  cloneTabState: (srcTabId: string, dstTabId: string) => void
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab */
  removeTabState: (tabId: string) => void

  getSelectedService: () => WsdlService | undefined
  getSelectedPort: () => WsdlPort | undefined
  getSelectedOperation: () => WsdlOperation | undefined
}

const defaultWsSecurity: WsSecurityConfig = {
  enabled: false,
  modes: [],
  signFirst: true,
  usernameToken: {
    username: '',
    password: '',
    passwordType: 'PasswordText',
    nonce: false,
    created: false,
  },
  timestamp: { ttlSeconds: 300 },
  sign: {
    privateKeyPem: '',
    certPem: '',
    algorithm: 'RSA-SHA256',
    references: ['Body'],
    keyInfoStrategy: 'BinarySecurityToken',
  },
  encrypt: {
    recipientCertPem: '',
    algorithm: 'AES-256-CBC',
    keyWrap: 'RSA-OAEP',
  },
}

function extractSoapTabState(s: SoapStore): TabSoapState {
  return {
    wsdlUrl: s.wsdlUrl,
    parsedWsdl: s.parsedWsdl,
    selectedService: s.selectedService,
    selectedPort: s.selectedPort,
    selectedOperation: s.selectedOperation,
    formValues: s.formValues,
    rawXml: s.rawXml,
    bodyMode: s.bodyMode,
    wsSecurity: s.wsSecurity,
    endpointUrl: s.endpointUrl,
    manualSoapAction: s.manualSoapAction,
    manualSoapVersion: s.manualSoapVersion,
    mode: s.mode,
    manualOperationName: s.manualOperationName,
    manualOperationNamespace: s.manualOperationNamespace,
    withheldCredentials: s.withheldCredentials,
  }
}

function emptySoapTabState(): TabSoapState {
  return {
    wsdlUrl: '',
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    formValues: {},
    rawXml: '',
    bodyMode: 'raw',
    wsSecurity: { ...defaultWsSecurity },
    endpointUrl: '',
    manualSoapAction: '',
    manualSoapVersion: 'soap11',
    mode: 'wsdl',
    manualOperationName: 'Echo',
    manualOperationNamespace: 'http://example.com/echo',
    withheldCredentials: [],
  }
}

/**
 * Issue #247: the WS-Security UsernameToken password (and the legacy
 * single-mode `password`), pasted private keys and URL credentials of the
 * endpoint / WSDL URL never reach the tab snapshot as typed; a
 * `{{var}}`-only value is kept. The saved row keeps it (`meta.soap.wsSecurity`)
 * — `lib/withheld-credentials.ts` reloads it after a restart.
 */
export const SOAP_CREDENTIALS: CredentialSpec = {
  fields: [
    'wsSecurity.usernameToken.password',
    'wsSecurity.password',
    // Private key material never sits in localStorage (the keystore-bridge
    // rule): a pasted signing key, the inline key of a key source. The
    // certificates are public and stay.
    'wsSecurity.sign.privateKeyPem',
    'wsSecurity.sign.keySource.keyPem',
  ],
  rows: [],
  texts: [urlCredentialText('endpointUrl'), urlCredentialText('wsdlUrl')],
}

/**
 * On-disk view of a tab: the picker's store/key passwords are WRITE-ONLY
 * (#60) and the UsernameToken password is withheld (#247). Also applied on
 * load, so a snapshot an older build wrote is cleaned at once.
 */
function persistableSoap(st: TabSoapState): TabSoapState {
  const wsSecurity = stripWsSecuritySecrets(st.wsSecurity)
  const stripped = wsSecurity === st.wsSecurity ? st : { ...st, wsSecurity }
  return withholdCredentials(stripped, SOAP_CREDENTIALS)
}

/** What Duplicate Tab copies: the whole slice — it holds no request in flight. */
const idleSoap = (st: TabSoapState): TabSoapState => ({ ...st })

const STORAGE_KEY = 'testnizer-soap'
const persisted = loadTabbedState<TabSoapState>(STORAGE_KEY, emptySoapTabState, persistableSoap)

/**
 * Where Send posts a SOAP request, with which version and action — ONE
 * helper for `sendSoap` and Generate Code (issue #280), so the snippet cannot
 * drift from the request. In Manual mode the form's Endpoint URL is
 * authoritative (a WSDL loaded earlier must not hijack it — issue #124); the
 * version / action come from the selected WSDL operation, otherwise from the
 * manual form (issue #17). Transport: SOAP 1.1 → quoted `SOAPAction` header,
 * SOAP 1.2 → `action="…"` in the Content-Type (`soapTransportHeaders`).
 */
export function soapSendTarget(
  s: Pick<
    SoapStore,
    | 'mode'
    | 'endpointUrl'
    | 'parsedWsdl'
    | 'manualSoapAction'
    | 'manualSoapVersion'
    | 'getSelectedOperation'
    | 'getSelectedPort'
  >,
): {
  op: WsdlOperation | undefined
  endpointUrl: string
  version: 'soap11' | 'soap12'
  action: string
} {
  const manualMode = s.mode === 'manual'
  const op = manualMode ? undefined : s.getSelectedOperation()
  const port = manualMode ? undefined : s.getSelectedPort()
  const endpointUrl = manualMode
    ? s.endpointUrl || port?.endpointUrl || s.parsedWsdl?.endpointUrl || ''
    : port?.endpointUrl || s.parsedWsdl?.endpointUrl || s.endpointUrl || ''
  // Version + action: the shared rule the Runner applies to the saved row
  // (`soapTransportForRow`, issue #298 follow-up) — one source, no drift.
  const { version, action } = soapVersionAndAction({
    op,
    wsdlVersion: s.parsedWsdl?.soapVersion,
    manualSoapAction: s.manualSoapAction,
    manualSoapVersion: s.manualSoapVersion,
  })
  return { op, endpointUrl, version, action }
}

export const useSoapStore = create<SoapStore>((set, get) => ({
  ...persisted.current,
  // Backfill manual-mode fields for states persisted before they existed.
  manualSoapAction: persisted.current.manualSoapAction ?? '',
  manualSoapVersion: persisted.current.manualSoapVersion ?? 'soap11',
  mode: persisted.current.mode ?? 'wsdl',
  manualOperationName: persisted.current.manualOperationName ?? 'Echo',
  manualOperationNamespace: persisted.current.manualOperationNamespace ?? 'http://example.com/echo',
  // Transient — never restored
  isLoading: false,
  parseError: null,
  _inflightRequestId: null,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setWsdlUrl: (url) => {
    set({ wsdlUrl: url })
    markActiveTabDirty()
  },

  parseWsdl: async () => {
    // Issue #247: a WSDL URL credential still withheld after a restart.
    if (get().withheldCredentials.length > 0) await reloadWithheldBeforeSend()
    const rawUrl = get().wsdlUrl.trim()
    if (!rawUrl) return

    // Normalize URL: prepend https:// when no scheme is present, so users
    // can paste hostnames like "www.foo.com/svc?wsdl" without errors.
    const normalizedUrl =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) || rawUrl.startsWith('file://')
        ? rawUrl
        : `https://${rawUrl}`

    if (normalizedUrl !== rawUrl) {
      set({ wsdlUrl: normalizedUrl })
    }

    set({ isLoading: true, parseError: null, parsedWsdl: null })

    try {
      const result = await window.api?.soap?.parseWsdl(normalizedUrl)

      if (result?.success && result.data) {
        const parsed = result.data
        set({ parsedWsdl: parsed, isLoading: false })

        // Auto-select first service/port/operation
        if (parsed.services.length > 0) {
          const svc = parsed.services[0]
          set({ selectedService: svc.name })
          if (svc.ports.length > 0) {
            const port = svc.ports[0]
            set({ selectedPort: port.name, endpointUrl: port.endpointUrl })
            if (port.operations.length > 0) {
              const op = port.operations[0]
              set({
                selectedOperation: op.name,
                rawXml: op.exampleRequest,
                formValues: flattenSchema(op.inputSchema),
              })
            }
          }
        }
      } else {
        set({
          parseError: result?.error || 'Failed to parse WSDL',
          isLoading: false,
        })
      }
    } catch (e) {
      set({
        parseError: (e as Error).message || 'Failed to parse WSDL',
        isLoading: false,
      })
    }
  },

  selectService: (name) => {
    const { parsedWsdl } = get()
    set({ selectedService: name, selectedPort: null, selectedOperation: null })
    const svc = parsedWsdl?.services.find((s) => s.name === name)
    if (svc && svc.ports.length > 0) {
      const port = svc.ports[0]
      set({ selectedPort: port.name })
      if (port.operations.length > 0) {
        const op = port.operations[0]
        set({
          selectedOperation: op.name,
          rawXml: op.exampleRequest,
          formValues: flattenSchema(op.inputSchema),
        })
      }
    }
    markActiveTabDirty()
  },

  selectPort: (name) => {
    const { parsedWsdl, selectedService } = get()
    set({ selectedPort: name, selectedOperation: null })
    const svc = parsedWsdl?.services.find((s) => s.name === selectedService)
    const port = svc?.ports.find((p) => p.name === name)
    if (port?.endpointUrl) {
      set({ endpointUrl: port.endpointUrl })
    }
    if (port && port.operations.length > 0) {
      const op = port.operations[0]
      set({
        selectedOperation: op.name,
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
    markActiveTabDirty()
  },

  selectOperation: (name) => {
    const op = get()
      .getSelectedPort()
      ?.operations.find((o) => o.name === name)
    set({ selectedOperation: name })
    if (op) {
      set({
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
    markActiveTabDirty()
  },

  setFormValue: (key, value) => {
    set((state) => ({
      formValues: { ...state.formValues, [key]: value },
    }))
    markActiveTabDirty()
  },

  setFormValues: (values) => {
    set({ formValues: values })
    markActiveTabDirty()
  },

  setRawXml: (xml) => {
    set({ rawXml: xml })
    markActiveTabDirty()
  },

  setBodyMode: (mode) => {
    set({ bodyMode: mode })
    markActiveTabDirty()
  },

  setEndpointUrl: (url) => {
    set({ endpointUrl: url })
    markActiveTabDirty()
  },

  setManualSoapAction: (action) => {
    set({ manualSoapAction: action })
    markActiveTabDirty()
  },
  setManualSoapVersion: (v) => {
    set({ manualSoapVersion: v })
    markActiveTabDirty()
  },
  // Mode is a view choice, not request data — no dirty flag.
  setMode: (mode) => set({ mode }),
  setManualOperationName: (manualOperationName) => {
    set({ manualOperationName })
    markActiveTabDirty()
  },
  setManualOperationNamespace: (manualOperationNamespace) => {
    set({ manualOperationNamespace })
    markActiveTabDirty()
  },

  setWsSecurity: (config) => {
    set((state) => ({
      wsSecurity: { ...state.wsSecurity, ...config },
    }))
    markActiveTabDirty()
  },

  sendSoap: async () => {
    // Issue #247: a password still withheld after a restart is reloaded first —
    // the WS-Security one (this store) and the Auth tab's (request store; its
    // reload adapter covers every protocol, so one reload does both).
    const req = useRequestStore.getState()
    if (get().withheldCredentials.length > 0 || req.withheldCredentials.length > 0 || req.unloaded)
      await reloadWithheldBeforeSend()
    const { rawXml, wsSecurity } = get()
    // Read after the reload: the Auth and Headers tabs of this SOAP request
    // (the editor renders the request store's tabs — issue #298 follow-up).
    const { auth, headers: userHeaders } = useRequestStore.getState()
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Issue #195: a History mask left in a credential field is never sent.
    const masked = soapMaskedSendError({
      endpointUrl: get().endpointUrl || '',
      envelope: rawXml,
      headers: userHeaders,
      auth,
    })
    if (masked) {
      responseStore.setResponse(
        { requestId: makeId(), protocol: 'soap', error: masked, timing: { total: 0 } },
        activeTabId,
      )
      return
    }

    responseStore.setLoading(true, activeTabId)
    responseStore.clearResponse(activeTabId)
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    // Endpoint, version and action — the same helper Generate Code uses.
    const { op, endpointUrl, version: effectiveVersion, action } = soapSendTarget(get())

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(endpointUrl, activeVars)
    const resolvedXml = resolveVariables(rawXml, activeVars)
    // Transport headers + the Headers tab, merged by the SHARED helper Run uses
    // on `schema.headers` (`buildRequestFromEndpoint`): transport first unless
    // the user typed an enabled Content-Type / SOAPAction, then the user's
    // rows (disabled ones ride along; the engine skips them). Resolved once,
    // after the merge — Run's order.
    const headerPairs = withSoapTransportHeaders(userHeaders, effectiveVersion, action)
    const resolvedHeaders = resolveKeyValuePairs(headerPairs, activeVars)
    // WS-Security is applied in MAIN, to the resolved envelope, right before
    // the request goes out (src/main/lib/soap-wsse.ts) — the same applier and
    // the same `{{var}}` rule as Run. Key material stays in main; the config
    // carries only pasted PEM or an opaque key source.
    const resolvedWsSecurity = isWsSecurityEnabled(wsSecurity)
      ? resolveWsSecurityVariables(wsSecurity, (v) => resolveVariables(v, activeVars))
      : undefined
    // The Auth tab (issue #298 follow-up): Run has always sent the row's
    // `request_schema.auth` through request → folder → project inheritance;
    // Send sent none. Same resolver HTTP Send uses (suite items walk the
    // suite's folders), so Send ≡ Run. `wsse` is the Auth tab's WS-Security
    // choice — it stops inheritance on both paths and the engine adds no
    // header for it (the envelope carries the credential).
    const sendTab = tabsStore.tabs.find((t) => t.id === activeTabId)
    const inheritance = await resolveInheritance({
      projectId: useWorkspaceStore.getState().activeProjectId,
      endpointId: sendTab?.endpointId,
      savedRequestId: sendTab?.savedRequestId,
      testSuiteItemId: sendTab?.testSuiteItemId,
      requestAuth: auth,
      requestPre: null,
      requestPost: null,
    })
    const resolvedAuth = resolveAuth(inheritance.auth ?? undefined, activeVars)

    const requestId = makeId()
    set({ _inflightRequestId: requestId })
    try {
      const ws = useWorkspaceStore.getState()
      const result = await window.api?.request?.send({
        method: 'POST',
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: { type: 'xml', content: resolvedXml },
        auth: resolvedAuth,
        _protocol: 'soap',
        _wsSecurity: resolvedWsSecurity,
        _requestId: requestId,
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: ws.activeProjectId || undefined,
      })

      if (result?.success && result.data) {
        responseStore.setResponse(result.data as ApiResponse, activeTabId)
      } else {
        responseStore.setResponse(
          {
            requestId: makeId(),
            protocol: 'soap',
            error: result?.error || 'SOAP request failed',
            timing: { total: 0 },
          },
          activeTabId,
        )
      }
    } catch {
      // Demo mode
      responseStore.setResponse(
        {
          requestId: makeId(),
          protocol: 'soap',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/xml; charset=utf-8' },
          body:
            op?.exampleResponse ||
            '<soap:Envelope><soap:Body><Response/></soap:Body></soap:Envelope>',
          bodySize: (op?.exampleResponse || '').length,
          timing: { total: 245 },
          actualRequest: {
            method: 'POST',
            url: endpointUrl,
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              SOAPAction: op?.soapAction || '',
            },
            body: rawXml,
          },
        },
        activeTabId,
      )
    } finally {
      responseStore.setLoading(false, activeTabId)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
      set((s) => (s._inflightRequestId === requestId ? { _inflightRequestId: null } : s))
    }
  },

  cancelSoap: async () => {
    const id = get()._inflightRequestId
    if (!id) return
    try {
      await window.api?.request?.cancel(id)
    } catch {
      // engine already finished
    }
    set({ _inflightRequestId: null })
  },

  loadFromEndpoint: (data) => {
    const soapMeta = data.soap
    const xmlBody = data.body?.content || soapMeta?.exampleRequest || ''
    const endpointUrl = soapMeta?.endpointUrl || data.url || ''

    if (soapMeta) {
      // Build a synthetic WsdlParseResult from stored metadata
      const operation: WsdlOperation = {
        name: soapMeta.operationName || 'Unknown',
        soapAction: soapMeta.soapAction || '',
        inputSchema: soapMeta.inputSchema || {},
        outputSchema: soapMeta.outputSchema || {},
        exampleRequest: soapMeta.exampleRequest || '',
        exampleResponse: soapMeta.exampleResponse || '',
      }

      const port: WsdlPort = {
        name: soapMeta.portName || 'Port',
        endpointUrl,
        operations: [operation],
      }

      const service: WsdlService = {
        name: soapMeta.serviceName || 'Service',
        ports: [port],
      }

      const syntheticWsdl: WsdlParseResult = {
        services: [service],
        endpointUrl,
        soapVersion: soapMeta.soapVersion || 'soap11',
        rawWsdl: '',
      }

      set({
        wsdlUrl: soapMeta.wsdlUrl || '',
        parsedWsdl: syntheticWsdl,
        isLoading: false,
        parseError: null,
        selectedService: service.name,
        selectedPort: port.name,
        selectedOperation: operation.name,
        rawXml: xmlBody,
        bodyMode: 'raw',
        formValues: flattenSchema(operation.inputSchema),
        endpointUrl,
        // Fresh from the row — nothing is waiting for a withheld value (#247).
        withheldCredentials: [],
      })
    } else {
      // No SOAP metadata at all (rows imported/saved before metadata existed):
      // there is no WSDL to show, so this IS a manual request — open the
      // Manual form over the raw XML instead of an empty WSDL editor, and read
      // the action/version back from the stored transport headers.
      const transport = soapTransportFromHeaders(data.headers)
      set({
        mode: 'manual',
        wsdlUrl: '',
        parsedWsdl: null,
        isLoading: false,
        parseError: null,
        selectedService: null,
        selectedPort: null,
        selectedOperation: null,
        rawXml: xmlBody,
        bodyMode: 'raw',
        formValues: {},
        endpointUrl,
        withheldCredentials: [],
        ...(transport.action !== undefined ? { manualSoapAction: transport.action } : {}),
        ...(transport.version ? { manualSoapVersion: transport.version } : {}),
      })
    }
  },

  cloneTabState: (srcTabId, dstTabId) =>
    cloneTabSlice(useSoapStore, extractSoapTabState, srcTabId, dstTabId, idleSoap),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    // Save current tab state
    if (state._currentTabId) {
      tabStates.set(state._currentTabId, extractSoapTabState(state))
    }

    // Load target tab state (or empty for new tabs). Merge over the empty
    // state so fields added later (manual SOAP action/version) default cleanly
    // for cache entries persisted before they existed.
    const target = { ...emptySoapTabState(), ...tabStates.get(tabId) }

    set({
      ...target,
      isLoading: false,
      parseError: null,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },

  reset: () =>
    set({
      wsdlUrl: '',
      parsedWsdl: null,
      isLoading: false,
      parseError: null,
      selectedService: null,
      selectedPort: null,
      selectedOperation: null,
      formValues: {},
      rawXml: '',
      bodyMode: 'raw',
      wsSecurity: { ...defaultWsSecurity },
      endpointUrl: '',
      withheldCredentials: [],
    }),

  getSelectedService: () => {
    const { parsedWsdl, selectedService } = get()
    return parsedWsdl?.services.find((s) => s.name === selectedService)
  },

  getSelectedPort: () => {
    const svc = get().getSelectedService()
    return svc?.ports.find((p) => p.name === get().selectedPort)
  },

  getSelectedOperation: () => {
    const port = get().getSelectedPort()
    return port?.operations.find((o) => o.name === get().selectedOperation)
  },
}))

attachTabbedPersist(
  useSoapStore,
  STORAGE_KEY,
  extractSoapTabState,
  (s) => ({
    _tabStates: s._tabStates,
    _currentTabId: s._currentTabId,
  }),
  // #60: the picker's store/key passwords are WRITE-ONLY. They stay in memory
  // (so a tab switch keeps the session usable) but never reach localStorage;
  // #247: nor does the UsernameToken password.
  persistableSoap,
)
// Issue #247: a user edit to a withheld value drops its marker.
trackCredentialEdits(useSoapStore, SOAP_CREDENTIALS)

function flattenSchema(schema: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(schema)) {
    if (typeof val === 'string') {
      result[key] = ''
    } else if (typeof val === 'object' && val !== null) {
      const nested = flattenSchema(val as Record<string, unknown>)
      for (const [nk, nv] of Object.entries(nested)) {
        result[`${key}.${nk}`] = nv
      }
    }
  }
  return result
}
