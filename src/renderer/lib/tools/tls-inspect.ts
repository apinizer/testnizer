/**
 * TLS Inspector — pure, browser-safe helpers (#64, Faz F).
 *
 * The renderer NEVER touches the network (CSP `connect-src 'self'`); the actual
 * probe runs in main via `window.api.tls.inspect`. This module only assembles
 * the request DTO from the tool's form state and projects the presented chain
 * into the shape the keystore `CertificateDetailDialog` already knows how to
 * render. No `throw` at the boundary — validation returns a discriminated union.
 */

import type {
  KeystoreAliasDetail,
  TlsCertificateInfo,
  TlsCipherPreset,
  TlsClientCert,
  TlsInspectRequest,
  TlsInspectResult,
} from '../../types'

/** TLS protocol versions offered in the min/max selects (blank ⇒ engine default). */
export const TLS_VERSIONS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const
export type TlsVersion = (typeof TLS_VERSIONS)[number]

/** Versions Electron 33 / BoringSSL cannot negotiate — probing them is handled,
 *  not attempted (the engine returns a friendly error; the UI warns up front). */
export const LEGACY_TLS_VERSIONS: readonly string[] = ['TLSv1', 'TLSv1.1']

export const CIPHER_PRESETS: readonly TlsCipherPreset[] = ['modern', 'intermediate', 'legacy']

export function isLegacyTlsVersion(v: string | undefined): boolean {
  return !!v && LEGACY_TLS_VERSIONS.includes(v)
}

/** True when either bound selects a legacy (1.0/1.1) version. */
export function hasLegacySelection(minVersion?: string, maxVersion?: string): boolean {
  return isLegacyTlsVersion(minVersion) || isLegacyTlsVersion(maxVersion)
}

// ── form state ───────────────────────────────────────────────────────────────

export interface TlsClientCertForm {
  enabled: boolean
  mode: 'inline' | 'file'
  certPem: string
  keyPem: string
  passphrase: string
  certPath: string
  keyPath: string
  pfxPath: string
}

export interface TlsInspectFormState {
  host: string
  port: string
  servername: string
  minVersion: string
  maxVersion: string
  cipherPreset: string
  caCerts: string
  clientCert: TlsClientCertForm
}

export function emptyClientCertForm(): TlsClientCertForm {
  return {
    enabled: false,
    mode: 'inline',
    certPem: '',
    keyPem: '',
    passphrase: '',
    certPath: '',
    keyPath: '',
    pfxPath: '',
  }
}

export function emptyFormState(): TlsInspectFormState {
  return {
    host: '',
    port: '',
    servername: '',
    minVersion: '',
    maxVersion: '',
    cipherPreset: '',
    caCerts: '',
    clientCert: emptyClientCertForm(),
  }
}

export type BuildRequestResult =
  | { ok: true; request: TlsInspectRequest }
  | { ok: false; error: string }

/**
 * Base64-encode ASCII (PEM) text. PEM is latin1-safe, so `btoa` (a global in
 * both the browser and the node test env) is sufficient; the main handler
 * base64-DECODES each `caCerts` entry back into a buffer.
 */
function b64(text: string): string {
  return btoa(text)
}

/** Strip a leading scheme + any trailing path, leaving `host` or `host:port`. */
function normaliseHost(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\s+/g, '')
}

/**
 * Assemble a `TlsInspectRequest` from form state. Pure + total: an empty host or
 * an out-of-range port returns `{ ok: false }` rather than throwing. A legacy
 * TLS selection is NOT rejected here — it is a handled probe (the engine returns
 * an explicit error) so the request is still built and the UI warns separately.
 */
export function buildInspectRequest(form: TlsInspectFormState): BuildRequestResult {
  let host = normaliseHost(form.host)
  if (!host) return { ok: false, error: 'Host is required.' }

  // Allow "host:port" pasted into the host field when the port box is empty.
  let port: number | undefined
  const portRaw = form.port.trim()
  if (portRaw) {
    const n = Number(portRaw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { ok: false, error: 'Port must be between 1 and 65535.' }
    }
    port = n
  } else {
    const colon = host.lastIndexOf(':')
    // Only split a trailing :port (ignore IPv6 with multiple colons / no brackets).
    if (colon > 0 && host.indexOf(':') === colon) {
      const maybePort = host.slice(colon + 1)
      const n = Number(maybePort)
      if (maybePort && Number.isInteger(n) && n >= 1 && n <= 65535) {
        host = host.slice(0, colon)
        port = n
      }
    }
  }

  const request: TlsInspectRequest = { host }
  if (port !== undefined) request.port = port

  const servername = form.servername.trim()
  if (servername) request.servername = servername
  if (form.minVersion) request.minVersion = form.minVersion
  if (form.maxVersion) request.maxVersion = form.maxVersion
  if (form.cipherPreset && (CIPHER_PRESETS as readonly string[]).includes(form.cipherPreset)) {
    request.cipherPreset = form.cipherPreset as TlsCipherPreset
  }

  const ca = form.caCerts.trim()
  if (ca) request.caCerts = [b64(ca)]

  const cc = buildClientCert(form.clientCert)
  if (cc) request.clientCert = cc

  return { ok: true, request }
}

/** Build the optional mTLS client-cert branch — undefined when nothing usable. */
export function buildClientCert(form: TlsClientCertForm): TlsClientCert | undefined {
  if (!form.enabled) return undefined

  if (form.mode === 'inline') {
    const cert = form.certPem.trim()
    const key = form.keyPem.trim()
    if (!cert && !key) return undefined
    const out: TlsClientCert = { kind: 'inline' }
    if (cert) out.certPem = form.certPem
    if (key) out.keyPem = form.keyPem
    if (form.passphrase) out.passphrase = form.passphrase
    return out
  }

  // file
  const certPath = form.certPath.trim()
  const keyPath = form.keyPath.trim()
  const pfxPath = form.pfxPath.trim()
  if (!certPath && !keyPath && !pfxPath) return undefined
  const out: TlsClientCert = { kind: 'file' }
  if (certPath) out.certPath = certPath
  if (keyPath) out.keyPath = keyPath
  if (pfxPath) out.pfxPath = pfxPath
  if (form.passphrase) out.passphrase = form.passphrase
  return out
}

// ── projections for display ────────────────────────────────────────────────

/** Extract a friendly label (CN, else the raw DN) from an X.500 subject DN. */
export function leafLabel(subjectDN: string, fallback: string): string {
  const cn = /(?:^|,|\/)\s*CN=([^,/]+)/i.exec(subjectDN)
  if (cn && cn[1].trim()) return cn[1].trim()
  return subjectDN.trim() || fallback
}

/**
 * Project a presented TLS chain into a `KeystoreAliasDetail` so the existing
 * keystore `CertificateDetailDialog` renders it verbatim (the two cert shapes
 * are structurally identical). `startIndex` is clamped to the chain bounds.
 */
export function toCertDetail(result: TlsInspectResult, host: string): KeystoreAliasDetail {
  const leaf = result.chain[0]
  return {
    alias: leaf ? leafLabel(leaf.subjectDN, host) : host,
    entryType: 'CERTIFICATE',
    hasPrivateKey: false,
    chain: result.chain as TlsCertificateInfo[],
  }
}

/** A stable alias for "Add as trusted" — host + short SHA-256 fingerprint. */
export function trustedAliasFor(host: string, leaf: TlsCertificateInfo | undefined): string {
  const fp = (leaf?.sha256Fingerprint ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .slice(0, 12)
    .toLowerCase()
  const safeHost = host.replace(/[^0-9a-z.-]/gi, '_') || 'tls'
  return fp ? `tls-${safeHost}-${fp}` : `tls-${safeHost}`
}
