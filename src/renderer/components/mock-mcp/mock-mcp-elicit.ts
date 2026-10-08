/**
 * Mock MCP tool elicitation (issue #152) ⇄ the editor's fields table. Pure.
 *
 * The backend DTO (`MockMcpElicitDto`) carries a restricted elicitation JSON
 * Schema: `{ type: 'object', properties: { <name>: { type: string | number |
 * integer | boolean, enum?: string[] , …} }, required?: [...] }`. The editor
 * holds one row per property; keywords it has no column for (`title`,
 * `minLength`, …) ride along in `extra` so a round trip keeps them.
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

function rowFromProperty(name: string, raw: unknown, required: boolean): MockMcpElicitFieldRow {
  const prop = isRecord(raw) ? raw : {}
  const { type, enum: values, oneOf, ...extra } = prop
  let enumValues: string[] | null = null
  if (Array.isArray(values)) enumValues = values.filter((v): v is string => typeof v === 'string')
  else if (Array.isArray(oneOf)) {
    enumValues = oneOf
      .filter(isRecord)
      .map((o) => o.const)
      .filter((v): v is string => typeof v === 'string')
  }
  const fieldType: MockMcpElicitFieldType = enumValues
    ? 'enum'
    : type === 'number' || type === 'integer' || type === 'boolean'
      ? type
      : 'string'
  // `enumNames` only makes sense next to `enum`; drop it with the conversion.
  if (!enumValues) delete extra.enumNames
  return {
    id: rowId(),
    name,
    type: fieldType,
    enumText: enumValues ? enumValues.join(', ') : '',
    required,
    extra,
  }
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

/** Rows → the restricted schema. Rows without a name are skipped. */
export function rowsToElicitSchema(
  rows: readonly MockMcpElicitFieldRow[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    properties[name] =
      row.type === 'enum'
        ? { ...row.extra, type: 'string', enum: parseEnumText(row.enumText) }
        : { ...row.extra, type: row.type }
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
