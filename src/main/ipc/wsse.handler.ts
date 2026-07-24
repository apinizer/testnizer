import { ipcMain } from 'electron'
import {
  applyWsSecurity,
  verifySignature,
  decryptEnvelope,
  type WsSecurityConfig,
} from '../protocols/wsse.engine'
import { resolveWsseKeyMaterial } from '../lib/wsse-key-material'

interface ApplyPayload {
  envelope: string
  config: WsSecurityConfig
}

interface VerifyPayload {
  envelope: string
  certPem: string
}

interface DecryptPayload {
  envelope: string
  privateKeyPem: string
  passphrase?: string
}

type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function registerWsseHandlers(): void {
  ipcMain.handle(
    'wsse:apply',
    async (_event, payload: ApplyPayload): Promise<IpcResult<string>> => {
      try {
        // Junction 1 of 2 (#60 / reconcile C-2): resolve `sign.keySource` HERE,
        // in the orchestration layer, so the standalone WS-Security tool honours
        // "Use from keystore" exactly like the SOAP path does. With no
        // keySource this is a no-op and the pasted-PEM config passes through
        // untouched. Only the signed XML goes back to the renderer — the
        // resolved PEM never leaves main.
        const config = resolveWsseKeyMaterial(payload.config)
        const result = await applyWsSecurity(payload.envelope, config)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: errorMessage(e) }
      }
    },
  )

  ipcMain.handle('wsse:verify', async (_event, payload: VerifyPayload) => {
    try {
      const result = verifySignature(payload.envelope, payload.certPem)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: errorMessage(e) }
    }
  })

  ipcMain.handle(
    'wsse:decrypt',
    async (_event, payload: DecryptPayload): Promise<IpcResult<string>> => {
      try {
        const result = await decryptEnvelope(
          payload.envelope,
          payload.privateKeyPem,
          payload.passphrase,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: errorMessage(e) }
      }
    },
  )
}
