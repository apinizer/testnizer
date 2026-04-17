import { safeStorage } from 'electron'

// Marker prefix that lets us tell an encrypted value apart from plain
// legacy data that may already be sitting in the database / electron-store.
const ENC_PREFIX = 'enc:v1:'

/**
 * Encrypt a string using the OS-provided keychain (Electron safeStorage).
 *
 * Returns the original plaintext as-is on platforms where encryption is
 * not available, so callers remain functional even when the OS keychain
 * cannot be reached (e.g. headless CI, fresh Linux install).
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  // Idempotent: already-encrypted values are returned unchanged.
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext
  try {
    if (!safeStorage.isEncryptionAvailable()) return plaintext
    const buf = safeStorage.encryptString(plaintext)
    return ENC_PREFIX + buf.toString('base64')
  } catch {
    return plaintext
  }
}

/**
 * Decrypt a value produced by {@link encryptSecret}. Values that do not
 * carry the prefix are assumed to be legacy plaintext and returned
 * unchanged, so migration is seamless.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null
  if (!stored.startsWith(ENC_PREFIX)) return stored
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const b64 = stored.slice(ENC_PREFIX.length)
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
