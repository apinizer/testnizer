/**
 * Live TLS/SSL endpoint inspector (#64, Faz F).
 *
 * Opens a raw `tls.connect` to `host:port` in the MAIN process, captures the
 * certificate chain the server PRESENTS (`getPeerCertificate(true)`), the
 * negotiated protocol/cipher/ALPN, and derives an explicit trust + hostname
 * verdict — WITHOUT ever trusting the presented chain implicitly.
 *
 * ── PRESENT vs VALIDATE discipline (design §3.3 / §6-HIGH) ──────────────────
 * The probe uses `rejectUnauthorized:false` so a bad / self-signed / expired
 * endpoint is still inspectable. That means `getPeerCertificate(true)` returns
 * whatever the server *presents*, NOT an independently validated chain. The
 * result therefore carries:
 *   - `authorized`          — the VALIDATE verdict from `socket.authorized`
 *   - `authorizationError`  — Node's reason (e.g. `CERT_HAS_EXPIRED`)
 *   - `hostnameValid`       — an explicit `tls.checkServerIdentity` verdict
 * The `chain` is labelled "as presented"; callers must never render it as
 * trusted.
 *
 * ── Reconcile corrections applied (docs/design/consumers-grounding-reconcile.md)
 *   F-1  hostnameValid = tls.checkServerIdentity(servername, peerCert) === undefined
 *        (real boolean, covers IP-SAN + wildcard) — NOT X509Certificate.checkHost.
 *   F-2  caCerts are MERGED with tls.rootCertificates (never replace); omitted
 *        entirely when absent so Node uses its default store.
 *   F-3  TLS 1.0/1.1 are refused by Electron 33 BoringSSL — return a handled
 *        error, never call tls.connect (which throws ERR_SSL_INVALID_COMMAND).
 *   F-4  cipher control (ciphers / cipherPreset via getCipherPreset) forwarded
 *        to tls.connect, mirroring http.engine — lets the inspector reach
 *        deliberately-weak BadSSL endpoints; parity-locked with Send.
 *   F-6  mTLS client cert is already-resolved {cert,key,pfx,passphrase} buffers
 *        — transport-agnostic, NO resolver. Inline PEM + file both land here.
 *
 * NO-LEAK invariant: TLS inspection output is PUBLIC-ONLY. No private key bytes
 * ever appear in the result. The only private material is the OPTIONAL client
 * cert (mTLS), which is consumed by tls.connect in main and never echoed back.
 */

import * as tls from 'node:tls'
import { buildCertificateInfo, type CertificateInfo } from '../lib/keystore'
import {
  normaliseTlsVersion,
  isLegacyTlsVersion,
  getCipherPreset,
  type CipherPresetName,
} from '../lib/tls-presets'

/** Already-resolved client-cert material for an mTLS probe (F-6). */
export interface TlsInspectClientCert {
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  passphrase?: string
}

export interface TlsInspectOptions {
  host: string
  /** Defaults to 443. */
  port?: number
  /** SNI server name; defaults to `host`. */
  servername?: string
  alpnProtocols?: string[]
  minVersion?: string
  maxVersion?: string
  /** OpenSSL cipher string (verbatim). Takes precedence over `cipherPreset`. */
  ciphers?: string
  /** Named preset resolved through `getCipherPreset` (F-4). */
  cipherPreset?: CipherPresetName
  /** Handshake budget; defaults to ~10s. */
  timeoutMs?: number
  /** Extra trust anchors — MERGED with system roots for the VALIDATE verdict (F-2). */
  caCerts?: Buffer[]
  /** Optional mTLS client certificate (already-resolved buffers, F-6). */
  clientCert?: TlsInspectClientCert
}

export interface TlsCipherInfo {
  name: string
  standardName: string
  version: string
}

export type ValidityStatus = 'valid' | 'expiring' | 'expired'

/** What was probed — present whether or not the probe got anywhere. */
export interface TlsProbeTarget {
  host: string
  port: number
  servername: string
}

/**
 * No handshake: DNS, TCP, TLS negotiation, timeout, or a handled precondition.
 * Deliberately carries NOTHING about a certificate — this used to be the same
 * flat object with placeholder verdicts, which the UI then rendered as findings.
 */
export interface TlsProbeFailure extends TlsProbeTarget {
  ok: false
  /** Transport-level failure message. */
  error: string
}

/** Handshake completed. Certificate verdicts describe `chain[0]`, if any. */
export interface TlsProbeSuccess extends TlsProbeTarget {
  ok: true
  /** `socket.getProtocol()` — negotiated TLS version, e.g. `TLSv1.3`. */
  protocol: string | null
  /** `socket.getCipher()`. */
  cipher: TlsCipherInfo | null
  /** `socket.alpnProtocol` coerced to `string | false`. */
  alpnProtocol: string | false
  /** VALIDATE verdict — `socket.authorized` (chain + hostname vs trust store). */
  authorized: boolean
  /** Node's reason when `authorized` is false, e.g. `CERT_HAS_EXPIRED`. */
  authorizationError?: string
  /** Explicit hostname verdict via `tls.checkServerIdentity` (F-1). */
  hostnameValid: boolean
  /** PRESENTED chain, leaf-first. NOT independently validated. */
  chain: CertificateInfo[]
  selfSigned: boolean
  expired: boolean
  notYetValid: boolean
  daysToExpiry: number
  validityStatus: ValidityStatus
}

export type TlsInspectResult = TlsProbeFailure | TlsProbeSuccess

const MS_PER_DAY = 86_400_000
const DEFAULT_PORT = 443
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Pure validity classifier (design §3.3). `now` is always injected so callers
 * never race the wall clock in a test.
 *   - past `notAfter`                       → 'expired'
 *   - within `warnDays` of `notAfter`       → 'expiring'
 *   - otherwise                             → 'valid'
 */
export function classifyExpiry(notAfter: string | Date, now: Date, warnDays = 30): ValidityStatus {
  const na = notAfter instanceof Date ? notAfter : new Date(notAfter)
  const naMs = na.getTime()
  if (Number.isNaN(naMs)) return 'expired'
  const remaining = naMs - now.getTime()
  if (remaining <= 0) return 'expired'
  if (remaining <= warnDays * MS_PER_DAY) return 'expiring'
  return 'valid'
}

function errString(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** authorizationError may be a string (legacy) or an Error with a `.code`. */
function normaliseAuthError(ae: unknown): string | undefined {
  if (!ae) return undefined
  if (typeof ae === 'string') return ae
  if (ae instanceof Error) {
    const code = (ae as NodeJS.ErrnoException).code
    return code ?? ae.message
  }
  return String(ae)
}

/**
 * A probe that never completed a handshake.
 *
 * This used to return a full result object with `ok:false` and every
 * certificate field set to a placeholder — `hostnameValid:false`,
 * `expired:false` next to `validityStatus:'expired'`. The UI read them as
 * findings. The failure variant simply has no such fields.
 */
function failure(
  opts: TlsInspectOptions,
  port: number,
  servername: string,
  error: string,
): TlsProbeFailure {
  return { ok: false, host: opts.host, port, servername, error }
}

/**
 * Walk the PRESENTED chain leaf-first with a self-reference + loop guard.
 * Node's `DetailedPeerCertificate.issuerCertificate` self-references at the
 * root, so `next === node` terminates a well-formed chain; the fingerprint set
 * defends against a maliciously looping chain.
 */
function walkChain(peer: tls.DetailedPeerCertificate): CertificateInfo[] {
  const chain: CertificateInfo[] = []
  const seen = new Set<string>()
  let node: tls.DetailedPeerCertificate | undefined = peer
  while (node && node.raw && node.raw.length > 0) {
    const fp = node.fingerprint256 || node.fingerprint || ''
    if (fp && seen.has(fp)) break
    if (fp) seen.add(fp)
    chain.push(buildCertificateInfo(node.raw))
    const next: tls.DetailedPeerCertificate | undefined = node.issuerCertificate
    if (!next || next === node || !next.raw || next.raw.length === 0) break
    node = next
  }
  return chain
}

function buildResult(
  socket: tls.TLSSocket,
  opts: TlsInspectOptions,
  port: number,
  servername: string,
): TlsProbeSuccess {
  const result: TlsProbeSuccess = {
    ok: true,
    host: opts.host,
    port,
    servername,
    protocol: null,
    cipher: null,
    alpnProtocol: false,
    authorized: false,
    hostnameValid: false,
    chain: [],
    selfSigned: false,
    expired: false,
    notYetValid: false,
    daysToExpiry: 0,
    validityStatus: 'expired',
  }

  const peer = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate
  const chain = peer && peer.raw && peer.raw.length > 0 ? walkChain(peer) : []
  result.chain = chain

  // Trust verdict — the VALIDATE side. `rejectUnauthorized:false` means the
  // handshake always completes, so we read the verdict off the socket instead
  // of relying on a thrown error.
  result.authorized = socket.authorized === true
  result.authorizationError = normaliseAuthError(socket.authorizationError)

  // Hostname verdict (F-1) — reuse Node's own verifier, coerced to a boolean.
  try {
    const leafPeer = socket.getPeerCertificate(false)
    if (leafPeer && Object.keys(leafPeer).length > 0) {
      const idErr = tls.checkServerIdentity(servername || opts.host, leafPeer)
      result.hostnameValid = idErr === undefined
    } else {
      result.hostnameValid = false
    }
  } catch {
    result.hostnameValid = false
  }

  // Negotiated transport metadata.
  result.protocol = socket.getProtocol()
  const cipher = socket.getCipher()
  result.cipher = cipher
    ? {
        name: cipher.name,
        standardName: cipher.standardName ?? cipher.name,
        version: cipher.version,
      }
    : null
  result.alpnProtocol = typeof socket.alpnProtocol === 'string' ? socket.alpnProtocol : false

  // Validity, derived from the presented leaf.
  const leaf = chain[0]
  if (leaf) {
    const now = new Date()
    const notBefore = new Date(leaf.notBefore)
    const notAfter = new Date(leaf.notAfter)
    result.notYetValid = !Number.isNaN(notBefore.getTime()) && now < notBefore
    result.expired = !Number.isNaN(notAfter.getTime()) && now > notAfter
    result.daysToExpiry = Number.isNaN(notAfter.getTime())
      ? 0
      : Math.floor((notAfter.getTime() - now.getTime()) / MS_PER_DAY)
    result.validityStatus = classifyExpiry(notAfter, now)
    // Self-signed: subject == issuer on the leaf (a single-element chain whose
    // issuer is itself). Corroborated by Node's authorizationError when present.
    result.selfSigned = leaf.subjectDN === leaf.issuerDN
  }

  return result
}

/**
 * Inspect a TLS endpoint. NEVER throws for a reachable-but-invalid certificate
 * — a bad cert yields `ok:true` with `authorized:false`. Only a transport
 * failure (DNS, refused, reset, timeout) or a handled precondition (legacy TLS,
 * missing host) yields `ok:false` with an `error`.
 */
/**
 * Build the `tls.connect` options for a probe. Extracted as a PURE, exported
 * helper so the F-2 CA-merge property — extra anchors are ADDED to the system
 * root store, never REPLACING it (a bare `ca:caCerts` silently drops the public
 * roots and breaks the authorized verdict) — is unit-testable OFFLINE, with no
 * network round-trip. `host`/`port`/`servername` are passed in already-resolved.
 */
export function buildConnectOptions(
  opts: TlsInspectOptions,
  host: string,
  port: number,
  servername: string,
): tls.ConnectionOptions {
  const min = normaliseTlsVersion(opts.minVersion)
  const max = normaliseTlsVersion(opts.maxVersion)
  const ciphers =
    opts.ciphers && opts.ciphers.trim()
      ? opts.ciphers.trim()
      : opts.cipherPreset
        ? getCipherPreset(opts.cipherPreset)
        : undefined

  const connectOpts: tls.ConnectionOptions = {
    host,
    port,
    servername: servername || undefined,
    // PRESENT mode — always complete the handshake so bad endpoints are
    // inspectable; the trust verdict is read from socket.authorized.
    rejectUnauthorized: false,
  }
  if (opts.alpnProtocols && opts.alpnProtocols.length > 0) {
    connectOpts.ALPNProtocols = opts.alpnProtocols
  }
  if (min) connectOpts.minVersion = min
  if (max) connectOpts.maxVersion = max
  if (ciphers) connectOpts.ciphers = ciphers

  // F-2 — MERGE extra CA anchors with the system root store; never replace it.
  // Omit `ca` entirely when none supplied so Node uses the default store.
  if (opts.caCerts && opts.caCerts.length > 0) {
    connectOpts.ca = [...tls.rootCertificates, ...opts.caCerts]
  }

  // F-6 — optional mTLS client cert (already-resolved buffers).
  const cc = opts.clientCert
  if (cc) {
    if (cc.pfx) {
      connectOpts.pfx = cc.pfx
      if (cc.passphrase) connectOpts.passphrase = cc.passphrase
    } else {
      if (cc.cert) connectOpts.cert = cc.cert
      if (cc.key) connectOpts.key = cc.key
      if (cc.passphrase) connectOpts.passphrase = cc.passphrase
    }
  }
  return connectOpts
}

export async function inspectTls(opts: TlsInspectOptions): Promise<TlsInspectResult> {
  const host = (opts.host ?? '').trim()
  const port = opts.port ?? DEFAULT_PORT
  const servername = (opts.servername ?? host).trim() || host
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!host) {
    return failure(opts, port, servername, 'Host is required')
  }

  // F-3 — Electron 33 BoringSSL cannot negotiate TLS 1.0/1.1; there is no curl
  // fallback for raw cert inspection. Refuse BEFORE tls.connect so we surface a
  // handled error string instead of a leaked ERR_SSL_INVALID_COMMAND throw.
  if (isLegacyTlsVersion(opts.minVersion) || isLegacyTlsVersion(opts.maxVersion)) {
    return failure(opts, port, servername, 'Electron cannot negotiate TLS 1.0/1.1 for inspection')
  }

  const connectOpts = buildConnectOptions(opts, host, port, servername)

  return new Promise<TlsInspectResult>((resolve) => {
    let settled = false
    let socket: tls.TLSSocket

    const finish = (r: TlsInspectResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.destroy()
      } catch {
        /* already gone */
      }
      resolve(r)
    }

    const timer = setTimeout(() => {
      finish(failure(opts, port, servername, `TLS inspection timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    try {
      socket = tls.connect(connectOpts)
    } catch (e) {
      // Synchronous throw (e.g. an invalid option BoringSSL rejects) — handle it
      // rather than let it escape as an unhandled rejection.
      finish(failure(opts, port, servername, errString(e)))
      return
    }

    socket.once('secureConnect', () => {
      try {
        finish(buildResult(socket, opts, port, servername))
      } catch (e) {
        finish(failure(opts, port, servername, errString(e)))
      }
    })

    socket.once('error', (err) => {
      finish(failure(opts, port, servername, errString(err)))
    })
    // Timeout is enforced by the module-level `timer` above (socket.setTimeout is
    // never armed), which always destroys the socket via finish().
  })
}
