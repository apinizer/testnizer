/**
 * SOAP transport headers — the ONE place that knows how the SOAP version and
 * action map onto HTTP (issue #124 follow-up, Send ≡ Run parity).
 *
 *   SOAP 1.1 → `Content-Type: text/xml; charset=utf-8` + quoted `SOAPAction:` header
 *   SOAP 1.2 → `Content-Type: application/soap+xml; charset=utf-8; action="…"`, no SOAPAction
 *
 * Used by the renderer's Send (`soap.store.sendSoap`) AND the main-process
 * Runner / Test Suite (`runner.handler.buildRequestFromEndpoint`). Before this
 * helper the Runner sent a manual SOAP request as plain `application/xml`
 * with no SOAPAction — the same class of drift as the header-assertion and
 * env-var parity gotchas in CLAUDE.md.
 */
export type SoapVersion = 'soap11' | 'soap12'

export interface SoapTransportHeader {
  key: string
  value: string
  enabled: true
}

export function soapTransportHeaders(
  version: SoapVersion | undefined,
  action: string | undefined,
): SoapTransportHeader[] {
  const act = (action ?? '').trim()
  if (version === 'soap12') {
    return [
      {
        key: 'Content-Type',
        value: act
          ? `application/soap+xml; charset=utf-8; action="${act}"`
          : 'application/soap+xml; charset=utf-8',
        enabled: true,
      },
    ]
  }
  return [
    { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
    // SOAP 1.1 requires the action quoted; an unquoted/empty value is what
    // servers reject.
    { key: 'SOAPAction', value: `"${act}"`, enabled: true },
  ]
}

/** The subset of `metadata.soap` the transport layer needs. */
export interface SoapTransportMeta {
  mode?: 'manual' | 'wsdl'
  manualSoapAction?: string
  manualSoapVersion?: SoapVersion
  /** WSDL mode — the selected operation's action / the document's version. */
  soapAction?: string
  soapVersion?: SoapVersion
}

/**
 * Pick version + action from persisted SOAP metadata. Manual mode reads the
 * manual form fields; WSDL mode the operation's. Returns null when the
 * metadata carries nothing usable (caller keeps whatever headers it has).
 * Used by the exporters; the Runner uses `soapTransportForRow` (never null —
 * Send always adds the transport headers, issue #298 follow-up).
 */
export function soapTransportFromMeta(
  meta: SoapTransportMeta | null | undefined,
): { version: SoapVersion; action: string } | null {
  if (!meta || typeof meta !== 'object') return null
  const manual = meta.mode === 'manual' || (meta.mode === undefined && !meta.soapAction)
  const version = (manual ? meta.manualSoapVersion : meta.soapVersion) ?? 'soap11'
  const action = (manual ? meta.manualSoapAction : meta.soapAction) ?? ''
  if (!manual && !meta.soapAction && !meta.soapVersion) return null
  return { version, action }
}

/**
 * Version + action Send puts on the wire — ONE rule for the renderer's Send /
 * Generate Code (`soap.store.soapSendTarget`) and the Runner
 * (`soapTransportForRow` → `runner.handler.buildRequestFromEndpoint`), so the
 * two cannot drift (issue #298 follow-up). A selected WSDL operation wins
 * (the document's version, the operation's action, falling back to the manual
 * action when the operation has none); without one the manual form decides.
 * Defaults: SOAP 1.1 and an empty action — `SOAPAction: ""`.
 */
export function soapVersionAndAction(input: {
  /** The selected WSDL operation, if any (Manual mode never has one). */
  op?: { soapAction?: string } | null
  wsdlVersion?: SoapVersion | null
  manualSoapAction?: string | null
  manualSoapVersion?: SoapVersion | null
}): { version: SoapVersion; action: string } {
  const { op } = input
  const version = op ? (input.wsdlVersion ?? 'soap11') : (input.manualSoapVersion ?? 'soap11')
  return { version, action: op?.soapAction || input.manualSoapAction || '' }
}

/**
 * Inverse of `soapTransportHeaders`: recover version + action from a stored
 * header list (SOAP 1.1 `SOAPAction: "…"`, SOAP 1.2 `Content-Type: …;
 * action="…"`). What Send's editor reads back for a SOAP row saved without
 * any `metadata.soap` (imported / pre-metadata rows).
 */
export function soapTransportFromHeaders(
  headers: Array<{ key: string; value: string; enabled?: boolean }> | undefined,
): { version?: SoapVersion; action?: string } {
  const out: { version?: SoapVersion; action?: string } = {}
  for (const h of headers ?? []) {
    const key = (h.key ?? '').trim().toLowerCase()
    const value = typeof h.value === 'string' ? h.value : ''
    if (key === 'soapaction') {
      out.version = 'soap11'
      out.action = value.trim().replace(/^"|"$/g, '')
    } else if (key === 'content-type' && /application\/soap\+xml/i.test(value)) {
      out.version = 'soap12'
      const m = /action="([^"]*)"/i.exec(value)
      if (m) out.action = m[1]
    }
  }
  return out
}

/**
 * Is a saved `metadata.soap` block a Manual-mode request? The explicit `mode`
 * when present; older rows have none — a request with no WSDL and no
 * selected operation can only have been built manually. The editor's restore
 * (`save-active-request.applyProtocolMetadata`) and the Runner both ask this.
 */
export function isManualSoapMeta(meta: Record<string, unknown>): boolean {
  if (meta.mode === 'manual') return true
  if (meta.mode !== undefined) return false
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return !str(meta.wsdlUrl) && !str(meta.operationName ?? meta.selectedOperation)
}

function asVersion(v: unknown): SoapVersion | undefined {
  return v === 'soap11' || v === 'soap12' ? v : undefined
}

/**
 * Version + action for a SAVED SOAP row, exactly as Send derives them once the
 * editor has restored that row (issue #298 follow-up). Never null — Send
 * always adds the transport headers (unless the Headers tab already carries an
 * enabled Content-Type / SOAPAction, which `withSoapTransportHeaders` keeps):
 *
 *   - no `metadata.soap` → the editor opens Manual over the raw XML and reads
 *     version / action back from the stored headers (`soapTransportFromHeaders`);
 *   - Manual → the manual form fields;
 *   - WSDL → a synthetic operation from the stored `soapAction` /
 *     `soapVersion` (falling back to the manual action) — `soapVersionAndAction`.
 */
export function soapTransportForRow(
  soapMeta: unknown,
  headers: Array<{ key: string; value: string; enabled?: boolean }> | undefined,
): { version: SoapVersion; action: string } {
  if (!soapMeta || typeof soapMeta !== 'object') {
    const t = soapTransportFromHeaders(headers)
    return soapVersionAndAction({ manualSoapVersion: t.version, manualSoapAction: t.action })
  }
  const m = soapMeta as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const manual = {
    manualSoapAction: str(m.manualSoapAction),
    manualSoapVersion: asVersion(m.manualSoapVersion),
  }
  if (isManualSoapMeta(m)) return soapVersionAndAction(manual)
  return soapVersionAndAction({
    ...manual,
    op: { soapAction: str(m.soapAction) },
    wsdlVersion: asVersion(m.soapVersion),
  })
}

/**
 * Prepend transport headers to a stored header list unless the user already
 * supplied Content-Type / SOAPAction (case-insensitive) — a request that
 * carries its own transport headers is left alone.
 */
export function withSoapTransportHeaders<
  T extends { key: string; value: string; enabled: boolean },
>(headers: T[] | undefined, version: SoapVersion, action: string): Array<T | SoapTransportHeader> {
  const existing = headers ?? []
  const has = (name: string) =>
    existing.some((h) => h.enabled && h.key.trim().toLowerCase() === name.toLowerCase())
  const transport = soapTransportHeaders(version, action).filter((h) => !has(h.key))
  return [...transport, ...existing]
}
