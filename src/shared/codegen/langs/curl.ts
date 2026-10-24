/**
 * cURL in three shells (issue #279) as the cURL language's variants (issue
 * #280). Quoting and layout are the shared cURL engine (`src/shared/curl/`) —
 * this file only maps the normalised request onto its arguments. Every new
 * flag is opt-in, so the default bash multi-line snippet stays the #279 one.
 */
import { generateCurl, type CurlDialect, type CurlGenRequest } from '../../curl'
import {
  followRedirectOpt,
  rawContent,
  shouldFollow,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import type { CodegenOptions, CodegenRequest, CodegenVariant } from '../types'

const MULTI_LINE = {
  id: 'multiLine',
  labelKey: 'codeGen.option.multiLine',
  type: 'boolean' as const,
  default: true,
}
const LONG_FORMAT = {
  id: 'longFormat',
  labelKey: 'codeGen.option.longFormat',
  type: 'boolean' as const,
  default: false,
}
const SILENT = {
  id: 'silent',
  labelKey: 'codeGen.option.silent',
  type: 'boolean' as const,
  default: false,
}

function curlBody(req: CodegenRequest, o: CodegenOptions): CurlGenRequest['body'] {
  const b = req.body
  if (!b) return undefined
  if (b.mode === 'raw') return { kind: 'raw', content: rawContent(req, o) ?? '' }
  if (b.mode === 'urlencoded') return { kind: 'raw', content: b.encoded }
  if (b.mode === 'binary') return { kind: 'binary', path: b.path }
  return {
    kind: 'form',
    parts: b.parts.map((p) =>
      p.kind === 'file'
        ? { key: p.key, value: p.fileName, filePath: p.path }
        : { key: p.key, value: p.value },
    ),
  }
}

/** The normalised request as the shared generator's input. */
export function toCurlGenRequest(req: CodegenRequest, o: CodegenOptions): CurlGenRequest {
  const ms = timeoutMs(req, o)
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    ...(req.auth
      ? {
          user: {
            username: req.auth.username,
            password: req.auth.password,
            scheme: req.auth.scheme,
          },
        }
      : {}),
    body: curlBody(req, o),
    insecure: req.settings.insecure === true,
    followRedirects: shouldFollow(req, o),
    ...(ms > 0 ? { maxTimeSeconds: Math.ceil(ms / 1000) } : {}),
    silent: o.silent === true,
  }
}

function curlVariant(
  id: string,
  label: string,
  dialect: CurlDialect,
  monaco: string,
): CodegenVariant {
  return {
    id,
    language: 'curl',
    label,
    monaco,
    // Redirects are opt-in here (curl does not follow by default and the #279
    // snippet never wrote `-L`).
    options: [MULTI_LINE, LONG_FORMAT, followRedirectOpt(false), TIMEOUT, SILENT, TRIM_BODY],
    generate: (req, o) =>
      generateCurl(toCurlGenRequest(req, o), {
        dialect,
        multiLine: o.multiLine !== false,
        longFormat: o.longFormat === true,
      }),
  }
}

export const curlBash = curlVariant('curl', 'bash (Linux / macOS)', 'bash', 'shell')
export const curlCmd = curlVariant('curl-cmd', 'Windows CMD', 'cmd', 'bat')
export const curlPowershell = curlVariant(
  'curl-powershell',
  'PowerShell',
  'powershell',
  'powershell',
)

/** Variant id of a cURL dialect (the UI keeps the choice in `ui.store.curlSnippet`). */
export function curlVariantId(dialect: CurlDialect): string {
  return dialect === 'cmd' ? 'curl-cmd' : dialect === 'powershell' ? 'curl-powershell' : 'curl'
}

export function curlDialectOf(variantId: string): CurlDialect | undefined {
  if (variantId === 'curl') return 'bash'
  if (variantId === 'curl-cmd') return 'cmd'
  if (variantId === 'curl-powershell') return 'powershell'
  return undefined
}
