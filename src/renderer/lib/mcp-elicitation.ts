/**
 * 2026-07-28 multi-round-trip (MRTR) input requests → a form, and the form
 * back into `respondInput`'s `inputResponses` (issue #152). Pure — no React.
 *
 * Shapes (SDK 2.x, `@modelcontextprotocol/core` `auth-*.d.cts`):
 *   - an `inputRequests[key]` is a de-JSON-RPC'd request,
 *     `{ method: 'elicitation/create', params: { mode?: 'form', message, requestedSchema } }`;
 *   - `requestedSchema.properties[name]` is a restricted primitive schema:
 *     boolean · string (`format`, `minLength` / `maxLength`, `enum`, or titled
 *     `oneOf: [{ const, title }]`) · number / integer (`minimum` / `maximum`);
 *     multi-select (`type: 'array'`) is not offered here;
 *   - each `inputResponses[key]` is the BARE `ElicitResult`
 *     (`{ action: 'accept', content } | { action: 'decline' } | { action: 'cancel' }`),
 *     `content` values typed per field — a number field must travel as a
 *     number (servers validate with their schema).
 * `sampling/createMessage` and `roots/list` requests are deprecated in
 * 2026-07-28 and Testnizer cannot answer them: they are shown as unsupported
 * and only declined / cancelled.
 */
import type { McpElicitAnswer } from '../types/mcp'

export type ElicitFieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'unsupported'

export interface ElicitField {
  name: string
  title?: string
  description?: string
  kind: ElicitFieldKind
  required: boolean
  /** `enum` fields: value + label. */
  options?: Array<{ value: string; label: string }>
  default?: string | number | boolean
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}

export type InputRequestView =
  | { key: string; kind: 'form'; message: string; fields: ElicitField[] }
  | { key: string; kind: 'unsupported'; method: string; message?: string; deprecated: boolean }

/** Form values as held by the inputs: text for text / number fields, booleans for checkboxes. */
export type ElicitValues = Record<string, string | boolean>

const DEPRECATED_METHODS = new Set(['sampling/createMessage', 'roots/list'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

function enumOptions(prop: Record<string, unknown>): ElicitField['options'] | undefined {
  if (Array.isArray(prop.enum)) {
    const names = Array.isArray(prop.enumNames) ? prop.enumNames : []
    return prop.enum
      .filter((v): v is string => typeof v === 'string')
      .map((value, i) => ({ value, label: str(names[i]) ?? value }))
  }
  if (Array.isArray(prop.oneOf)) {
    return prop.oneOf
      .filter(isRecord)
      .filter((o) => typeof o.const === 'string')
      .map((o) => ({ value: o.const as string, label: str(o.title) ?? (o.const as string) }))
  }
  return undefined
}

function toField(name: string, raw: unknown, required: boolean): ElicitField {
  const prop = isRecord(raw) ? raw : {}
  const base: ElicitField = {
    name,
    required,
    kind: 'unsupported',
    ...(str(prop.title) ? { title: str(prop.title) } : {}),
    ...(str(prop.description) ? { description: str(prop.description) } : {}),
  }
  const options = prop.type === 'string' ? enumOptions(prop) : undefined
  if (options) {
    return {
      ...base,
      kind: 'enum',
      options,
      ...(str(prop.default) ? { default: str(prop.default) } : {}),
    }
  }
  switch (prop.type) {
    case 'string':
      return {
        ...base,
        kind: 'string',
        ...(str(prop.format) ? { format: str(prop.format) } : {}),
        ...(num(prop.minLength) !== undefined ? { minLength: num(prop.minLength) } : {}),
        ...(num(prop.maxLength) !== undefined ? { maxLength: num(prop.maxLength) } : {}),
        ...(str(prop.default) !== undefined ? { default: str(prop.default) } : {}),
      }
    case 'number':
    case 'integer':
      return {
        ...base,
        kind: prop.type,
        ...(num(prop.minimum) !== undefined ? { minimum: num(prop.minimum) } : {}),
        ...(num(prop.maximum) !== undefined ? { maximum: num(prop.maximum) } : {}),
        ...(num(prop.default) !== undefined ? { default: num(prop.default) } : {}),
      }
    case 'boolean':
      return {
        ...base,
        kind: 'boolean',
        ...(typeof prop.default === 'boolean' ? { default: prop.default } : {}),
      }
    default:
      return base
  }
}

/** One `inputRequests` entry → what the card renders. */
export function parseInputRequest(key: string, request: unknown): InputRequestView {
  const r = isRecord(request) ? request : {}
  const method = str(r.method) ?? '?'
  const params = isRecord(r.params) ? r.params : {}
  const message = str(params.message)
  const mode = str(params.mode) ?? 'form'
  if (method !== 'elicitation/create' || mode !== 'form') {
    return {
      key,
      kind: 'unsupported',
      method: method === 'elicitation/create' ? `elicitation/create (${mode})` : method,
      ...(message !== undefined ? { message } : {}),
      deprecated: DEPRECATED_METHODS.has(method),
    }
  }
  const schema = isRecord(params.requestedSchema) ? params.requestedSchema : {}
  const props = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((n): n is string => typeof n === 'string')
      : [],
  )
  return {
    key,
    kind: 'form',
    message: message ?? '',
    fields: Object.entries(props).map(([name, prop]) => toField(name, prop, required.has(name))),
  }
}

export function parseInputRequests(inputRequests: Record<string, unknown>): InputRequestView[] {
  return Object.entries(inputRequests).map(([key, req]) => parseInputRequest(key, req))
}

/** Input state for a fresh form: schema defaults, else empty / unchecked. */
export function initialValues(fields: readonly ElicitField[]): ElicitValues {
  const out: ElicitValues = {}
  for (const f of fields) {
    if (f.kind === 'boolean') out[f.name] = typeof f.default === 'boolean' ? f.default : false
    else if (f.kind === 'enum')
      out[f.name] = String(f.default ?? (f.required ? (f.options?.[0]?.value ?? '') : ''))
    else out[f.name] = f.default !== undefined ? String(f.default) : ''
  }
  return out
}

export type ContentResult =
  | { content: Record<string, string | number | boolean>; problem?: undefined }
  | { content?: undefined; problem: { field: string; reason: 'required' | 'number' | 'integer' } }

/**
 * Form values → typed `content`: numbers as numbers, integers checked,
 * booleans as booleans; an empty optional field is omitted. The first
 * problem stops the build (the card shows it next to Submit).
 */
export function buildContent(fields: readonly ElicitField[], values: ElicitValues): ContentResult {
  const content: Record<string, string | number | boolean> = {}
  for (const f of fields) {
    if (f.kind === 'unsupported') continue
    const raw = values[f.name]
    if (f.kind === 'boolean') {
      content[f.name] = raw === true
      continue
    }
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') {
      if (f.required) return { problem: { field: f.name, reason: 'required' } }
      continue
    }
    if (f.kind === 'number' || f.kind === 'integer') {
      const n = Number(text)
      if (!Number.isFinite(n)) return { problem: { field: f.name, reason: 'number' } }
      if (f.kind === 'integer' && !Number.isInteger(n)) {
        return { problem: { field: f.name, reason: 'integer' } }
      }
      content[f.name] = n
      continue
    }
    content[f.name] = typeof raw === 'string' ? raw : ''
  }
  return { content }
}

/**
 * `inputResponses` for the whole round. `accept`: every form request gets its
 * typed content, unsupported requests are declined. `decline` / `cancel`
 * apply to every request.
 */
export function buildInputResponses(
  views: readonly InputRequestView[],
  action: McpElicitAnswer['action'],
  valuesByKey: Record<string, ElicitValues>,
):
  | { responses: Record<string, McpElicitAnswer>; problem?: undefined }
  | {
      responses?: undefined
      problem: { key: string; field: string; reason: 'required' | 'number' | 'integer' }
    } {
  const responses: Record<string, McpElicitAnswer> = {}
  for (const view of views) {
    if (action !== 'accept') {
      responses[view.key] = { action }
      continue
    }
    if (view.kind === 'unsupported') {
      responses[view.key] = { action: 'decline' }
      continue
    }
    const built = buildContent(view.fields, valuesByKey[view.key] ?? initialValues(view.fields))
    if (built.problem) return { problem: { key: view.key, ...built.problem } }
    responses[view.key] = { action: 'accept', content: built.content }
  }
  return { responses }
}
