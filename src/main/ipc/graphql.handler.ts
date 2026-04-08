import { ipcMain, BrowserWindow } from 'electron'
import {
  executeQuery,
  introspect,
  subscribe,
  unsubscribe,
  type GraphqlExecuteOptions,
  type GraphqlSubscribeOptions
} from '../protocols/graphql.engine'

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
        sslVerification: payload.sslVerification
      }

      const response = await executeQuery(options)
      return { success: true, data: response }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Introspect schema ──────────────────────────────────────
  ipcMain.handle('graphql:introspect', async (_event, payload: GraphqlIntrospectPayload) => {
    try {
      const result = await introspect(
        payload.url,
        payload.headers,
        payload.sslVerification
      )
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
        sslVerification: payload.sslVerification
      }

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
