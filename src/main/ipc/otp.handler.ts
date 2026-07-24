import { ipcMain } from 'electron'
import {
  listOtpEntries,
  getOtpEntry,
  createOtpEntry,
  updateOtpEntry,
  incrementCounter,
  deleteOtpEntry,
  type OtpEntryRow,
} from '../db/otp.repo'
import { encryptSecret, decryptSecret } from '../lib/secure-storage'
import {
  decodeBase32,
  hotp,
  totp,
  parseOtpauthUri,
  buildOtpauthUri,
  type OtpAlgorithm,
  type OtpType,
  type OtpDraft,
} from '../lib/otp'

interface Ok<T> {
  success: true
  data: T
}
interface Err {
  success: false
  error: string
}
type R<T> = Ok<T> | Err

function wrap<T>(fn: () => T | Promise<T>): Promise<R<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true as const, data }))
    .catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) }))
}

/** Renderer-facing entry — deliberately WITHOUT the secret. */
interface OtpEntryMeta {
  id: string
  label: string | null
  issuer: string | null
  account: string | null
  algorithm: OtpAlgorithm
  digits: number
  period: number
  type: OtpType
  counter: number
  enabled: boolean
  hasSecret: boolean
}

interface OtpCode {
  id: string
  code: string | null
  secondsRemaining: number
  error?: string
}

function toMeta(r: OtpEntryRow): OtpEntryMeta {
  return {
    id: r.id,
    label: r.label,
    issuer: r.issuer,
    account: r.account,
    algorithm: r.algorithm,
    digits: r.digits,
    period: r.period,
    type: r.type,
    counter: r.counter,
    enabled: r.enabled === 1,
    hasSecret: !!r.secret,
  }
}

interface OtpAddPayload {
  label?: string | null
  issuer?: string | null
  account?: string | null
  secret: string
  algorithm?: OtpAlgorithm
  digits?: number
  period?: number
  type?: OtpType
  counter?: number
  enabled?: boolean
}

interface OtpUpdatePayload extends Partial<OtpAddPayload> {
  id: string
}

/** Decode a stored entry's secret to raw bytes, throwing a clear message. */
function decodeStoredSecret(row: OtpEntryRow): Buffer {
  const b32 = decryptSecret(row.secret)
  if (!b32) throw new Error('Secret is unavailable (OS encryption is locked or missing).')
  return decodeBase32(b32)
}

function computeCode(row: OtpEntryRow): OtpCode {
  try {
    const secret = decodeStoredSecret(row)
    const opts = { algorithm: row.algorithm, digits: row.digits, period: row.period }
    if (row.type === 'hotp') {
      return { id: row.id, code: hotp(secret, row.counter, opts), secondsRemaining: 0 }
    }
    const { code, secondsRemaining } = totp(secret, opts)
    return { id: row.id, code, secondsRemaining }
  } catch (e) {
    return {
      id: row.id,
      code: null,
      secondsRemaining: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function registerOtpHandlers(): void {
  ipcMain.handle('otp:list', () => wrap((): OtpEntryMeta[] => listOtpEntries().map(toMeta)))

  ipcMain.handle('otp:add', (_e, payload: OtpAddPayload) =>
    wrap((): OtpEntryMeta => {
      // Validate the secret decodes before persisting so a bad entry fails loudly.
      decodeBase32(payload.secret)
      const row = createOtpEntry({
        label: payload.label,
        issuer: payload.issuer,
        account: payload.account,
        secret: encryptSecret(payload.secret) ?? '',
        algorithm: payload.algorithm,
        digits: payload.digits,
        period: payload.period,
        type: payload.type,
        counter: payload.counter,
        enabled: payload.enabled,
      })
      return toMeta(row)
    }),
  )

  ipcMain.handle('otp:update', (_e, payload: OtpUpdatePayload) =>
    wrap((): OtpEntryMeta | null => {
      let secret: string | undefined
      if (payload.secret !== undefined) {
        decodeBase32(payload.secret)
        secret = encryptSecret(payload.secret) ?? ''
      }
      const row = updateOtpEntry(payload.id, {
        label: payload.label,
        issuer: payload.issuer,
        account: payload.account,
        secret,
        algorithm: payload.algorithm,
        digits: payload.digits,
        period: payload.period,
        type: payload.type,
        counter: payload.counter,
        enabled: payload.enabled,
      })
      return row ? toMeta(row) : null
    }),
  )

  ipcMain.handle('otp:delete', (_e, id: string) =>
    wrap(() => {
      deleteOtpEntry(id)
      return true
    }),
  )

  // Current code for every entry (secret never leaves main).
  ipcMain.handle('otp:codes', () => wrap((): OtpCode[] => listOtpEntries().map(computeCode)))

  // Single entry: TOTP recomputes; HOTP advances and persists its counter.
  ipcMain.handle('otp:code', (_e, id: string) =>
    wrap((): OtpCode => {
      const row = getOtpEntry(id)
      if (!row) throw new Error('OTP entry not found.')
      if (row.type === 'hotp') {
        const secret = decodeStoredSecret(row)
        const nextCounter = incrementCounter(id) ?? row.counter + 1
        const opts = { algorithm: row.algorithm, digits: row.digits, period: row.period }
        return { id: row.id, code: hotp(secret, nextCounter, opts), secondsRemaining: 0 }
      }
      return computeCode(row)
    }),
  )

  ipcMain.handle('otp:parseUri', (_e, uri: string) => wrap((): OtpDraft => parseOtpauthUri(uri)))

  // Explicit reveal — returns the plaintext Base32 secret for one entry.
  ipcMain.handle('otp:reveal', (_e, id: string) =>
    wrap((): string => {
      const row = getOtpEntry(id)
      if (!row) throw new Error('OTP entry not found.')
      const b32 = decryptSecret(row.secret)
      if (!b32) throw new Error('Secret is unavailable (OS encryption is locked or missing).')
      return b32
    }),
  )

  // Build the otpauth:// URI (secret-bearing) so the entry can be shown as a QR.
  ipcMain.handle('otp:uri', (_e, id: string) =>
    wrap((): string => {
      const row = getOtpEntry(id)
      if (!row) throw new Error('OTP entry not found.')
      const secret = decryptSecret(row.secret)
      if (!secret) throw new Error('Secret is unavailable (OS encryption is locked or missing).')
      return buildOtpauthUri({
        type: row.type,
        issuer: row.issuer,
        account: row.account,
        label: row.label,
        secret,
        algorithm: row.algorithm,
        digits: row.digits,
        period: row.period,
        counter: row.counter,
      })
    }),
  )
}
