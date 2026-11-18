/**
 * Reopen a request-history row in a tab: request, response and the per-
 * protocol editor state (SOAP, MCP, HTTP / WS / gRPC / GraphQL). Shared by the
 * History sidebar list and the History page's table so both open a row the
 * same way. Moved verbatim out of HistoryListPanel (stores read via getState).
 */
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import { useUIStore } from '../../stores/ui.store'
import { mcpHistoryRestore } from '../protocols/mcp/history-restore'
import { openMcpHistoryRestore } from '../protocols/mcp/history-open'
import { openHistoryEntryInTab } from '../../lib/history-open'
import {
  historyTabName,
  historyTabUrl,
  shortHistoryUrl,
  unmaskHistoryValue,
} from '../../lib/history-restore'
import { useHistoryHiddenStore } from '../../stores/history-hidden.store'
import type { HistoryEntry, ApiResponse } from '../../types'

export function openHistoryEntry(entry: HistoryEntry): void {
  // SOAP reads the snapshot directly: values main masked (issue #195) come
  // back EMPTY so a re-send never puts the mask on the wire.
  const soapHidden: string[] = []
  const snap = unmaskHistoryValue(entry.request_snapshot || {}, '', soapHidden) as Record<
    string,
    unknown
  >
  const tabId = `tab-hist-${entry.id}`
  const protocol = entry.protocol || 'http'

  // Opening a history entry is an APIs-workbench action, so flip the left
  // panel to the APIs tree alongside the request being opened. (The tab is
  // global and would show on any page; this just lands the user with the
  // matching tree.)
  useUIStore.getState().setActiveSidebarPage('apis')

  // MCP rows carry the server + the call in their own shape (issue #166).
  const mcpRow = protocol === 'mcp' ? mcpHistoryRestore(entry) : null

  useTabsStore.getState().openPreviewTab({
    id: tabId,
    name: mcpRow
      ? `${entry.method || 'CALL_TOOL'} ${mcpRow.name || shortHistoryUrl(mcpRow.url)}`
      : historyTabName(entry),
    protocol,
    method: entry.method,
    url: mcpRow ? mcpRow.url : historyTabUrl(entry),
  })

  // openPreviewTab is synchronous — read the resolved active tab id back
  // out of the store so per-tab state caches key off the right id (a
  // matching existing preview reuses its original id, not `tabId`).
  const realTabId = useTabsStore.getState().activeTabId || tabId

  if (mcpRow) {
    // Open the MCP tab on the server with the call selected; the user then
    // presses Connect and Run (the shared helper the welcome page uses too).
    openMcpHistoryRestore(mcpRow, realTabId)
    return
  }

  if (protocol === 'soap') {
    useHistoryHiddenStore.getState().setHidden(realTabId, soapHidden)
    useSoapStore.getState().switchToTab(realTabId)
    useResponseStore.getState().clearResponse(realTabId)
    // SOAP snapshots store wsdl/operation/etc. fields at the top level
    // (see soap.handler.ts addHistory) — not under a nested `soap` key —
    // and the request body lives in `envelope`. Map them onto the shape
    // soapStore.loadFromEndpoint expects so the editor restores wsdl
    // selection + envelope XML.
    const envelope = typeof snap.envelope === 'string' ? snap.envelope : ''
    const hasWsdlSnapshot = Boolean(snap.wsdlUrl || snap.operationName || envelope)
    if (!hasWsdlSnapshot) {
      // Manual-mode SOAP sends go through the HTTP path and snapshot
      // {method,url,headers,body}; fabricating a WSDL from that produced an
      // "Unknown" operation with an empty body (issue #124 follow-up).
      const hdrs = (snap.headers as Array<{ key: string; value: string }> | undefined) ?? []
      const find = (k: string) => hdrs.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value
      const contentType = find('content-type') ?? ''
      const soapActionHeader = find('soapaction')
      const version = /application\/soap\+xml/i.test(contentType) ? 'soap12' : 'soap11'
      const action =
        version === 'soap12'
          ? (/action="([^"]*)"/.exec(contentType)?.[1] ?? '')
          : (soapActionHeader ?? '').replace(/^"|"$/g, '')
      const soapStore = useSoapStore.getState()
      soapStore.loadFromEndpoint({
        url: entry.url,
        body: snap.body as { type: string; content?: string } | undefined,
        headers: hdrs as Array<{ key: string; value: string; enabled: boolean }>,
      })
      soapStore.setMode('manual')
      soapStore.setManualSoapVersion(version)
      soapStore.setManualSoapAction(action)
    } else
      useSoapStore.getState().loadFromEndpoint({
        url: entry.url,
        body: envelope ? { type: 'xml', content: envelope } : undefined,
        headers: snap.headers as
          | Array<{ key: string; value: string; enabled: boolean }>
          | undefined,
        soap: {
          wsdlUrl: snap.wsdlUrl as string | undefined,
          endpointUrl: (snap.endpointUrl as string | undefined) || entry.url,
          operationName: snap.operationName as string | undefined,
          serviceName: snap.serviceName as string | undefined,
          portName: snap.portName as string | undefined,
          soapVersion: snap.soapVersion as 'soap11' | 'soap12' | undefined,
          exampleRequest: envelope,
        },
      })
  } else {
    useResponseStore.getState().clearResponse(realTabId)
    // HTTP, WebSocket, gRPC, GraphQL (issue #182): one restore, shared with
    // the welcome page's recent list. Rows carrying the `{{var}}` template
    // reopen from it, so re-sending keeps working auth (issue #195).
    openHistoryEntryInTab(entry, realTabId)
  }

  if (entry.response_snapshot) {
    const r = entry.response_snapshot as Partial<ApiResponse>
    // Pre-fix history rows (written before the v1.4.4 credential-strip
    // sweep) may have `actualRequest.url` carrying `user:pass@host`
    // userinfo. Scrub it on restore so the Actual Request panel never
    // displays credentials that the rest of the UI already strips.
    // Modern rows are already clean — this is a no-op for them.
    const cleanActualRequest = r.actualRequest
      ? { ...r.actualRequest, url: stripCredentialsInUrl(r.actualRequest.url) ?? '' }
      : r.actualRequest
    useResponseStore.getState().setResponse(
      {
        requestId: entry.id,
        protocol,
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
        body: r.body,
        // Restore the binary flag so an image / PDF body opened from history
        // previews as the file instead of dumping its base64 as text. Rows
        // captured before the flag was persisted still carry a valid base64
        // body, so fall back to inferring it from the content type
        // (issue #25 follow-up).
        bodyEncoding: r.bodyEncoding ?? inferBinaryEncoding(r.headers, r.body),
        bodySize: r.bodySize,
        timing: r.timing || { total: entry.duration_ms || 0 },
        error: r.error,
        // Carry forward the saved test results + console logs so the user
        // who opens an old run (especially a Test Suite request, where
        // pm.test()'s output is the whole point) sees the assertion
        // verdicts and script logs they originally produced. Without
        // these the Tests / Console sub-panes always rendered as empty
        // even when the runner had real data on disk (v1.4.4 §12.4).
        testResults: r.testResults,
        consoleLogs: r.consoleLogs,
        actualRequest: cleanActualRequest,
      },
      // The tab this row opened in — not "whichever tab is active" (issue #76).
      realTabId,
    )
  }
}

// History rows written before `bodyEncoding` was persisted still hold a valid
// base64 body for binary responses — recover the flag from the content type so
// those entries preview instead of showing base64 as text. Mirrors the
// engine's isBinaryContentType families (image/audio/video/font + pdf/octet).
function inferBinaryEncoding(
  headers: Record<string, string> | undefined,
  body: string | undefined,
): 'base64' | undefined {
  if (!body) return undefined
  const ct = (headers?.['content-type'] || headers?.['Content-Type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const isBinary =
    ct.startsWith('image/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ct.startsWith('font/') ||
    ct === 'application/pdf' ||
    ct === 'application/octet-stream'
  return isBinary ? 'base64' : undefined
}

function stripCredentialsInUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    const u = new URL(raw)
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
      return u.toString()
    }
    return raw
  } catch {
    return raw
  }
}
