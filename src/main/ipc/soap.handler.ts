import { ipcMain } from 'electron'
import {
  parseWsdl,
  parseWsdlFromContent,
  executeSoap,
  generateEnvelope,
  type SoapExecuteOptions,
  type SoapVersion,
  type WsSecurityConfig,
} from '../protocols/soap.engine'
import { logRequestResponse } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

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
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
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
        sslVerification: payload.sslVerification,
      }

      const result = await executeSoap(options)

      // SOAP-Fault detection: SOAP 11/12 reports faults inside the body even
      // when the HTTP status is 200. Tag those as errors so users notice.
      const bodyStr = result.body ?? ''
      const isFault = /<(?:[^>:\s]+:)?Fault[\s>]/i.test(bodyStr)

      logRequestResponse({
        protocol: 'soap',
        method: 'POST',
        url: payload.endpointUrl,
        status: result.status,
        statusText: result.statusText,
        durationMs: result.timing?.total,
        sizeBytes: result.bodySize,
        requestHeaders: result.actualRequest?.headers,
        requestBody: result.actualRequest?.body,
        responseHeaders: result.headers,
        responseBody: result.body,
        error: result.error
          ? { message: result.error }
          : isFault
            ? { message: 'SOAP Fault returned' }
            : undefined,
        tabId: payload._tabId,
        meta: {
          operation: payload.operationName,
          soapVersion: payload.soapVersion,
          fault: isFault,
        },
      })

      try {
        historyRepo.addHistory({
          workspace_id: payload._workspaceId,
          project_id: payload._projectId,
          endpoint_id: payload._endpointId,
          protocol: 'soap',
          method: 'POST',
          url: payload.endpointUrl,
          status_code: result.status,
          duration_ms: result.timing?.total ? Math.round(result.timing.total) : undefined,
          request_snapshot: JSON.stringify({
            wsdlUrl: payload.wsdlUrl,
            endpointUrl: payload.endpointUrl,
            operationName: payload.operationName,
            serviceName: payload.serviceName,
            portName: payload.portName,
            soapVersion: payload.soapVersion,
            params: payload.params,
            headers: result.actualRequest?.headers ?? payload.headers,
            envelope: result.actualRequest?.body,
          }),
          response_snapshot: JSON.stringify({
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
            body: result.body && result.body.length <= 500_000 ? result.body : undefined,
            bodySize: result.bodySize,
            timing: result.timing,
            fault: isFault,
            error: result.error,
          }),
        })
      } catch {
        // Never let history failures break the request result.
      }

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
        payload.namespace,
      )
      return { success: true, data: envelope }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
