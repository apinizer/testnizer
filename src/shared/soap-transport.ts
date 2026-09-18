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
