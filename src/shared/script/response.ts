/**
 * `pm.response` builder — the full Postman/chai-postman response surface, shared
 * by Send and Run. Given one NormalizedResponse it returns the object scripts
 * read as `pm.response` (and `insomnia.response`/`res` map onto it).
 *
 * Covers: code, status, reason(), text(), body, json(), jsonp(), dataURI(),
 * size(), responseTime, responseSize, headers, cookies, and the complete
 * `to.be.*` / `to.have.*` assertion set (with `to.not.*`), incl. jsonSchema via
 * Ajv. Pure TS.
 */
import Ajv from 'ajv'
import type { NormalizedResponse } from './types'
import { deepEqual } from './expect'
import { base64Encode } from './base64'

/** Canonical reason phrases for the common codes Postman's named assertions use. */
const REASON: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

function jsonPath(obj: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in (cur as Record<string, unknown>))) {
      return { found: false, value: undefined }
    }
    cur = (cur as Record<string, unknown>)[p]
  }
  return { found: true, value: cur }
}

export interface PmResponse {
  code: number
  status: string
  reason(): string
  responseTime: number
  responseSize: number
  text(): string
  body: string
  json(reviver?: (k: string, v: unknown) => unknown): unknown
  jsonp(): unknown
  dataURI(): string
  size(): { body: number; header: number; total: number }
  headers: {
    get(name: string): string | undefined
    has(name: string): boolean
    all(): Array<{ key: string; value: string }>
    toObject(): Record<string, string>
  }
  cookies: {
    get(name: string): string | undefined
    has(name: string): boolean
    toObject(): Record<string, string>
  }
  to: ResponseAssertions & { not: ResponseAssertions }
}

interface NumChain {
  below(n: number): void
  above(n: number): void
  within(a: number, b: number): void
}
interface ResponseAssertions {
  have: {
    status(codeOrReason: number | string): void
    statusCode(code: number): void
    statusReason(reason: string): void
    statusCodeClass(n: number): void
    header(name: string, value?: string): void
    body(content?: string | RegExp): void
    jsonBody(pathOrObj?: string | object, value?: unknown): void
    jsonSchema(schema: object, ajvOptions?: object): void
    responseTime: NumChain
    responseSize: NumChain
  }
  be: {
    info: void
    success: void
    redirection: void
    clientError: void
    serverError: void
    error: void
    ok: void
    accepted: void
    withoutContent: void
    badRequest: void
    unauthorized: void
    unauthorised: void
    forbidden: void
    notFound: void
    notAcceptable: void
    rateLimited: void
    withBody: void
    json: void
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })

export function createPmResponse(r: NormalizedResponse): PmResponse {
  const headerEntries = Object.entries(r.headers)
  const headerGet = (name: string): string | undefined => {
    const lo = name.toLowerCase()
    const hit = headerEntries.find(([k]) => k.toLowerCase() === lo)
    return hit ? hit[1] : undefined
  }
  const cookieGet = (name: string): { name: string; value: string } | undefined =>
    r.cookies.find((c) => c.name.toLowerCase() === name.toLowerCase())
  const parseJson = (): unknown => JSON.parse(r.body)

  const makeAssertions = (negate: boolean): ResponseAssertions => {
    const ok = (cond: boolean, msg: string): void => {
      if (negate ? cond : !cond) throw new Error(negate ? `expected NOT: ${msg}` : msg)
    }
    const cls = Math.floor(r.code / 100)
    const numChain = (val: number): NumChain => ({
      below: (n) => ok(val < n, `expected ${val} to be below ${n}`),
      above: (n) => ok(val > n, `expected ${val} to be above ${n}`),
      within: (a, b) => ok(val >= a && val <= b, `expected ${val} to be within ${a}..${b}`),
    })
    const named = (code: number, label: string): void =>
      ok(r.code === code, `expected response to be ${label} (${code}) but got ${r.code}`)
    return {
      have: {
        status: (codeOrReason) => {
          if (typeof codeOrReason === 'number')
            ok(r.code === codeOrReason, `expected status ${codeOrReason} but got ${r.code}`)
          else
            ok(
              r.statusText === codeOrReason || REASON[r.code] === codeOrReason,
              `expected status reason '${codeOrReason}' but got '${r.statusText}'`,
            )
        },
        statusCode: (code) => ok(r.code === code, `expected status code ${code} but got ${r.code}`),
        statusReason: (reason) =>
          ok(
            r.statusText === reason,
            `expected status reason '${reason}' but got '${r.statusText}'`,
          ),
        statusCodeClass: (n) => ok(cls === n, `expected status class ${n}xx but got ${cls}xx`),
        header: (name, value) => {
          const v = headerGet(name)
          if (value === undefined) ok(v !== undefined, `expected header '${name}' to be present`)
          else
            ok(v === value, `expected header '${name}' to equal '${value}' but got '${String(v)}'`)
        },
        body: (content) => {
          if (content === undefined) ok(r.body.length > 0, `expected response to have a body`)
          else if (content instanceof RegExp)
            ok(content.test(r.body), `expected body to match ${String(content)}`)
          else ok(r.body === content, `expected body to equal the given string`)
        },
        jsonBody: (pathOrObj, value) => {
          let parsed: unknown
          try {
            parsed = parseJson()
          } catch {
            ok(false, `expected response body to be valid JSON`)
            return
          }
          if (pathOrObj === undefined) {
            ok(true, ``)
          } else if (typeof pathOrObj === 'string') {
            const { found, value: pv } = jsonPath(parsed, pathOrObj)
            if (value === undefined) ok(found, `expected JSON body to have path '${pathOrObj}'`)
            else
              ok(
                found && deepEqual(pv, value),
                `expected JSON path '${pathOrObj}' to equal the given value`,
              )
          } else {
            ok(deepEqual(parsed, pathOrObj), `expected JSON body to deeply equal the given object`)
          }
        },
        jsonSchema: (schema, _ajvOptions) => {
          let parsed: unknown
          try {
            parsed = parseJson()
          } catch {
            ok(false, `expected response body to be valid JSON for schema validation`)
            return
          }
          const validate = ajv.compile(schema)
          const valid = validate(parsed)
          ok(!!valid, `expected body to match JSON schema: ${ajv.errorsText(validate.errors)}`)
        },
        get responseTime() {
          return numChain(r.responseTime)
        },
        get responseSize() {
          return numChain(r.responseSize)
        },
      },
      be: {
        get info(): void {
          return ok(cls === 1, `expected 1xx but got ${r.code}`)
        },
        get success(): void {
          return ok(cls === 2, `expected 2xx but got ${r.code}`)
        },
        get redirection(): void {
          return ok(cls === 3, `expected 3xx but got ${r.code}`)
        },
        get clientError(): void {
          return ok(cls === 4, `expected 4xx but got ${r.code}`)
        },
        get serverError(): void {
          return ok(cls === 5, `expected 5xx but got ${r.code}`)
        },
        get error(): void {
          return ok(cls === 4 || cls === 5, `expected 4xx or 5xx but got ${r.code}`)
        },
        get ok(): void {
          return named(200, 'ok')
        },
        get accepted(): void {
          return named(202, 'accepted')
        },
        get withoutContent(): void {
          return named(204, 'without content')
        },
        get badRequest(): void {
          return named(400, 'bad request')
        },
        get unauthorized(): void {
          return named(401, 'unauthorized')
        },
        get unauthorised(): void {
          return named(401, 'unauthorised')
        },
        get forbidden(): void {
          return named(403, 'forbidden')
        },
        get notFound(): void {
          return named(404, 'not found')
        },
        get notAcceptable(): void {
          return named(406, 'not acceptable')
        },
        get rateLimited(): void {
          return named(429, 'rate limited')
        },
        get withBody(): void {
          return ok(r.body.length > 0, `expected response to have a body`)
        },
        get json(): void {
          let valid = true
          try {
            parseJson()
          } catch {
            valid = false
          }
          return ok(valid, `expected response body to be JSON`)
        },
      },
    }
  }

  return {
    code: r.code,
    status: r.statusText,
    reason: () => r.statusText || REASON[r.code] || '',
    responseTime: r.responseTime,
    responseSize: r.responseSize,
    text: () => r.body,
    body: r.body,
    json: (reviver?: (k: string, v: unknown) => unknown) => JSON.parse(r.body, reviver),
    jsonp: () => {
      const m = r.body.match(/^[^(]*\((.*)\)[^)]*$/s)
      return JSON.parse(m ? m[1] : r.body)
    },
    dataURI: () => {
      const ct = headerGet('content-type') ?? 'application/octet-stream'
      return `data:${ct};base64,${base64Encode(r.body)}`
    },
    size: () => {
      const header = headerEntries.reduce((n, [k, v]) => n + k.length + v.length + 4, 0)
      return { body: r.responseSize, header, total: r.responseSize + header }
    },
    headers: {
      get: headerGet,
      has: (name) => headerGet(name) !== undefined,
      all: () => headerEntries.map(([key, value]) => ({ key, value })),
      toObject: () => ({ ...r.headers }),
    },
    cookies: {
      get: (name) => cookieGet(name)?.value,
      has: (name) => !!cookieGet(name),
      toObject: () => Object.fromEntries(r.cookies.map((c) => [c.name, c.value])),
    },
    to: { ...makeAssertions(false), not: makeAssertions(true) },
  }
}
