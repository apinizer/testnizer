import { useEffect, useMemo, useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useGraphQLStore } from '../../stores/graphql.store'
import { soapSendTarget, useSoapStore } from '../../stores/soap.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { resolveInheritance } from '../../lib/auth-inheritance'
import { withSoapTransportHeaders } from '../../../shared/soap-transport'
import { isWsSecurityEnabled } from '../../../shared/soap-wsse'
import type { CodeGenRequest } from '../../lib/code-generator'
import type { AuthConfig } from '../../types'

/**
 * What Generate Code renders: an HTTP-like request, or why it cannot.
 * `wsSecurityNote`: the request is a SOAP one with WS-Security on — the
 * snippet carries the envelope as Send hands it to main, without the
 * `wsse:Security` header main adds per send (issue #298 follow-up).
 */
export type CodegenSource =
  | { kind: 'request'; req: CodeGenRequest; wsSecurityNote?: boolean }
  | { kind: 'unavailable'; protocol: string }

/** Protocols whose request is plain HTTP on the wire (issue #280). */
const HTTP_LIKE = new Set(['http', 'graphql', 'soap'])

/**
 * The auth the snippet shows: the request's own, or — for `inherit` — what
 * the folder chain / project resolves to, through the same
 * `resolveInheritance` Send uses (request → folder → project, `none` stops).
 * An inherited auth arrives asynchronously (folder / settings IPC); until then
 * the snippet shows no auth, never the literal `inherit`.
 */
function useEffectiveAuth(auth: AuthConfig): AuthConfig | undefined {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const endpointId = activeTab?.endpointId
  const savedRequestId = activeTab?.savedRequestId
  const testSuiteItemId = activeTab?.testSuiteItemId
  const inherits = auth?.type === 'inherit'
  // A resolution is used only for the request it was made for: after a tab
  // switch the previous tab's credential is never shown while the new one is
  // in flight.
  const key = [projectId, endpointId, savedRequestId, testSuiteItemId].join('|')
  const [inherited, setInherited] = useState<{ key: string; auth: AuthConfig | null } | null>(null)

  useEffect(() => {
    if (!inherits) return
    let alive = true
    void resolveInheritance({
      projectId,
      endpointId,
      savedRequestId,
      testSuiteItemId,
      requestAuth: auth,
      requestPre: null,
      requestPost: null,
    }).then((r) => {
      if (alive) setInherited({ key, auth: r.auth })
    })
    return () => {
      alive = false
    }
  }, [inherits, auth, key, projectId, endpointId, savedRequestId, testSuiteItemId])

  if (!inherits) return auth?.type === 'none' ? undefined : auth
  return inherited && inherited.key === key ? (inherited.auth ?? undefined) : undefined
}

/** The HTTP editor's request (`request.store`), with its effective auth. */
function useHttpRequest(auth: AuthConfig | undefined): CodeGenRequest {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const params = useRequestStore((s) => s.params)
  const pathVariables = useRequestStore((s) => s.pathVariables)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const sslVerification = useRequestStore((s) => s.sslVerification)
  const followRedirects = useRequestStore((s) => s.followRedirects)
  const timeout = useRequestStore((s) => s.requestTimeout)
  return useMemo(
    () => ({
      method,
      url,
      params,
      pathVariables,
      headers,
      body,
      auth,
      settings: { sslVerification, followRedirects, timeout },
    }),
    [
      method,
      url,
      params,
      pathVariables,
      headers,
      body,
      auth,
      sslVerification,
      followRedirects,
      timeout,
    ],
  )
}

/** A GraphQL tab: Send posts `{query, variables}` as JSON (`graphql.store.executeQuery`). */
function useGraphqlRequest(): CodeGenRequest {
  const url = useGraphQLStore((s) => s.url)
  const query = useGraphQLStore((s) => s.query)
  const variables = useGraphQLStore((s) => s.variables)
  const headers = useGraphQLStore((s) => s.headers)
  return useMemo(
    () => ({
      method: 'POST',
      url,
      params: [],
      headers,
      body: { type: 'graphql', graphql: { query, variables } },
    }),
    [url, query, variables, headers],
  )
}

/**
 * A SOAP tab, as `sendSoap` sends it: the envelope, SOAPAction / SOAP 1.2
 * Content-Type merged with the Headers tab by the same shared helper
 * (`withSoapTransportHeaders` — a user's enabled Content-Type / SOAPAction
 * wins), and the Auth tab's effective auth (`auth`, inheritance resolved). WS-Security is NOT here: since issue #298 Send no longer turns
 * the UsernameToken into Basic auth — main adds `wsse:Security` to the
 * envelope per send (nonce, timestamp, signature), which a static snippet
 * cannot reproduce. `useCodegenSource` flags it for a visible note instead.
 */
function useSoapRequest(auth: AuthConfig | undefined): CodeGenRequest {
  const mode = useSoapStore((s) => s.mode)
  const endpoint = useSoapStore((s) => s.endpointUrl)
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const service = useSoapStore((s) => s.selectedService)
  const port = useSoapStore((s) => s.selectedPort)
  const operation = useSoapStore((s) => s.selectedOperation)
  const manualSoapAction = useSoapStore((s) => s.manualSoapAction)
  const manualSoapVersion = useSoapStore((s) => s.manualSoapVersion)
  const rawXml = useSoapStore((s) => s.rawXml)
  // The SOAP editor's Headers tab is the request store's (issue #298 follow-up).
  const userHeaders = useRequestStore((s) => s.headers)
  return useMemo(() => {
    // The getters read the selected service / port / operation from the store.
    const { getSelectedOperation, getSelectedPort } = useSoapStore.getState()
    void service
    void port
    void operation
    const { endpointUrl, version, action } = soapSendTarget({
      mode,
      endpointUrl: endpoint,
      parsedWsdl,
      manualSoapAction,
      manualSoapVersion,
      getSelectedOperation,
      getSelectedPort,
    })
    const headers = withSoapTransportHeaders(userHeaders, version, action).map((h, i) => ({
      id: `soap-${i}`,
      ...h,
    }))
    return {
      method: 'POST',
      url: endpointUrl,
      params: [],
      headers,
      body: { type: 'xml', content: rawXml },
      // The Auth tab's `wsse` choice is WS-Security, not an HTTP header.
      auth: auth?.type === 'wsse' ? undefined : auth,
    }
  }, [
    auth,
    userHeaders,
    mode,
    endpoint,
    parsedWsdl,
    service,
    port,
    operation,
    manualSoapAction,
    manualSoapVersion,
    rawXml,
  ])
}

/**
 * The active tab's request as Generate Code input (issue #280): HTTP from
 * `request.store`, GraphQL and SOAP from their own stores (they used to be
 * ignored — the snippet showed a stale HTTP request), anything else is
 * "not available". No tab (Quick Test) = the HTTP editor.
 */
export function useCodegenSource(): CodegenSource {
  const protocol = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.protocol)
  // One inheritance resolution for both editors that read the request store's
  // Auth tab (HTTP and SOAP) — the same `resolveInheritance` their Send uses.
  const auth = useEffectiveAuth(useRequestStore((s) => s.auth))
  const http = useHttpRequest(auth)
  const graphql = useGraphqlRequest()
  const soap = useSoapRequest(auth)
  // The same predicate `sendSoap` uses to hand WS-Security to main.
  const wsSecurityOn = useSoapStore((s) => isWsSecurityEnabled(s.wsSecurity))
  const p = protocol ?? 'http'
  if (!HTTP_LIKE.has(p)) return { kind: 'unavailable', protocol: p }
  if (p === 'soap') return { kind: 'request', req: soap, wsSecurityNote: wsSecurityOn }
  return { kind: 'request', req: p === 'graphql' ? graphql : http }
}
