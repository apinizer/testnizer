/**
 * `tls:inspect` IPC handler (#64, Faz F).
 *
 * Bridges the renderer's TLS Inspector to `inspectTls` in main. The renderer
 * never touches the network (CSP `connect-src 'self'`); all TLS work happens
 * here. The response is PUBLIC-ONLY — a certificate chain + trust/hostname
 * verdicts. No private key bytes are ever returned (NO-LEAK invariant).
 *
 * Client-cert resolution for an mTLS probe (F-6) happens LOCALLY in this
 * handler — inline PEM is turned into buffers, file paths are read with a
 * 1 MiB cap + realpath (mirroring `certificate.handler.ts` pickFile). There is
 * NO `resolveKeyMaterial` (a later #60 deliverable); the keystore
 * `MaterialSource` branch is added when #60 lands. "Use from keystore" is one
 * added option, never mandatory.
 */

import { ipcMain } from 'electron'
import { readFileSync, realpathSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { ipcResult, type IpcResult } from '../lib/ipc-helpers'
import {
  inspectTls,
  type TlsInspectOptions,
  type TlsInspectResult,
  type TlsInspectClientCert,
} from '../protocols/tls-inspect.engine'
import type { CipherPresetName } from '../lib/tls-presets'

// Same cap the certificate picker uses — a mis-supplied path must not read a
// multi-GB file into memory.
const MAX_CERT_BYTES = 1024 * 1024 // 1 MiB

/** Inline PEM/PFX client-cert material carried over IPC (renderer-safe). */
interface InlineClientCert {
  kind: 'inline'
  certPem?: string
  keyPem?: string
  /** PFX/P12 bytes, base64-encoded. */
  pfxBase64?: string
  passphrase?: string
}

/** File-path client-cert material — read locally in main. */
interface FileClientCert {
  kind: 'file'
  certPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
}

type ClientCertSource = InlineClientCert | FileClientCert

interface TlsInspectPayload {
  host: string
  port?: number
  servername?: string
  alpnProtocols?: string[]
  minVersion?: string
  maxVersion?: string
  ciphers?: string
  cipherPreset?: CipherPresetName
  timeoutMs?: number
  /** Extra trust anchors — base64-encoded PEM or DER (F-2 merge in engine). */
  caCerts?: string[]
  clientCert?: ClientCertSource
}

/** Read a file with a realpath resolve + 1 MiB cap (mirror of pickFile read). */
function readCappedFile(path: string): Buffer {
  const real = realpathSync(path)
  const bytes = readFileSync(real)
  if (bytes.length > MAX_CERT_BYTES) {
    throw new Error('That file is larger than 1 MiB — it does not look like a certificate/key.')
  }
  return bytes
}

/**
 * Resolve a client-cert source to already-parsed buffers. Inline PEM is
 * validated with `node:crypto` (a bad cert fails loud here, not mid-handshake);
 * files are read with the shared cap. Returns undefined when nothing usable was
 * supplied so the probe stays a plain (non-mTLS) inspection.
 */
function resolveClientCert(src: ClientCertSource | undefined): TlsInspectClientCert | undefined {
  if (!src) return undefined

  if (src.kind === 'inline') {
    const out: TlsInspectClientCert = {}
    if (src.certPem && src.certPem.trim()) {
      // Validate the cert PEM up front (node:crypto) — reject garbage early.

      new X509Certificate(src.certPem)
      out.cert = Buffer.from(src.certPem, 'utf8')
    }
    if (src.keyPem && src.keyPem.trim()) out.key = Buffer.from(src.keyPem, 'utf8')
    if (src.pfxBase64 && src.pfxBase64.trim()) {
      out.pfx = Buffer.from(src.pfxBase64.replace(/\s+/g, ''), 'base64')
    }
    if (src.passphrase) out.passphrase = src.passphrase
    if (!out.cert && !out.key && !out.pfx) return undefined
    return out
  }

  // kind === 'file'
  const out: TlsInspectClientCert = {}
  if (src.certPath) out.cert = readCappedFile(src.certPath)
  if (src.keyPath) out.key = readCappedFile(src.keyPath)
  if (src.pfxPath) out.pfx = readCappedFile(src.pfxPath)
  if (src.passphrase) out.passphrase = src.passphrase
  if (!out.cert && !out.key && !out.pfx) return undefined
  return out
}

/** Decode base64 CA anchors (PEM or DER) into buffers tls.connect accepts. */
function resolveCaCerts(caCerts: string[] | undefined): Buffer[] | undefined {
  if (!caCerts || caCerts.length === 0) return undefined
  const out = caCerts
    .filter((c) => c && c.trim())
    .map((c) => Buffer.from(c.replace(/\s+/g, ''), 'base64'))
    .filter((b) => b.length > 0)
  return out.length > 0 ? out : undefined
}

export function buildInspectOptions(payload: TlsInspectPayload): TlsInspectOptions {
  return {
    host: payload.host,
    port: payload.port,
    servername: payload.servername,
    alpnProtocols: payload.alpnProtocols,
    minVersion: payload.minVersion,
    maxVersion: payload.maxVersion,
    ciphers: payload.ciphers,
    cipherPreset: payload.cipherPreset,
    timeoutMs: payload.timeoutMs,
    caCerts: resolveCaCerts(payload.caCerts),
    clientCert: resolveClientCert(payload.clientCert),
  }
}

export function registerTlsHandlers(): void {
  ipcMain.handle(
    'tls:inspect',
    (_e, payload: TlsInspectPayload): Promise<IpcResult<TlsInspectResult>> =>
      ipcResult(() => inspectTls(buildInspectOptions(payload))),
  )
}
