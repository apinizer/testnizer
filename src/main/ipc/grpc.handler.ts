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
import { logRequestResponse, logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'
import { createPendingRegistry } from '../lib/pending-cancellables'

const pendingUnaryRequests = createPendingRegistry()

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
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Renderer-generated id so `grpc:cancelUnary(id)` can abort this call. */
  _requestId?: string
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
  responseStream?: boolean
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
    const requestId = payload._requestId
    let controller: AbortController | undefined
    try {
      if (requestId) {
        controller = new AbortController()
        pendingUnaryRequests.register(requestId, () => controller?.abort())
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
        signal: controller?.signal,
      }

      const fullMethod = `${payload.serviceName}/${payload.methodName}`
      const response = await executeUnary(options)

      logRequestResponse({
        protocol: 'grpc',
        method: 'unary',
        url: `${payload.serverAddress}/${fullMethod}`,
        status: response.grpcStatus,
        statusText: response.grpcStatusMessage,
        durationMs: response.timing?.total,
        sizeBytes: response.bodySize,
        requestHeaders: payload.metadata,
        requestBody: payload.requestBody,
        responseHeaders: response.responseMetadata,
        responseBody: response.body,
        error: response.error
          ? { message: response.error }
          : response.grpcStatus != null && response.grpcStatus !== 0
            ? { message: response.grpcStatusMessage || `gRPC code ${response.grpcStatus}` }
            : undefined,
        tabId: payload._tabId,
        meta: { method: fullMethod },
      })

      try {
        historyRepo.addHistory({
          workspace_id: payload._workspaceId,
          project_id: payload._projectId,
          endpoint_id: payload._endpointId,
          protocol: 'grpc',
          method: 'unary',
          url: `${payload.serverAddress}/${fullMethod}`,
          status_code: response.grpcStatus ?? undefined,
          duration_ms: response.timing?.total ? Math.round(response.timing.total) : undefined,
          request_snapshot: JSON.stringify({
            serverAddress: payload.serverAddress,
            protoPath: payload.protoPath,
            serviceName: payload.serviceName,
            methodName: payload.methodName,
            metadata: payload.metadata,
            requestBody: payload.requestBody,
            useTls: payload.useTls,
          }),
          response_snapshot: JSON.stringify({
            grpcStatus: response.grpcStatus,
            grpcStatusMessage: response.grpcStatusMessage,
            responseMetadata: response.responseMetadata,
            body: response.body && response.body.length <= 500_000 ? response.body : undefined,
            bodySize: response.bodySize,
            timing: response.timing,
            error: response.error,
          }),
        })
      } catch {
        // never propagate history failures
      }

      return { success: true, data: response }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    } finally {
      if (requestId) pendingUnaryRequests.dispose(requestId)
    }
  })

  // ─── Cancel an in-flight unary call ─────────────────────────
  // Streaming methods already have `grpc:cancelStream` (registered below);
  // unary uses a separate registry because the engine surfaces no streamId
  // until the call has effectively completed.
  ipcMain.handle('grpc:cancelUnary', async (_event, requestId: string) => {
    const ok = pendingUnaryRequests.cancel(requestId)
    return { success: true, data: { canceled: ok } }
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
        responseStream: payload.responseStream,
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
