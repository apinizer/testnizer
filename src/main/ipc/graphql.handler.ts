import { ipcMain, BrowserWindow } from 'electron'
import {
  executeQuery,
  introspect,
  subscribe,
  unsubscribe,
  type GraphqlExecuteOptions,
  type GraphqlSubscribeOptions,
} from '../protocols/graphql.engine'
import { logRequest, logResponse, logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

interface GraphqlExecutePayload {
  url: string
  query: string
  variables?: string
  operationName?: string
  headers?: Array<{
    id: string
    key: string
    value: string
    description?: string
    enabled: boolean
  }>
  auth?: {
    type: string
    basic?: { username: string; password: string }
    bearer?: { token: string; prefix?: string }
    apiKey?: { key: string; value: string; in: 'header' | 'query' }
    oauth2?: { token?: string }
  }
  timeout?: number
  sslVerification?: boolean
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
}

interface GraphqlIntrospectPayload {
  url: string
  headers?: Record<string, string>
  sslVerification?: boolean
}

interface GraphqlSubscribePayload {
  url: string
  wsUrl?: string
  query: string
  variables?: string
  operationName?: string
  headers?: Record<string, string>
  sslVerification?: boolean
  _tabId?: string
}

export function registerGraphqlHandlers(): void {
  // ─── Execute GraphQL query/mutation ─────────────────────────
  ipcMain.handle('graphql:execute', async (_event, payload: GraphqlExecutePayload) => {
    try {
      const options: GraphqlExecuteOptions = {
        url: payload.url,
        query: payload.query,
        variables: payload.variables,
        operationName: payload.operationName,
        headers: payload.headers,
        auth: payload.auth,
        timeout: payload.timeout,
        sslVerification: payload.sslVerification,
      }

      const opName = payload.operationName || 'anonymous'
      logRequest({
        protocol: 'graphql',
        method: 'POST',
        url: payload.url,
        body: payload.query,
        tabId: payload._tabId,
        message: `GraphQL ${opName} → ${payload.url}`,
        meta: { operation: opName },
      })

      const response = await executeQuery(options)

      // GraphQL returns 200 even on errors; flag them.
      let hasGqlErrors = false
      try {
        if (response.body) {
          const parsed = JSON.parse(response.body) as { errors?: unknown[] }
          if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
            hasGqlErrors = true
          }
        }
      } catch {
        // not JSON; ignore
      }

      logResponse({
        protocol: 'graphql',
        method: 'POST',
        url: payload.url,
        status: response.status,
        statusText: response.statusText,
        durationMs: response.timing?.total,
        sizeBytes: response.bodySize,
        requestHeaders: response.actualRequest?.headers,
        requestBody: response.actualRequest?.body,
        responseHeaders: response.headers,
        responseBody: response.body,
        error: response.error
          ? { message: response.error }
          : hasGqlErrors
            ? { message: 'GraphQL errors in response' }
            : undefined,
        tabId: payload._tabId,
        meta: { operation: opName, gqlErrors: hasGqlErrors },
      })

      try {
        historyRepo.addHistory({
          workspace_id: payload._workspaceId,
          project_id: payload._projectId,
          endpoint_id: payload._endpointId,
          protocol: 'graphql',
          method: 'POST',
          url: payload.url,
          status_code: response.status,
          duration_ms: response.timing?.total ? Math.round(response.timing.total) : undefined,
          request_snapshot: JSON.stringify({
            url: payload.url,
            query: payload.query,
            variables: payload.variables,
            operationName: payload.operationName,
            headers: response.actualRequest?.headers,
            body: response.actualRequest?.body,
          }),
          response_snapshot: JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: response.body && response.body.length <= 500_000 ? response.body : undefined,
            bodySize: response.bodySize,
            timing: response.timing,
            gqlErrors: hasGqlErrors,
            error: response.error,
          }),
        })
      } catch {
        // History failure is never fatal.
      }

      return { success: true, data: response }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Introspect schema ──────────────────────────────────────
  ipcMain.handle('graphql:introspect', async (_event, payload: GraphqlIntrospectPayload) => {
    try {
      const result = await introspect(payload.url, payload.headers, payload.sslVerification)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Start subscription ─────────────────────────────────────
  ipcMain.handle('graphql:subscribe', async (event, payload: GraphqlSubscribePayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const options: GraphqlSubscribeOptions = {
        url: payload.url,
        wsUrl: payload.wsUrl,
        query: payload.query,
        variables: payload.variables,
        operationName: payload.operationName,
        headers: payload.headers,
        sslVerification: payload.sslVerification,
      }

      logEvent({
        protocol: 'graphql',
        category: 'connection',
        message: `GraphQL subscription started: ${payload.operationName || 'anonymous'}`,
        url: payload.wsUrl ?? payload.url,
        body: payload.query,
        direction: 'out',
        tabId: payload._tabId,
      })

      const subscriptionId = subscribe(options, win.id)
      return { success: true, data: { subscriptionId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Stop subscription ──────────────────────────────────────
  ipcMain.handle('graphql:unsubscribe', async (_event, subscriptionId: string) => {
    try {
      const result = unsubscribe(subscriptionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
