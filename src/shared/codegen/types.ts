/**
 * Code generation model (issue #280) — the neutral shapes the normaliser, the
 * registry and every language variant exchange.
 *
 * Pure TS: no node / electron / DOM imports, compiled into both bundles. The
 * INPUT shapes are structural subsets of the renderer types (`RequestBody`,
 * `AuthConfig`, `KeyValuePair`) the same way `src/shared/curl/types.ts` and
 * `http-auto-headers.ts` mirror them, so `src/shared` never imports from
 * `src/renderer`.
 */
import type { PathVariableLike } from '../path-variables'

// ─── Input (what the request editor holds) ─────────────────────────────────

export interface CodegenKv {
  key: string
  value: string
  enabled?: boolean
  /** Form-data part kind; `file` reads `filePath`. */
  type?: 'text' | 'file'
  filePath?: string
}

export interface CodegenInputBody {
  /** json / xml / text / html / javascript / urlencoded / form-data / binary / graphql / none */
  type: string
  content?: string
  formData?: CodegenKv[]
  urlEncoded?: CodegenKv[]
  binaryPath?: string
  /** `type: 'graphql'` — the GraphQL tab's query + variables JSON text. */
  graphql?: { query: string; variables: string }
}

/** Effective auth (inheritance already resolved by the caller). */
export interface CodegenInputAuth {
  type: string
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' | string }
  oauth2?: { token?: string }
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string }
}

export interface CodegenInput {
  method: string
  url: string
  params?: CodegenKv[]
  headers?: CodegenKv[]
  body?: CodegenInputBody
  auth?: CodegenInputAuth
  /** `:name` path variables — applied before anything else (`src/shared/path-variables.ts`). */
  pathVariables?: readonly PathVariableLike[]
  settings?: {
    sslVerification?: boolean
    /** ms; `null` / absent = inherit (nothing emitted), `0` = no limit. */
    timeout?: number | null
    followRedirects?: boolean
  }
}

// ─── Normalised model (what a variant renders) ────────────────────────────

export interface CodegenHeader {
  key: string
  value: string
}

export type CodegenFormPart =
  | { kind: 'text'; key: string; value: string }
  | { kind: 'file'; key: string; path: string; fileName: string }

export type CodegenRawFormat = 'json' | 'xml' | 'text' | 'html' | 'javascript'

export type CodegenBody =
  | { mode: 'raw'; format: CodegenRawFormat; content: string }
  | { mode: 'urlencoded'; fields: CodegenHeader[]; encoded: string }
  | { mode: 'form-data'; parts: CodegenFormPart[] }
  | { mode: 'binary'; path: string }

export interface CodegenRequest {
  /** Upper-case method. */
  method: string
  /** Full URL: path variables applied, query merged before `#fragment`, unsafe characters encoded. */
  url: string
  /**
   * Headers in send order: the user's rows, the auth header (bearer / API key
   * / OAuth2 token) unless the user typed the same header, then the
   * Content-Type the body implies unless the user set one. Basic / Digest /
   * NTLM credentials are NOT here — see `auth`. A form-data body never carries
   * a Content-Type (the client library writes the boundary).
   */
  headers: CodegenHeader[]
  /** Credentials a variant renders through its language's auth API (or a header). */
  auth?: { scheme: 'basic' | 'digest' | 'ntlm'; username: string; password: string }
  body?: CodegenBody
  settings: {
    /** ms, only when the request says so (`> 0`). */
    timeoutMs?: number
    /** `false` only when the request turned redirects off. */
    followRedirects?: boolean
    /** SSL verification turned off. */
    insecure?: boolean
  }
}

// ─── Options + registry ────────────────────────────────────────────────────

export type CodegenOptionValue = string | number | boolean

export interface CodegenOptionDef {
  id: string
  /** i18n key of the label (`codeGen.option.<id>`). */
  labelKey: string
  type: 'boolean' | 'number' | 'enum'
  default: CodegenOptionValue
  /** `enum` choices: value + i18n key. */
  choices?: Array<{ value: string; labelKey: string }>
  min?: number
}

export type CodegenOptions = Record<string, CodegenOptionValue>

export interface CodegenVariant {
  /** Globally unique id (the 11 pre-#280 ids are kept as variant ids). */
  id: string
  /** Language id this variant belongs to. */
  language: string
  /** Product / library name shown in the Variant selector — never translated. */
  label: string
  /** Monaco language id of the output. */
  monaco: string
  options: CodegenOptionDef[]
  generate: (req: CodegenRequest, options: CodegenOptions) => string
}

export interface CodegenLanguage {
  id: string
  /** Product name — never translated. */
  label: string
  variants: CodegenVariant[]
}
