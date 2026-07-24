import { ipcMain, dialog, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import {
  listCertificates,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  type CertificateKind,
  type CertificateRow,
  type CertificateSource,
} from '../db/certificate.repo'
import { encryptSecret } from '../lib/secure-storage'

// Cap the file we're willing to ingest as certificate material (mirror the
// request-time reader) so a mis-pick can't copy a multi-GB file into userData.
const MAX_CERT_BYTES = 1024 * 1024 // 1 MiB

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

interface AddPayload {
  projectId: string
  kind: CertificateKind
  host?: string
  crtPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
  enabled?: boolean
  /** #60 — ADDED, optional. Omitted ⇒ repo default 'file' = the classic path. */
  source?: CertificateSource
  keystoreId?: string
  keystoreAlias?: string
  /** R11 per-alias ENTRY password. WRITE-ONLY — never returned by `list`. */
  keystoreKeyPassword?: string
}

interface UpdatePayload {
  id: string
  host?: string
  crtPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
  enabled?: boolean
  /** #60 — ADDED, optional. Absent fields are left untouched by the repo. */
  source?: CertificateSource
  keystoreId?: string
  keystoreAlias?: string
  /** R11 per-alias ENTRY password. WRITE-ONLY; '' clears, undefined keeps. */
  keystoreKeyPassword?: string
}

/**
 * Renderer-facing projection of a certificate row.
 *
 * NO-LEAK: the two secret columns never cross the IPC boundary — the renderer
 * gets a boolean saying whether one is SET, which is all the UI needs to render
 * a write-only password field. Sending the stored value back would also make it
 * cleartext-visible on installs where `safeStorage` is unavailable (there,
 * `encryptSecret` stores the raw string).
 */
type CertificateDto = Omit<CertificateRow, 'passphrase' | 'keystore_key_password'> & {
  has_passphrase: boolean
  has_keystore_key_password: boolean
}

function toDto(row: CertificateRow): CertificateDto {
  const { passphrase, keystore_key_password, ...rest } = row
  return {
    ...rest,
    has_passphrase: passphrase != null && passphrase !== '',
    has_keystore_key_password: keystore_key_password != null && keystore_key_password !== '',
  }
}

export function registerCertificateHandlers(): void {
  ipcMain.handle('certificate:list', (_e, projectId: string) =>
    wrap(() => listCertificates(projectId).map(toDto)),
  )

  ipcMain.handle('certificate:add', (_e, payload: AddPayload) =>
    wrap(() =>
      toDto(
        createCertificate({
          project_id: payload.projectId,
          kind: payload.kind,
          host: payload.host,
          crt_path: payload.crtPath,
          key_path: payload.keyPath,
          pfx_path: payload.pfxPath,
          passphrase: encryptSecret(payload.passphrase),
          enabled: payload.enabled,
          source: payload.source,
          keystore_id: payload.keystoreId,
          keystore_alias: payload.keystoreAlias,
          keystore_key_password: encryptSecret(payload.keystoreKeyPassword),
        }),
      ),
    ),
  )

  ipcMain.handle('certificate:update', (_e, payload: UpdatePayload) => {
    // A keystore row must never be left half-linked: `source:'keystore'` is only
    // accepted together with the alias it points at (see the renderer's atomic
    // pick), otherwise every Send AND every Runner iteration for that row would
    // fail loud until an alias is chosen.
    if (payload.source === 'keystore' && !payload.keystoreId) {
      return Promise.resolve({
        success: false as const,
        error:
          'A keystore-backed certificate needs a keystore and alias — pick one before switching the source.',
      })
    }
    return wrap(() => {
      const row = updateCertificate(payload.id, {
        host: payload.host,
        crt_path: payload.crtPath,
        key_path: payload.keyPath,
        pfx_path: payload.pfxPath,
        passphrase:
          payload.passphrase !== undefined ? encryptSecret(payload.passphrase) : undefined,
        enabled: payload.enabled,
        source: payload.source,
        // '' is the renderer's "unlink" signal → NULL out the column; undefined
        // leaves it untouched (an old-shape patch can never drop the link).
        keystore_id: payload.keystoreId === '' ? null : payload.keystoreId,
        keystore_alias: payload.keystoreAlias === '' ? null : payload.keystoreAlias,
        keystore_key_password:
          payload.keystoreKeyPassword === ''
            ? null
            : payload.keystoreKeyPassword !== undefined
              ? encryptSecret(payload.keystoreKeyPassword)
              : undefined,
      })
      return row ? toDto(row) : undefined
    })
  })

  ipcMain.handle('certificate:delete', (_e, id: string) =>
    wrap(() => {
      deleteCertificate(id)
      return true
    }),
  )

  ipcMain.handle('certificate:pickFile', async (_e, kind: 'crt' | 'key' | 'pfx' | 'ca') => {
    const filters =
      kind === 'pfx'
        ? [{ name: 'PFX/P12', extensions: ['pfx', 'p12'] }]
        : kind === 'key'
          ? [{ name: 'Key', extensions: ['key', 'pem'] }]
          : [{ name: 'Certificate', extensions: ['crt', 'cer', 'pem'] }]
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false as const, error: 'Cancelled' }
    }
    const src = result.filePaths[0]
    // Read the bytes NOW — while the user's explicit picker selection grants
    // access — and copy them into the app's own storage (userData is never a
    // macOS TCC-protected folder). Storing the ORIGINAL path and re-reading it
    // at request time throws EPERM when the file lives in ~/Downloads,
    // ~/Desktop or ~/Documents, so the request silently went out without the
    // client cert (the reported mTLS bug). Postman avoids this by capturing the
    // content at pick time; we do the same, and store the safe copy's path.
    try {
      const bytes = readFileSync(src)
      if (bytes.length > MAX_CERT_BYTES) {
        return {
          success: false as const,
          error: 'That file is larger than 1 MiB — it does not look like a certificate/key.',
        }
      }
      const destDir = join(app.getPath('userData'), 'certs')
      mkdirSync(destDir, { recursive: true })
      // Keep the original filename (so the settings row stays recognisable),
      // prefixed with a short unique token so repeated picks never collide.
      const dest = join(destDir, `${randomUUID().slice(0, 8)}-${basename(src)}`)
      writeFileSync(dest, bytes, { mode: 0o600 })
      return { success: true as const, data: dest }
    } catch (e) {
      // Surface the failure at pick time instead of letting a broken path sit in
      // settings and fail every future request.
      return {
        success: false as const,
        error: `Couldn't read the selected file: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  })
}
