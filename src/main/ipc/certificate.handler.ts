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
}

interface UpdatePayload {
  id: string
  host?: string
  crtPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
  enabled?: boolean
}

export function registerCertificateHandlers(): void {
  ipcMain.handle('certificate:list', (_e, projectId: string) =>
    wrap(() => listCertificates(projectId)),
  )

  ipcMain.handle('certificate:add', (_e, payload: AddPayload) =>
    wrap(() =>
      createCertificate({
        project_id: payload.projectId,
        kind: payload.kind,
        host: payload.host,
        crt_path: payload.crtPath,
        key_path: payload.keyPath,
        pfx_path: payload.pfxPath,
        passphrase: encryptSecret(payload.passphrase),
        enabled: payload.enabled,
      }),
    ),
  )

  ipcMain.handle('certificate:update', (_e, payload: UpdatePayload) =>
    wrap(() =>
      updateCertificate(payload.id, {
        host: payload.host,
        crt_path: payload.crtPath,
        key_path: payload.keyPath,
        pfx_path: payload.pfxPath,
        passphrase:
          payload.passphrase !== undefined ? encryptSecret(payload.passphrase) : undefined,
        enabled: payload.enabled,
      }),
    ),
  )

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
