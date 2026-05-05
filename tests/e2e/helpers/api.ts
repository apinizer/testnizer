import type { Page } from '@playwright/test'

/**
 * E2E helper: invoke `request:send` IPC from inside the renderer.
 * Returns the response payload from the main-process http engine.
 *
 * The shape of `RequestOptions` mirrors `HttpRequestOptions` from
 * `src/main/protocols/http.engine.ts` — keys are passed through unchanged.
 *
 * Buffer/Uint8Array values are not JSON-serializable across the
 * Playwright/Electron bridge, so cert payloads must be passed as objects
 * with `__buffer` markers (see `bufferFromBase64` below).
 */
export interface RequestOptions {
  method: string
  url: string
  params?: KV[]
  headers?: KV[]
  body?: {
    type: string
    content?: string
    formData?: KV[]
    urlEncoded?: KV[]
    binaryPath?: string
  }
  auth?: {
    type: string
    basic?: { username: string; password: string }
    bearer?: { token: string; prefix?: string }
    apiKey?: { key: string; value: string; in: 'header' | 'query' }
    digest?: { username: string; password: string }
  }
  timeout?: number
  followRedirects?: boolean
  sslVerification?: boolean
  certificates?: {
    /** PEM strings — converted to Buffer in the helper before IPC */
    caCertsPem?: string[]
    clientCert?: {
      certPem?: string
      keyPem?: string
      /** base64-encoded PKCS12 */
      pfxBase64?: string
      passphrase?: string
    }
  }
}

interface KV {
  id?: string
  key: string
  value: string
  enabled?: boolean
  description?: string
}

export interface ApiResponse {
  requestId: string
  protocol: 'http'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing?: { total?: number; dns?: number; tcp?: number; ttfb?: number; download?: number }
  cookies?: unknown[]
  actualRequest?: { method: string; url: string; headers: Record<string, string>; body?: string }
  error?: string
  // ...other fields populated by http.engine
  [key: string]: unknown
}

/** Wrapper returned by the IPC channel: `{success, data?, error?}`. */
interface IpcEnvelope {
  success: boolean
  data?: ApiResponse
  error?: string
}

export async function sendRequest(window: Page, opts: RequestOptions): Promise<ApiResponse> {
  // Pass options + cert PEMs as serializable values; helper inside the
  // renderer materializes Buffers from base64 strings.
  const serializable = JSON.parse(JSON.stringify(opts))
  const raw = await window.evaluate(async (o) => {
    interface BufLike { __buffer: string }
    function toBuffer(b64: string): BufLike {
      // We're inside the renderer — main side will reconstruct.
      return { __buffer: b64 }
    }
    type WindowAny = Window & {
      api?: {
        request?: { send: (o: unknown) => Promise<unknown> }
      }
    }
    const w = window as unknown as WindowAny
    if (!w.api?.request?.send) {
      throw new Error('window.api.request.send not available')
    }

    // Materialize cert payloads. The main process expects Buffer instances;
    // since IPC structured-clones across the bridge, plain Uint8Arrays survive.
    const certs = (o as RequestOptions).certificates
    if (certs) {
      const out: {
        caCerts?: Uint8Array[]
        clientCert?: { cert?: Uint8Array; key?: Uint8Array; pfx?: Uint8Array; passphrase?: string }
      } = {}
      if (certs.caCertsPem) {
        out.caCerts = certs.caCertsPem.map((pem) => new TextEncoder().encode(pem))
      }
      if (certs.clientCert) {
        out.clientCert = { passphrase: certs.clientCert.passphrase }
        if (certs.clientCert.certPem) {
          out.clientCert.cert = new TextEncoder().encode(certs.clientCert.certPem)
        }
        if (certs.clientCert.keyPem) {
          out.clientCert.key = new TextEncoder().encode(certs.clientCert.keyPem)
        }
        if (certs.clientCert.pfxBase64) {
          const bin = atob(certs.clientCert.pfxBase64)
          const arr = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
          out.clientCert.pfx = arr
        }
      }
      ;(o as RequestOptions & { certificates?: unknown }).certificates = out
      void toBuffer
    }

    return await w.api.request.send(o)
  }, serializable)

  const env = raw as IpcEnvelope
  if (env && typeof env === 'object' && 'success' in env) {
    if (env.success && env.data) return env.data
    return {
      requestId: '',
      protocol: 'http',
      error: env.error ?? 'IPC reported failure',
    } as ApiResponse
  }
  return raw as ApiResponse
}

/** Small helper: build a key/value pair list from a plain object. */
export function kvList(obj: Record<string, string>): KV[] {
  return Object.entries(obj).map(([key, value], i) => ({
    id: `kv-${i}`,
    key,
    value,
    enabled: true,
  }))
}

/** Read response body as JSON, returns parsed object or throws. */
export function parseJsonBody(res: ApiResponse): unknown {
  if (!res.body) throw new Error('No body in response')
  return JSON.parse(res.body)
}
