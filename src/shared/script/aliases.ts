/**
 * `insomnia` and `bru`/`req`/`res` alias layers, shared by Send and Run.
 *
 * Insomnia is mostly a drop-in for `pm`, with TWO documented semantic traps
 * (verified against Kong/Insomnia docs):
 *   1. `insomnia.baseEnvironment` (and `insomnia.collectionVariables`) map to
 *      Postman COLLECTION variables — NOT globals (globals are unsupported).
 *   2. `insomnia.response.status` is the NUMERIC code (inverted vs Postman,
 *      where `.status` is the reason text and `.code` is the number).
 *
 * Bruno's `bru`/`req`/`res` are NOT a pm alias — they're getter-method based,
 * mapped function-by-function.
 */
import type { ScriptHostContext, PmLike } from './pm-types'

/** Build the `insomnia` object from a fully-assembled pm. */
export function buildInsomnia(ctx: ScriptHostContext): object {
  const { pm, normalizedResponse: r } = ctx
  // Inherit every pm member, then override the two Insomnia-specific ones.
  const insomnia = Object.create(pm) as PmLike & {
    baseEnvironment: unknown
    response: unknown
  }
  // Guard on `r` (the normalized response), NOT pm.response — in pre-request
  // scope pm.response is a getter that throws, so only touch it when r exists.
  const insomniaResponse = r ? { ...(pm.response as object), status: r.code } : null
  Object.defineProperties(insomnia, {
    baseEnvironment: { value: pm.collectionVariables, enumerable: true },
    collectionVariables: { value: pm.collectionVariables, enumerable: true },
    response: { value: insomniaResponse, enumerable: true },
  })
  return insomnia
}

/** Build Bruno's `{ bru, req, res }` from a fully-assembled pm. */
export function buildBruno(ctx: ScriptHostContext): {
  bru: object
  req: object
  res: object | null
} {
  const { pm, normalizedResponse: r } = ctx

  const bru = {
    // environment vars
    getEnvVar: (k: string) => pm.environment.get(k),
    setEnvVar: (k: string, v: unknown) => pm.environment.set(k, v),
    hasEnvVar: (k: string) => pm.environment.has(k),
    deleteEnvVar: (k: string) => pm.environment.unset(k),
    getEnvName: () => pm.environment.name,
    // runtime vars
    getVar: (k: string) => pm.variables.get(k),
    setVar: (k: string, v: unknown) => pm.variables.set(k, v),
    hasVar: (k: string) => pm.variables.has(k),
    deleteVar: (k: string) => pm.variables.unset(k),
    // scoped vars
    getCollectionVar: (k: string) => pm.collectionVariables.get(k),
    setCollectionVar: (k: string, v: unknown) => pm.collectionVariables.set(k, v),
    getGlobalEnvVar: (k: string) => pm.globals.get(k),
    setGlobalEnvVar: (k: string, v: unknown) => pm.globals.set(k, v),
    // flow + utils
    setNextRequest: (name: string | null) => pm.execution.setNextRequest(name),
    sendRequest: (input: unknown, cb?: (err: Error | null, res: unknown) => void) =>
      pm.sendRequest(input, cb),
    interpolate: (s: string) => pm.variables.replaceIn(s),
  }

  const req = {
    getUrl: () =>
      typeof pm.request.url === 'string' ? pm.request.url : String(pm.request.url ?? ''),
    getMethod: () => pm.request.method,
    getHeaders: () => pm.request.headers,
    getHeader: (name: string) => {
      const h = pm.request.headers as Record<string, unknown> | undefined
      if (h && typeof h === 'object' && !Array.isArray(h)) {
        const lo = name.toLowerCase()
        const hit = Object.entries(h).find(([k]) => k.toLowerCase() === lo)
        return hit ? hit[1] : undefined
      }
      return undefined
    },
    getName: () => pm.request.name,
  }

  const res = r
    ? {
        status: r.code,
        statusText: r.statusText,
        responseTime: r.responseTime,
        headers: { ...r.headers },
        get body(): unknown {
          try {
            return JSON.parse(r.body)
          } catch {
            return r.body
          }
        },
        getStatus: () => r.code,
        getStatusText: () => r.statusText,
        getResponseTime: () => r.responseTime,
        getHeader: (name: string) => pm.response?.headers.get(name),
        getHeaders: () => ({ ...r.headers }),
        getBody: () => {
          try {
            return JSON.parse(r.body)
          } catch {
            return r.body
          }
        },
        getSize: () => pm.response?.size(),
      }
    : null

  return { bru, req, res }
}
