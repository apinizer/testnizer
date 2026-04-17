import { ipcMain, dialog } from 'electron'
import {
  listCertificates,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  type CertificateKind,
} from '../db/certificate.repo'
import { encryptSecret } from '../lib/secure-storage'

interface Ok<T> { success: true; data: T }
interface Err { success: false; error: string }
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
    wrap(() => listCertificates(projectId)))

  ipcMain.handle('certificate:add', (_e, payload: AddPayload) =>
    wrap(() => createCertificate({
      project_id: payload.projectId,
      kind: payload.kind,
      host: payload.host,
      crt_path: payload.crtPath,
      key_path: payload.keyPath,
      pfx_path: payload.pfxPath,
      passphrase: encryptSecret(payload.passphrase),
      enabled: payload.enabled,
    })))

  ipcMain.handle('certificate:update', (_e, payload: UpdatePayload) =>
    wrap(() => updateCertificate(payload.id, {
      host: payload.host,
      crt_path: payload.crtPath,
      key_path: payload.keyPath,
      pfx_path: payload.pfxPath,
      passphrase: payload.passphrase !== undefined
        ? encryptSecret(payload.passphrase)
        : undefined,
      enabled: payload.enabled,
    })))

  ipcMain.handle('certificate:delete', (_e, id: string) =>
    wrap(() => { deleteCertificate(id); return true }))

  ipcMain.handle('certificate:pickFile', async (_e, kind: 'crt' | 'key' | 'pfx' | 'ca') => {
    const filters = kind === 'pfx'
      ? [{ name: 'PFX/P12', extensions: ['pfx', 'p12'] }]
      : kind === 'key'
      ? [{ name: 'Key', extensions: ['key', 'pem'] }]
      : [{ name: 'Certificate', extensions: ['crt', 'cer', 'pem'] }]
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false as const, error: 'Cancelled' }
    }
    return { success: true as const, data: result.filePaths[0] }
  })
}
