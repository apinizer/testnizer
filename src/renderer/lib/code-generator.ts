/**
 * Generate Code — renderer facade over `src/shared/codegen/` (issue #280).
 *
 * What stays here is renderer-only: `{{var}}` resolution through the active
 * variables (secret variables stay `{{name}}` unless "Include secret values"),
 * path variables applied BEFORE it (the order Send and Run use). Normalising
 * the request and rendering each language variant is the shared module's job.
 *
 * `generateCode(legacyId, …)` and `CODE_LANGUAGES` keep the 11 pre-#280 ids
 * working; the UI calls `generateSnippet(variantId, …)`.
 */
import type { HttpMethod, KeyValuePair, RequestBody, AuthConfig, CodeLanguage } from '../types'
import { resolveAuth, resolveVariables } from './variable-resolver'
import { snippetVariables } from './secret-variables'
import type { CurlDialect } from '../../shared/curl'
import { applyPathVariables, type PathVariableLike } from '../../shared/path-variables'
import {
  curlVariantId,
  findVariant,
  normalizeRequest,
  renderSnippet,
  type CodegenInputBody,
  type CodegenOptions,
} from '../../shared/codegen'

/** A GraphQL tab's body: Send posts `{query, variables}` as JSON. */
export interface GraphqlCodeBody {
  type: 'graphql'
  graphql: { query: string; variables: string }
}

export interface CodeGenRequest {
  method: HttpMethod | string
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body?: RequestBody | GraphqlCodeBody
  /**
   * The EFFECTIVE auth — an `inherit` request passes what its folder / project
   * resolves to (`useGeneratedCode` → `resolveInheritance`), like Send.
   */
  auth?: AuthConfig
  /** `:name` path variable values (issue #276) — substituted like Send does. */
  pathVariables?: readonly PathVariableLike[]
  /** Per-request settings the snippet reflects (SSL off, explicit timeout, redirects off). */
  settings?: { sslVerification?: boolean; timeout?: number | null; followRedirects?: boolean }
}

/** The cURL variant (issue #279): shell + one line or one option per line. */
export interface CurlSnippetOptions {
  dialect?: CurlDialect
  multiLine?: boolean
}

export interface CodeGenOptions {
  /** Only read by the legacy `curl` id. Default: bash, multi-line. */
  curl?: CurlSnippetOptions
  /** Per-variant snippet options (indent, timeout, redirects…) — issue #280. */
  variantOptions?: CodegenOptions
  /**
   * Optional variable scope used to substitute `{{var}}` placeholders before
   * the request is rendered into a code snippet. Without this, suite items
   * and saved requests emit literal `{{var}}` text in the generated cURL —
   * the v1.3.1 §5.10 bug.
   */
  envVars?: Record<string, string>
  /**
   * Names of `secret` variables (`activeSecretVariableNames`). They are NOT
   * substituted — the snippet keeps `{{name}}` — unless `includeSecrets`.
   */
  secretNames?: ReadonlySet<string>
  /** The user's "Include secret values" opt-in (session-only, off by default). */
  includeSecrets?: boolean
}

function resolveKvList(list: KeyValuePair[], vars: Record<string, string>): KeyValuePair[] {
  return list.map((p) => ({
    ...p,
    key: resolveVariables(p.key, vars),
    value: resolveVariables(p.value, vars),
  }))
}

function resolveBody(
  body: CodeGenRequest['body'],
  vars: Record<string, string>,
): CodeGenRequest['body'] {
  if (!body) return body
  if (body.type === 'graphql') {
    const g = (body as GraphqlCodeBody).graphql
    // Resolved BEFORE the JSON is built (Send's order), so a value with a
    // quote cannot break the JSON body.
    return {
      type: 'graphql',
      graphql: {
        query: resolveVariables(g.query, vars),
        variables: resolveVariables(g.variables, vars),
      },
    }
  }
  const b = body as RequestBody
  return {
    ...b,
    // binaryPath too, for parity with `resolveRequestBody()` in
    // variable-resolver.ts so `{{fixturesDir}}/foo.bin` works in both
    // the code panel and the live request engine.
    content: b.content ? resolveVariables(b.content, vars) : b.content,
    formData: b.formData ? resolveKvList(b.formData, vars) : b.formData,
    urlEncoded: b.urlEncoded ? resolveKvList(b.urlEncoded, vars) : b.urlEncoded,
    binaryPath: b.binaryPath ? resolveVariables(b.binaryPath, vars) : b.binaryPath,
  }
}

function resolveRequest(req: CodeGenRequest, vars: Record<string, string>): CodeGenRequest {
  return {
    ...req,
    url: resolveVariables(req.url, vars),
    params: resolveKvList(req.params, vars),
    headers: resolveKvList(req.headers, vars),
    body: resolveBody(req.body, vars),
    // The Authorization tab too — the same resolver Send uses. Without it a
    // `{{token}}` typed there stayed literal even with "Include secret values".
    auth: resolveAuth(req.auth, vars),
  }
}

/** Path variables, then `{{var}}` (secrets kept), then the shared normaliser. */
function prepare(req: CodeGenRequest, options?: CodeGenOptions) {
  const vars = options?.envVars
    ? snippetVariables(
        options.envVars,
        options.secretNames ?? new Set<string>(),
        options.includeSecrets === true,
      )
    : undefined
  const withPath = req.pathVariables?.length
    ? { ...req, url: applyPathVariables(req.url, req.pathVariables), pathVariables: undefined }
    : req
  const effective = vars ? resolveRequest(withPath, vars) : withPath
  return normalizeRequest({
    method: effective.method,
    url: effective.url,
    params: effective.params,
    headers: effective.headers,
    body: effective.body as CodegenInputBody | undefined,
    auth: effective.auth,
    settings: effective.settings,
  })
}

/** Render the active request with a variant of the issue #280 catalogue. */
export function generateSnippet(
  variantId: string,
  req: CodeGenRequest,
  options?: CodeGenOptions,
): string {
  if (!findVariant(variantId)) return `// Code generation for ${variantId} is not supported yet.`
  return renderSnippet(variantId, prepare(req, options), options?.variantOptions)
}

/**
 * The pre-#280 entry point: one of the 11 legacy ids. `curl` picks its shell
 * from `options.curl` (issue #279).
 */
export function generateCode(
  language: CodeLanguage,
  req: CodeGenRequest,
  options?: CodeGenOptions,
): string {
  if (!LEGACY_IDS.has(language)) return `// Code generation for ${language} is not supported yet.`
  if (language === 'curl') {
    const variantOptions: CodegenOptions = { ...options?.variantOptions }
    if (options?.curl?.multiLine !== undefined) variantOptions.multiLine = options.curl.multiLine
    return generateSnippet(curlVariantId(options?.curl?.dialect ?? 'bash'), req, {
      ...options,
      variantOptions,
    })
  }
  return generateSnippet(language, req, options)
}

/** Monaco language of a cURL snippet in a shell (issue #279). */
export function curlMonacoLanguage(dialect: CurlDialect): string {
  if (dialect === 'cmd') return 'bat'
  if (dialect === 'powershell') return 'powershell'
  return 'shell'
}

/** The 11 pre-#280 entries (kept for callers that still list them). */
export const CODE_LANGUAGES: { id: CodeLanguage; label: string; monacoLang: string }[] = [
  { id: 'curl', label: 'cURL', monacoLang: 'shell' },
  { id: 'js-fetch', label: 'JavaScript (fetch)', monacoLang: 'javascript' },
  { id: 'js-axios', label: 'JavaScript (axios)', monacoLang: 'javascript' },
  { id: 'python-requests', label: 'Python', monacoLang: 'python' },
  { id: 'java-okhttp', label: 'Java', monacoLang: 'java' },
  { id: 'go', label: 'Go', monacoLang: 'go' },
  { id: 'php', label: 'PHP', monacoLang: 'php' },
  { id: 'ruby', label: 'Ruby', monacoLang: 'ruby' },
  { id: 'swift', label: 'Swift', monacoLang: 'swift' },
  { id: 'kotlin', label: 'Kotlin', monacoLang: 'kotlin' },
  { id: 'csharp', label: 'C#', monacoLang: 'csharp' },
]

const LEGACY_IDS = new Set<string>(CODE_LANGUAGES.map((l) => l.id))
