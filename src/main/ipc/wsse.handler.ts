import { ipcMain } from 'electron'
import {
  applyWsSecurity,
  verifySignature,
  decryptEnvelope,
  type WsSecurityConfig,
} from '../protocols/wsse.engine'

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
        const result = await applyWsSecurity(payload.envelope, payload.config)
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
