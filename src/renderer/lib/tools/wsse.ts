/**
 * Renderer-side IPC wrapper for the WS-Security engine.
 *
 * The actual sign/verify/encrypt/decrypt logic runs in the main process
 * (`src/main/protocols/wsse.engine.ts`) since it depends on Node's `crypto`
 * module + xml-crypto/xml-encryption (none of which work in the browser).
 */

import type {
  WsSecurityConfig,
  WsSecurityMode,
  WsUsernameTokenConfig,
  WsTimestampConfig,
  WsSignConfig,
  WsEncryptConfig,
} from '../../types'

interface IpcSuccess<T> {
  success: true
  data: T
}
interface IpcFailure {
  success: false
  error: string
}
type IpcResult<T> = IpcSuccess<T> | IpcFailure

interface VerifyResult {
  valid: boolean
  reason?: string
  signedReferences: string[]
  certInfo?: {
    subject?: string
    issuer?: string
    notAfter?: string
    notBefore?: string
  }
}

interface WsseBridge {
  apply: (payload: { envelope: string; config: WsSecurityConfig }) => Promise<IpcResult<string>>
  verify: (payload: { envelope: string; certPem: string }) => Promise<IpcResult<VerifyResult>>
  decrypt: (payload: {
    envelope: string
    privateKeyPem: string
    passphrase?: string
  }) => Promise<IpcResult<string>>
}

function getBridge(): WsseBridge {
  const w = window as unknown as { api?: { wsse?: WsseBridge } }
  if (!w.api?.wsse) {
    throw new Error('WS-Security IPC bridge unavailable (renderer not connected to main process)')
  }
  return w.api.wsse
}

export async function applyWsSecurity(envelope: string, config: WsSecurityConfig): Promise<string> {
  const result = await getBridge().apply({ envelope, config })
  if (!result.success) throw new Error(result.error)
  return result.data
}

export async function verifySignature(envelope: string, certPem: string): Promise<VerifyResult> {
  const result = await getBridge().verify({ envelope, certPem })
  if (!result.success) throw new Error(result.error)
  return result.data
}

export async function decryptEnvelope(
  envelope: string,
  privateKeyPem: string,
  passphrase?: string,
): Promise<string> {
  const result = await getBridge().decrypt({ envelope, privateKeyPem, passphrase })
  if (!result.success) throw new Error(result.error)
  return result.data
}

// ─── Default config helpers ─────────────────────────────────

export function defaultUsernameToken(): WsUsernameTokenConfig {
  return {
    username: '',
    password: '',
    passwordType: 'PasswordText',
    nonce: false,
    created: false,
  }
}

export function defaultTimestamp(): WsTimestampConfig {
  return { ttlSeconds: 300 }
}

export function defaultSignConfig(): WsSignConfig {
  return {
    privateKeyPem: '',
    certPem: '',
    algorithm: 'RSA-SHA256',
    references: ['Body'],
    keyInfoStrategy: 'BinarySecurityToken',
  }
}

export function defaultEncryptConfig(): WsEncryptConfig {
  return {
    recipientCertPem: '',
    algorithm: 'AES-256-CBC',
    keyWrap: 'RSA-OAEP',
  }
}

export function buildSingleModeConfig(
  mode: WsSecurityMode,
  partial: Partial<WsSecurityConfig>,
): WsSecurityConfig {
  return {
    enabled: true,
    modes: [mode],
    usernameToken: partial.usernameToken,
    timestamp: partial.timestamp,
    sign: partial.sign,
    encrypt: partial.encrypt,
  }
}
