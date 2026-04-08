import { ipcMain } from 'electron'
import {
  parseWsdl,
  parseWsdlFromContent,
  executeSoap,
  generateEnvelope,
  type SoapExecuteOptions,
  type SoapVersion,
  type WsSecurityConfig
} from '../protocols/soap.engine'

interface SoapExecutePayload {
  wsdlUrl: string
  endpointUrl: string
  operationName: string
  serviceName?: string
  portName?: string
  soapVersion: SoapVersion
  params: Record<string, unknown>
  headers?: Record<string, string>
  wsSecurity?: WsSecurityConfig
  timeout?: number
  sslVerification?: boolean
}

interface GenerateEnvelopePayload {
  operationName: string
  params: Record<string, unknown>
  soapVersion: SoapVersion
  soapAction?: string
  namespace?: string
}

export function registerSoapHandlers(): void {
  // ─── Parse WSDL from URL ────────────────────────────────────
  ipcMain.handle('wsdl:parse', async (_event, url: string) => {
    try {
      const result = await parseWsdl(url)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Parse WSDL from file content ──────────────────────────
  ipcMain.handle('wsdl:parseFile', async (_event, content: string) => {
    try {
      const result = await parseWsdlFromContent(content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Execute SOAP request ─────────────────────────────────
  ipcMain.handle('soap:execute', async (_event, payload: SoapExecutePayload) => {
    try {
      const options: SoapExecuteOptions = {
        wsdlUrl: payload.wsdlUrl,
        endpointUrl: payload.endpointUrl,
        operationName: payload.operationName,
        serviceName: payload.serviceName,
        portName: payload.portName,
        soapVersion: payload.soapVersion,
        params: payload.params,
        headers: payload.headers,
        wsSecurity: payload.wsSecurity,
        timeout: payload.timeout,
        sslVerification: payload.sslVerification
      }
      const result = await executeSoap(options)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Generate SOAP envelope (without executing) ───────────
  ipcMain.handle('soap:generateEnvelope', async (_event, payload: GenerateEnvelopePayload) => {
    try {
      const envelope = generateEnvelope(
        payload.operationName,
        payload.params,
        payload.soapVersion,
        payload.soapAction,
        payload.namespace
      )
      return { success: true, data: envelope }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
