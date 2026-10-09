/**
 * Schema-driven tool arguments (issue #162). Pure — no React.
 *
 * The tool's `inputSchema` becomes a form plan (string / number / integer /
 * boolean / enum leaves, arrays of primitives, nested objects); the form
 * edits the SAME `toolArgs` JSON text the JSON view edits — one source of
 * truth, patched in place so keys the form does not know survive.
 *
 * `{{var}}` is allowed in any input, numeric ones included: there it stays a
 * JSON string (`"count": "{{n}}"`) and `prepareToolArgs` turns the resolved
 * text back into a number / boolean per the schema at call time.
 *
 * Leaf fields reuse the elicitation form's parser (`toField`) and number
 * rules (`DECIMAL_RE`) so both forms read a schema the same way (P-K).
 */
import {
  DECIMAL_RE,
  optionValue,
  toField,
  type ContentProblemReason,
  type ElicitField,
} from './mcp-elicitation'
import { resolveVariables } from './variable-resolver'

export type ArgsPath = Array<string | number>

export type ArgsNode =
  | { kind: 'leaf'; name: string; path: ArgsPath; field: ElicitField }
  | {
      kind: 'array'
      name: string
      path: ArgsPath
      title?: string
      description?: string
      required: boolean
      /** The item field (its `required` is true: a row is never "absent"). */
      item: ElicitField
    }
  | {
      kind: 'object'
      name: string
      path: ArgsPath
      title?: string
      description?: string
      required: boolean
      children: ArgsNode[]
    }

/** Why a schema has no form — the JSON view's one-line note says it. */
export type ArgsFormUnsupported =
  | 'composition'
  | 'ref'
  | 'patternProperties'
  | 'arrayOfObjects'
  | 'untyped'
  | 'notObject'

export type ArgsFormPlan =
  | { ok: true; fields: ArgsNode[] }
  | { ok: false; reason: ArgsFormUnsupported }

export type ArgsProblemReason = ContentProblemReason | 'type' | 'enum'

export interface ArgsProblem {
  /** `a`, `a.b`, `tags[0]` — `(arguments)` for the root. */
  path: string
  reason: ArgsProblemReason
  limit?: number
  /** `type`: the expected JSON type. `enum`: the allowed values, comma-joined. */
  expected?: string
}

type Json = Record<string, unknown>

function isRecord(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const MAX_DEPTH = 24
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

/** `oneOf: [{ const, title }, …]` is a titled enum, not a composition. */
const isConstOneOf = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((o) => isRecord(o) && 'const' in o)

const isNullSchema = (v: unknown): boolean => isRecord(v) && v.type === 'null'

/**
 * Unwrap the nullable spellings generators emit (pydantic / zod):
 * `type: ['string', 'null']` and `anyOf|oneOf: [X, { type: 'null' }]` → X.
 * Real compositions, `$ref` and `patternProperties` are reported instead.
 */
export function unwrapSchema(raw: unknown): Json | ArgsFormUnsupported {
  let p: Json = isRecord(raw) ? raw : {}
  if (Array.isArray(p.type)) {
    const types = p.type.filter((t) => t !== 'null')
    if (types.length !== 1) return 'composition'
    p = { ...p, type: types[0] }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const list = p[key]
    if (!Array.isArray(list) || (key === 'oneOf' && isConstOneOf(list))) continue
    const rest = list.filter((s) => !isNullSchema(s))
    if (rest.length !== 1 || !isRecord(rest[0])) return 'composition'
    const { [key]: _dropped, ...outer } = p
    p = { ...rest[0], ...outer }
  }
  if (Array.isArray(p.allOf)) {
    if (p.allOf.length !== 1 || !isRecord(p.allOf[0])) return 'composition'
    const { allOf, ...outer } = p
    p = { ...(allOf as Json[])[0], ...outer }
  }
  if ('$ref' in p) return 'ref'
  if ('patternProperties' in p) return 'patternProperties'
  return p
}

const hasEnum = (p: Json): boolean => Array.isArray(p.enum) || isConstOneOf(p.oneOf)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function planNode(
  name: string,
  path: ArgsPath,
  raw: unknown,
  required: boolean,
  depth: number,
): ArgsNode | ArgsFormUnsupported {
  if (depth > MAX_DEPTH) return 'untyped'
  const p = unwrapSchema(raw)
  if (typeof p === 'string') return p
  if (hasEnum(p) || PRIMITIVE_TYPES.has(String(p.type))) {
    const field = toField(name, p, required)
    return field.kind === 'unsupported' ? 'untyped' : { kind: 'leaf', name, path, field }
  }
  const meta = {
    name,
    path,
    required,
    ...(str(p.title) ? { title: str(p.title) } : {}),
    ...(str(p.description) ? { description: str(p.description) } : {}),
  }
  if (p.type === 'array') {
    const items = unwrapSchema(p.items)
    if (typeof items === 'string') return items
    if (!hasEnum(items) && !PRIMITIVE_TYPES.has(String(items.type))) {
      return items.type === 'object' || items.type === 'array' || isRecord(items.properties)
        ? 'arrayOfObjects'
        : 'untyped'
    }
    const item = toField(name, items, true)
    if (item.kind === 'unsupported') return 'untyped'
    return { kind: 'array', ...meta, item }
  }
  if (p.type === 'object' || isRecord(p.properties)) {
    const children = planChildren(p, path, depth + 1)
    if (!Array.isArray(children)) return children
    return { kind: 'object', ...meta, children }
  }
  return 'untyped'
}

function planChildren(p: Json, path: ArgsPath, depth: number): ArgsNode[] | ArgsFormUnsupported {
  const props = isRecord(p.properties) ? p.properties : {}
  const required = new Set(
    Array.isArray(p.required) ? p.required.filter((n): n is string => typeof n === 'string') : [],
  )
  const out: ArgsNode[] = []
  for (const [name, prop] of Object.entries(props)) {
    const node = planNode(name, [...path, name], prop, required.has(name), depth)
    if (typeof node === 'string') return node
    out.push(node)
  }
  return out
}

/** A tool's `inputSchema` → the form, or why it has none. */
export function planArgsForm(schema: unknown): ArgsFormPlan {
  if (!isRecord(schema) || Object.keys(schema).length === 0) return { ok: true, fields: [] }
  const root = unwrapSchema(schema)
  if (typeof root === 'string') return { ok: false, reason: root }
  if (root.type !== undefined && root.type !== 'object') return { ok: false, reason: 'notObject' }
  const fields = planChildren(root, [], 0)
  return Array.isArray(fields) ? { ok: true, fields } : { ok: false, reason: fields }
}

// ─── Value I/O: toolArgs JSON ⇄ form inputs ─────────────────────────────────

/** `toolArgs` as an object, or null when it is not valid JSON / not an object. */
export function parseArgsObject(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text)
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

export function getAtPath(obj: unknown, path: ArgsPath): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[key]
  }
  return cur
}

/** Immutable set (`REMOVE` deletes the key / array slot); missing containers are created. */
export const REMOVE: unique symbol = Symbol('remove')

export function setAtPath(obj: unknown, path: ArgsPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(obj) ? [...obj] : []
    const next = setAtPath(arr[head], rest, value)
    if (next === REMOVE) arr.splice(head, 1)
    else arr[head] = next
    return arr
  }
  const rec: Json = isRecord(obj) ? { ...obj } : {}
  const next = setAtPath(rec[head], rest, value)
  if (next === REMOVE) delete rec[head]
  else rec[head] = next
  return rec
}

export const hasTemplate = (v: unknown): boolean => typeof v === 'string' && v.includes('{{')

/** A JSON value → what the leaf's input shows. */
export function leafText(field: ElicitField, value: unknown): string | boolean {
  if (field.kind === 'boolean') return value === true
  if (value === undefined || value === null) return ''
  if (field.kind === 'enum') {
    const option = (field.options ?? []).find((o) => optionValue(o) === value)
    if (option) return option.value
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * What the leaf's input means as a JSON value — `REMOVE` for an empty
 * optional field. Numbers are only stored as numbers once the text is
 * canonical (`1.0` stays text until it becomes `1.05`), so typing is never
 * rewritten under the cursor; `{{var}}` stays a string.
 */
export function leafValue(field: ElicitField, input: string | boolean): unknown {
  if (field.kind === 'boolean') return input === true
  const text = typeof input === 'string' ? input : String(input)
  if (field.kind === 'enum') {
    if (text === '') return REMOVE
    const option = (field.options ?? []).find((o) => o.value === text)
    return option ? optionValue(option) : text
  }
  if (field.kind === 'number' || field.kind === 'integer') {
    const trimmed = text.trim()
    if (trimmed === '') return REMOVE
    if (!hasTemplate(trimmed) && DECIMAL_RE.test(trimmed) && String(Number(trimmed)) === trimmed) {
      return Number(trimmed)
    }
    return text
  }
  if (text === '' && !field.required) return REMOVE
  return text
}

// ─── Validation (before Invoke) ─────────────────────────────────────────────

export const argsPathText = (path: ArgsPath): string =>
  path.length === 0
    ? '(arguments)'
    : path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i === 0 ? k : `.${k}`)).join('')

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

function enumValues(p: Json): unknown[] | null {
  if (Array.isArray(p.enum)) return p.enum
  if (isConstOneOf(p.oneOf)) return (p.oneOf as Json[]).map((o) => o.const)
  return null
}

function typeOk(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isRecord(value)
    case 'null':
      return value === null
    default:
      return true
  }
}

function walk(value: unknown, raw: unknown, path: ArgsPath, out: ArgsProblem[], depth: number) {
  if (depth > MAX_DEPTH) return
  const nullable =
    (isRecord(raw) && Array.isArray(raw.type) && raw.type.includes('null')) ||
    (isRecord(raw) &&
      ['anyOf', 'oneOf'].some(
        (k) => Array.isArray(raw[k]) && (raw[k] as unknown[]).some(isNullSchema),
      ))
  if (value === null && nullable) return
  // `{{var}}` resolves at call time — nothing to check yet.
  if (hasTemplate(value)) return
  const p = unwrapSchema(raw)
  // Compositions / $ref: the server validates; we do not guess.
  if (typeof p === 'string') return
  const at = argsPathText(path)
  const allowed = enumValues(p)
  if (allowed) {
    if (!allowed.some((a) => a === value)) {
      out.push({ path: at, reason: 'enum', expected: allowed.map((a) => String(a)).join(', ') })
    }
    return
  }
  const type = p.type ?? (isRecord(p.properties) ? 'object' : undefined)
  if (!typeOk(type, value)) {
    if (type === 'integer' && typeof value === 'number') {
      out.push({ path: at, reason: 'integer' })
    } else {
      out.push({ path: at, reason: 'type', expected: String(type) })
    }
    return
  }
  if (typeof value === 'string') {
    const length = [...value].length
    const min = num(p.minLength)
    const max = num(p.maxLength)
    if (min !== undefined && length < min) out.push({ path: at, reason: 'minLength', limit: min })
    else if (max !== undefined && length > max)
      out.push({ path: at, reason: 'maxLength', limit: max })
    return
  }
  if (typeof value === 'number') {
    const min = num(p.minimum)
    const max = num(p.maximum)
    if (min !== undefined && value < min) out.push({ path: at, reason: 'minimum', limit: min })
    else if (max !== undefined && value > max) out.push({ path: at, reason: 'maximum', limit: max })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, p.items, [...path, i], out, depth + 1))
    return
  }
  if (isRecord(value)) {
    const props = isRecord(p.properties) ? p.properties : {}
    const required = Array.isArray(p.required) ? p.required : []
    for (const name of required) {
      if (typeof name !== 'string') continue
      const v = value[name]
      if (v === undefined || v === '')
        out.push({ path: argsPathText([...path, name]), reason: 'required' })
    }
    for (const [name, prop] of Object.entries(props)) {
      const v = value[name]
      if (v === undefined || (v === '' && required.includes(name))) continue
      walk(v, prop, [...path, name], out, depth + 1)
    }
  }
}

/**
 * Required / type / enum / bounds problems of `value` against the tool's
 * `inputSchema`. Values holding `{{var}}` are skipped (resolved at call
 * time); keywords the walker does not know are left to the server.
 */
export function validateArgs(value: unknown, schema: unknown): ArgsProblem[] {
  if (!isRecord(schema) || Object.keys(schema).length === 0) return []
  const out: ArgsProblem[] = []
  walk(value, schema, [], out, 0)
  return out
}

// ─── Call-time preparation ──────────────────────────────────────────────────

/**
 * `{{var}}` placeholders the user put in a number / integer / boolean field
 * resolved to text (`"5"`); turn that text into the type the schema asks for.
 * Only values whose RAW form held a placeholder are touched.
 */
export function coerceTemplated(
  raw: unknown,
  resolved: unknown,
  schema: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return resolved
  const p = unwrapSchema(schema)
  if (typeof p === 'string') return resolved
  if (hasTemplate(raw) && typeof resolved === 'string') {
    const text = resolved.trim()
    if ((p.type === 'number' || p.type === 'integer') && DECIMAL_RE.test(text)) return Number(text)
    if (p.type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true'
    return resolved
  }
  if (Array.isArray(raw) && Array.isArray(resolved)) {
    return resolved.map((v, i) => coerceTemplated(raw[i], v, p.items, depth + 1))
  }
  if (isRecord(raw) && isRecord(resolved)) {
    const props = isRecord(p.properties) ? p.properties : {}
    const out: Json = {}
    for (const [k, v] of Object.entries(resolved)) {
      out[k] = k in props ? coerceTemplated(raw[k], v, props[k], depth + 1) : v
    }
    return out
  }
  return resolved
}

export type PreparedArgs =
  | { args: Record<string, unknown>; raw: unknown; error?: undefined }
  | { error: 'json'; args?: undefined; raw?: undefined }

/**
 * `toolArgs` text → the arguments a call sends: `{{var}}` resolved in the text
 * (so placeholders work anywhere, as before), parsed, then schema-coerced.
 * `raw` is the unresolved parse (for validation), or the resolved one when
 * the raw text is not JSON on its own (an unquoted `{{n}}`).
 */
export function prepareToolArgs(
  text: string,
  vars: Record<string, string>,
  schema?: unknown,
): PreparedArgs {
  let resolved: unknown
  try {
    resolved = JSON.parse(resolveVariables(text, vars))
  } catch {
    return { error: 'json' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  const args = (
    schema !== undefined && raw !== undefined ? coerceTemplated(raw, resolved, schema) : resolved
  ) as Record<string, unknown>
  return { args, raw: raw ?? resolved }
}

// ─── View preference ────────────────────────────────────────────────────────

export type ArgsView = 'form' | 'json'
const VIEW_KEY = 'testnizer-mcp-args-view'

/**
 * The user's last Form / JSON choice (per user, not per tab). JSON until the
 * user picks Form: the raw editor is what existing users (and the e2e
 * flows) know, and it never blocks a call.
 */
export function loadArgsView(): ArgsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'form' ? 'form' : 'json'
  } catch {
    return 'json'
  }
}

export function saveArgsView(view: ArgsView): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    /* private window / blocked storage — the choice just is not remembered */
  }
}
