/**
 * Mock MCP tool elicitation (issue #152) ⇄ the editor's fields table. Pure.
 *
 * The backend DTO (`MockMcpElicitDto`) carries a restricted elicitation JSON
 * Schema: `{ type: 'object', properties: { <name>: { type: string | number |
 * integer | boolean, enum?: string[] , …} }, required?: [...] }`. The editor
 * holds one row per property; keywords it has no column for (`title`,
 * `minLength`, …) ride along in `extra` so a round trip keeps them. Titled
 * `oneOf` / `enumNames` labels and unsupported property shapes are kept too
 * (issue #154) — see `rowFromProperty`.
 */
import type {
  MockMcpElicit,
  MockMcpElicitDraft,
  MockMcpElicitFieldRow,
  MockMcpElicitFieldType,
} from '../../types/mock-mcp'

let rowSeq = 0
function rowId(): string {
  rowSeq += 1
  return `ef${rowSeq.toString(36)}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function blankElicitRow(name = ''): MockMcpElicitFieldRow {
  return { id: rowId(), name, type: 'string', enumText: '', required: true, extra: {} }
}

/** A fresh elicitation section: one required string field. */
export function blankElicitDraft(): MockMcpElicitDraft {
  return {
    key: 'input',
    message: 'Please provide a value',
    responseTemplate: '',
    fields: [blankElicitRow('value')],
  }
}

const PLAIN_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

const allStrings = (v: unknown[]): v is string[] => v.every((x) => typeof x === 'string')

function unsupportedRow(
  name: string,
  prop: Record<string, unknown>,
  required: boolean,
): MockMcpElicitFieldRow {
  return {
    id: rowId(),
    name,
    type: 'unsupported',
    enumText: '',
    required,
    extra: {},
    raw: prop,
  }
}

/**
 * One schema property → an editor row. What the table cannot edit is kept so
 * Save writes it back unchanged (issue #154): titled `oneOf` and `enumNames`
 * as per-value `enumEntries`, any other shape (array, non-string enum, no
 * type, …) verbatim as an `unsupported` row.
 */
function rowFromProperty(name: string, raw: unknown, required: boolean): MockMcpElicitFieldRow {
  const prop = isRecord(raw) ? raw : {}
  const { type, enum: values, oneOf, enumNames, ...extra } = prop
  const base = { id: rowId(), name, required, extra }
  if (values !== undefined || oneOf !== undefined) {
    if (type !== 'string') return unsupportedRow(name, prop, required)
    if (Array.isArray(values) && allStrings(values) && oneOf === undefined) {
      if (enumNames === undefined) {
        return { ...base, type: 'enum', enumText: values.join(', ') }
      }
      if (!Array.isArray(enumNames) || !allStrings(enumNames)) {
        return unsupportedRow(name, prop, required)
      }
      const entries: Record<string, Record<string, unknown>> = {}
      values.forEach((v, i) => {
        if (!Object.hasOwn(entries, v) && enumNames[i] !== undefined) {
          entries[v] = { title: enumNames[i] }
        }
      })
      return {
        ...base,
        type: 'enum',
        enumText: values.join(', '),
        enumStyle: 'enumNames',
        enumEntries: entries,
      }
    }
    if (
      Array.isArray(oneOf) &&
      values === undefined &&
      enumNames === undefined &&
      oneOf.every((o) => isRecord(o) && typeof o.const === 'string')
    ) {
      const consts: string[] = []
      const entries: Record<string, Record<string, unknown>> = {}
      for (const o of oneOf as Array<Record<string, unknown>>) {
        const { const: c, ...rest } = o
        consts.push(c as string)
        if (!Object.hasOwn(entries, c as string)) entries[c as string] = rest
      }
      return {
        ...base,
        type: 'enum',
        enumText: consts.join(', '),
        enumStyle: 'oneOf',
        enumEntries: entries,
      }
    }
    return unsupportedRow(name, prop, required)
  }
  if (typeof type !== 'string' || !PLAIN_TYPES.has(type) || enumNames !== undefined) {
    return unsupportedRow(name, prop, required)
  }
  return { ...base, type: type as MockMcpElicitFieldType, enumText: '' }
}

export function elicitToDraft(e: MockMcpElicit): MockMcpElicitDraft {
  const schema = isRecord(e.schema) ? e.schema : {}
  const props = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((r): r is string => typeof r === 'string')
      : [],
  )
  return {
    key: e.key,
    message: e.message,
    responseTemplate: e.responseTemplate ?? '',
    fields: Object.entries(props).map(([name, prop]) =>
      rowFromProperty(name, prop, required.has(name)),
    ),
  }
}

/** `a, b ,, c` → `['a', 'b', 'c']`. */
export function parseEnumText(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

/** The `enumEntries` record of `value`, if any. */
function entryOf(row: MockMcpElicitFieldRow, value: string): Record<string, unknown> | undefined {
  const entries = row.enumEntries
  return entries && Object.hasOwn(entries, value) ? entries[value] : undefined
}

/** One row → its schema property (enum labels re-aligned to the current values). */
function propertyFromRow(row: MockMcpElicitFieldRow): Record<string, unknown> {
  if (row.type === 'unsupported') return { ...(row.raw ?? {}) }
  if (row.type !== 'enum') return { ...row.extra, type: row.type }
  const values = parseEnumText(row.enumText)
  if (row.enumStyle === 'oneOf') {
    return {
      ...row.extra,
      type: 'string',
      // A value without an entry is new — titled with itself.
      oneOf: values.map((v) => ({ const: v, ...(entryOf(row, v) ?? { title: v }) })),
    }
  }
  if (row.enumStyle === 'enumNames') {
    return {
      ...row.extra,
      type: 'string',
      enum: values,
      enumNames: values.map((v) => {
        const title = entryOf(row, v)?.title
        return typeof title === 'string' ? title : v
      }),
    }
  }
  return { ...row.extra, type: 'string', enum: values }
}

/** Rows → the restricted schema. Rows without a name are skipped. */
export function rowsToElicitSchema(
  rows: readonly MockMcpElicitFieldRow[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    properties[name] = propertyFromRow(row)
    if (row.required && !required.includes(name)) required.push(name)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

export function draftToElicit(d: MockMcpElicitDraft): MockMcpElicit {
  return {
    key: d.key.trim(),
    message: d.message,
    schema: rowsToElicitSchema(d.fields),
    ...(d.responseTemplate.trim() !== '' ? { responseTemplate: d.responseTemplate } : {}),
  }
}

/** The first enum row without values (the backend would reject an empty `enum`), or null. */
export function emptyEnumField(d: MockMcpElicitDraft): string | null {
  const row = d.fields.find(
    (r) => r.name.trim() !== '' && r.type === 'enum' && parseEnumText(r.enumText).length === 0,
  )
  return row ? row.name.trim() : null
}

/** The first field name used by more than one row (trimmed; blank names ignored), or null. */
export function duplicateElicitField(d: MockMcpElicitDraft): string | null {
  const seen = new Set<string>()
  for (const row of d.fields) {
    const name = row.name.trim()
    if (!name) continue
    if (seen.has(name)) return name
    seen.add(name)
  }
  return null
}
