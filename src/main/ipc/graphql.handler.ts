import { ipcMain } from 'electron'
import { executeQuery, introspect, type GraphqlExecuteOptions } from '../protocols/graphql.engine'
import { logRequestResponse } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'
import type { HistoryConfigured } from '../../shared/history-snapshot'
import { authSecretValues } from '../lib/sensitive-scrub'

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
  /** Editor state (`{{var}}` kept) for the History row's `configured` (issues #182, #195). */
  _configured?: HistoryConfigured
}

interface GraphqlIntrospectPayload {
  url: string
  headers?: Record<string, string>
  sslVerification?: boolean
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

      logRequestResponse({
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
        secrets: authSecretValues(payload.auth),
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
            ...(payload._configured ? { configured: payload._configured } : {}),
          }),
          extra_secrets: authSecretValues(payload.auth),
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
}
