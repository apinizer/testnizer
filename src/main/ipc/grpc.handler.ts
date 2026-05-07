import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  loadProto,
  loadProtoFromUrl,
  executeUnary,
  executeServerStream,
  executeClientStream,
  startBidiStream,
  sendStreamMessage,
  endStream,
  cancelStream,
  loadFromReflection,
  type GrpcExecuteOptions,
  type GrpcClientStreamOptions,
  type GrpcBidiStreamOptions,
} from '../protocols/grpc.engine'
import { logRequest, logResponse, logEvent } from '../lib/console-logger'

interface GrpcExecutePayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  requestBody: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
  sslVerification?: boolean
  _tabId?: string
}

interface GrpcServerStreamPayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  requestBody: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
  sslVerification?: boolean
  _tabId?: string
}

interface GrpcClientStreamPayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  messages: string[]
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

interface GrpcBidiStreamPayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

export function registerGrpcHandlers(): void {
  // ─── Load proto file (show file dialog) ─────────────────────
  ipcMain.handle('grpc:loadProto', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Proto File',
        filters: [
          { name: 'Proto Files', extensions: ['proto'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }

      const protoPath = result.filePaths[0]
      const serviceDescription = await loadProto(protoPath)
      return { success: true, data: serviceDescription }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Load proto file from a URL ─────────────────────────────
  ipcMain.handle('grpc:loadProtoFromUrl', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'URL is required' }
      }
      const serviceDescription = await loadProtoFromUrl(url)
      return { success: true, data: serviceDescription }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Execute unary call ─────────────────────────────────────
  ipcMain.handle('grpc:execute', async (_event, payload: GrpcExecutePayload) => {
    try {
      const options: GrpcExecuteOptions = {
        serverAddress: payload.serverAddress,
        protoPath: payload.protoPath,
        serviceName: payload.serviceName,
        methodName: payload.methodName,
        requestBody: payload.requestBody,
        metadata: payload.metadata,
        timeout: payload.timeout,
        useTls: payload.useTls,
        sslVerification: payload.sslVerification,
      }

      const fullMethod = `${payload.serviceName}/${payload.methodName}`
      logRequest({
        protocol: 'grpc',
        method: 'unary',
        url: `${payload.serverAddress}/${fullMethod}`,
        body: payload.requestBody,
        headers: payload.metadata,
        tabId: payload._tabId,
        message: `gRPC unary ${fullMethod}`,
        meta: { tls: !!payload.useTls },
      })

      const response = await executeUnary(options)

      logResponse({
        protocol: 'grpc',
        method: 'unary',
        url: `${payload.serverAddress}/${fullMethod}`,
        status: response.grpcStatus,
        statusText: response.grpcStatusMessage,
        durationMs: response.timing?.total,
        sizeBytes: response.bodySize,
        requestHeaders: payload.metadata,
        requestBody: payload.requestBody,
        responseBody: response.body,
        error: response.error
          ? { message: response.error }
          : response.grpcStatus != null && response.grpcStatus !== 0
            ? { message: response.grpcStatusMessage || `gRPC code ${response.grpcStatus}` }
            : undefined,
        tabId: payload._tabId,
        meta: { method: fullMethod },
      })

      return { success: true, data: response }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Server stream ──────────────────────────────────────────
  ipcMain.handle('grpc:serverStream', async (event, payload: GrpcServerStreamPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const options: GrpcExecuteOptions = {
        serverAddress: payload.serverAddress,
        protoPath: payload.protoPath,
        serviceName: payload.serviceName,
        methodName: payload.methodName,
        requestBody: payload.requestBody,
        metadata: payload.metadata,
        timeout: payload.timeout,
        useTls: payload.useTls,
        sslVerification: payload.sslVerification,
      }

      const fullMethod = `${payload.serviceName}/${payload.methodName}`
      logEvent({
        protocol: 'grpc',
        category: 'connection',
        message: `gRPC server-stream open: ${fullMethod}`,
        url: `${payload.serverAddress}/${fullMethod}`,
        body: payload.requestBody,
        direction: 'out',
        tabId: payload._tabId,
      })

      const streamId = await executeServerStream(options, win.id)
      return { success: true, data: { streamId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Cancel stream ──────────────────────────────────────────
  ipcMain.handle('grpc:cancelStream', async (_event, streamId: string) => {
    try {
      const result = cancelStream(streamId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Server reflection ────────────────────────────────────────
  ipcMain.handle('grpc:reflect', async (_event, payload: { address: string; useTls?: boolean }) => {
    try {
      const serviceDescription = await loadFromReflection(payload.address, payload.useTls)
      return { success: true, data: serviceDescription }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Client streaming ────────────────────────────────────────
  ipcMain.handle('grpc:clientStream', async (_event, payload: GrpcClientStreamPayload) => {
    try {
      const options: GrpcClientStreamOptions = {
        serverAddress: payload.serverAddress,
        protoPath: payload.protoPath,
        serviceName: payload.serviceName,
        methodName: payload.methodName,
        messages: payload.messages,
        metadata: payload.metadata,
        timeout: payload.timeout,
        useTls: payload.useTls,
      }

      const response = await executeClientStream(options)
      return { success: true, data: response }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Bidi streaming ──────────────────────────────────────────
  ipcMain.handle('grpc:bidiStream', async (event, payload: GrpcBidiStreamPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const options: GrpcBidiStreamOptions = {
        serverAddress: payload.serverAddress,
        protoPath: payload.protoPath,
        serviceName: payload.serviceName,
        methodName: payload.methodName,
        metadata: payload.metadata,
        timeout: payload.timeout,
        useTls: payload.useTls,
      }

      const streamId = await startBidiStream(options, win.id)
      return { success: true, data: { streamId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Send message on active bidi stream ───────────────────────
  ipcMain.handle('grpc:sendStreamMessage', async (_event, streamId: string, message: string) => {
    try {
      const result = sendStreamMessage(streamId, message)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── End client/bidi stream ──────────────────────────────────
  ipcMain.handle('grpc:endStream', async (_event, streamId: string) => {
    try {
      const result = endStream(streamId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
