/**
 * Postman collection v2.0 / v2.1 shapes as the importer and exporter read
 * them (research 01-formats §5). Every field is optional and loosely typed on
 * purpose: real files diverge from the schema (object descriptions, string
 * headers, string requests, numeric variable values) and the importer
 * normalises them (`normalize.ts`) instead of trusting the declared types.
 */
import type { XApinizerExtension } from './x-apinizer'

/** `description` is a string or `{content, type, version}`. */
export type PostmanDescription = string | { content?: string; type?: string; version?: unknown }

export interface PostmanCollection {
  info: {
    name: string
    description?: PostmanDescription
    schema: string
    _postman_id?: string
    version?: unknown
  }
  item: PostmanItem[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth | null
  /** Collection-level pre-request / test scripts (Testnizer: project scripts). */
  event?: PostmanEvent[]
  protocolProfileBehavior?: Record<string, unknown>
}

export interface PostmanItem {
  id?: string
  name: string
  /** A request object, or a bare URL string (= GET). */
  request?: PostmanRequest | string
  response?: PostmanResponse[]
  item?: PostmanItem[] // folder (item group)
  description?: PostmanDescription
  event?: PostmanEvent[]
  variable?: PostmanVariable[]
  /** Folder-level auth — inherited by descendant requests that don't set
   *  their own (Postman item-groups can carry an `auth` block). */
  auth?: PostmanAuth | null
  protocolProfileBehavior?: Record<string, unknown>
  /** Apinizer test-interop extension. Postman v2.1 preserves unknown custom
   *  keys, so Apinizer's extra fidelity (structured assertions, raw-body
   *  sub-type, timeout) rides here and round-trips through Testnizer. */
  'x-apinizer'?: XApinizerExtension
}

export interface PostmanEvent {
  listen: 'prerequest' | 'test' | string
  script?: {
    exec?: string | string[]
    type?: string
    src?: unknown
    packages?: Record<string, unknown>
    requests?: Record<string, unknown>
  }
  disabled?: boolean
}

export interface PostmanRequest {
  method?: string
  /** A list, or a `"K: V\n"` string (v1 heritage, some exporters). */
  header?: PostmanHeader[] | string
  url?: PostmanUrl | string
  body?: PostmanBody | null
  auth?: PostmanAuth | null
  description?: PostmanDescription
  proxy?: unknown
  certificate?: unknown
}

export interface PostmanHeader {
  key: string
  value: string
  description?: PostmanDescription
  disabled?: boolean
}

export interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  port?: string
  path?: Array<string | { value: string }> | string
  query?: PostmanQuery[]
  hash?: string
  variable?: Array<{
    key: string
    value?: unknown
    description?: PostmanDescription
    disabled?: boolean
  }>
}

export interface PostmanQuery {
  key: string
  value: string | null
  description?: PostmanDescription
  disabled?: boolean
}

export interface PostmanBody {
  mode?: string
  raw?: string
  formdata?: PostmanFormData[]
  urlencoded?: PostmanUrlEncoded[]
  file?: { src?: string; content?: string }
  graphql?: { query?: string; variables?: string; operationName?: string }
  options?: {
    raw?: { language?: string }
  }
  disabled?: boolean
}

export interface PostmanFormData {
  key: string
  value?: string
  src?: string | string[]
  description?: PostmanDescription
  disabled?: boolean
  type?: string
  contentType?: string
}

export interface PostmanUrlEncoded {
  key: string
  value: string
  description?: PostmanDescription
  disabled?: boolean
}

/** One auth attribute in the v2.1 array form. */
export interface PostmanAuthAttribute {
  key: string
  value: unknown
  type?: string
}

/**
 * v2.1 stores each type's attributes as an ARRAY of `{key, value}`; v2.0 (and
 * the v1 converter's output) as a flat OBJECT. Both are accepted on import.
 */
export type PostmanAuthAttributes = PostmanAuthAttribute[] | Record<string, unknown>

export interface PostmanAuth {
  type: string
  [type: string]: PostmanAuthAttributes | string | undefined
}

export interface PostmanVariable {
  id?: string
  key: string
  value?: unknown
  type?: string
  description?: PostmanDescription
  disabled?: boolean
  /** SDK 5.3.0 / transformer 4.1.13: a secret variable (often with a vault `source`). */
  secret?: boolean
  source?: unknown
}

/** A saved example (`item.response[]`). */
export interface PostmanResponse {
  id?: string
  name?: string
  originalRequest?: PostmanRequest | string
  status?: string
  code?: number | string
  header?: Array<{ key: string; value: string }> | string | null
  cookie?: unknown[]
  body?: string | null
  responseTime?: number | string | null
  _postman_previewlanguage?: string | null
  _postman_previewtype?: string | null
}

/**
 * Standalone Postman environment / globals export (Postman → Environments →
 * Export, Globals → Export). `values[]` entries add an optional `enabled`.
 */
export interface PostmanEnvironment {
  id?: string
  name: string
  values?: Array<{
    key: string
    value: unknown
    type?: string
    /** Postman omits this field on enabled rows; `false` means the variable is muted. */
    enabled?: boolean
    description?: PostmanDescription
    secret?: boolean
  }>
  _postman_variable_scope?: string
  _postman_exported_at?: string
  _postman_exported_using?: string
}
