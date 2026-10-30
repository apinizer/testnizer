/** Small helpers every variant shares (issue #280). */
import { basicLiteral } from './base64'
import type { CodegenFormPart, CodegenRequest } from './types'

/** The Basic credential of the request, with its literal header value when it has no placeholder. */
export function basicAuth(
  req: CodegenRequest,
): { username: string; password: string; literal?: string } | undefined {
  if (req.auth?.scheme !== 'basic') return undefined
  const { username, password } = req.auth
  return { username, password, literal: basicLiteral(username, password) }
}

/**
 * Headers for a variant that has no basic-auth API: the request headers plus
 * `Authorization: Basic …` when the credential can be encoded literally.
 * `runtime` is set when it cannot (a `{{placeholder}}` is in it) — the variant
 * then writes the language's run-time base64 of `userPass`.
 */
export function headersWithBasic(req: CodegenRequest): {
  headers: Array<{ key: string; value: string }>
  runtime?: { userPass: string }
} {
  const b = basicAuth(req)
  if (!b) return { headers: req.headers }
  if (b.literal) return { headers: [...req.headers, { key: 'Authorization', value: b.literal }] }
  return { headers: req.headers, runtime: { userPass: `${b.username}:${b.password}` } }
}

/** `POST` → `Post` (Ruby Net::HTTP, C# HttpMethod). */
export function titleCase(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()
}

export function isJson(req: CodegenRequest): boolean {
  return req.body?.mode === 'raw' && req.body.format === 'json'
}

export function formParts(req: CodegenRequest): CodegenFormPart[] {
  return req.body?.mode === 'form-data' ? req.body.parts : []
}

/** The value of a header the request carries (case-insensitive). */
export function headerValue(req: CodegenRequest, name: string): string | undefined {
  const lower = name.toLowerCase()
  return req.headers.find((h) => h.key.toLowerCase() === lower)?.value
}

/** Content-Type the snippet sends, or a fallback. */
export function contentType(req: CodegenRequest, fallback = 'text/plain'): string {
  return headerValue(req, 'Content-Type') ?? fallback
}

/** Headers minus Content-Type (for clients that take the media type separately). */
export function headersWithoutContentType(
  req: CodegenRequest,
): Array<{ key: string; value: string }> {
  return req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
}

/** Methods a body is customarily NOT sent with — clients that refuse a body on them get none. */
export const BODYLESS = new Set(['GET', 'HEAD'])
