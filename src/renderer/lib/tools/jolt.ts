/**
 * Minimal Jolt-compatible JSON transformation engine.
 * Implements a subset of the Bazaarvoice Jolt spec:
 *   - operation: "shift"   (relocate fields)
 *   - operation: "default" (fill in missing values)
 *   - operation: "remove"  (delete fields)
 *
 * Spec format:
 *   [
 *     { "operation": "shift",   "spec": { ... } },
 *     { "operation": "default", "spec": { ... } },
 *     { "operation": "remove",  "spec": { ... } }
 *   ]
 *
 * Java Jolt has many more operators (sort, modify-overwrite-beta, cardinality, ...).
 * Those are out of scope until a user requests them — keep the engine
 * approachable and well-tested for the 80% case.
 */

export type JoltOperation = 'shift' | 'default' | 'remove'

export type JoltSpecEntry = {
  operation: JoltOperation
  spec: unknown
}

export type JoltResult = { ok: true; output: unknown } | { ok: false; error: string }

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export function transformJolt(input: string, specJson: string): JoltResult {
  let inputData: JsonValue
  let spec: JoltSpecEntry[]
  try {
    inputData = JSON.parse(input) as JsonValue
  } catch (e) {
    return { ok: false, error: 'Invalid input JSON: ' + msg(e) }
  }
  try {
    const parsedSpec = JSON.parse(specJson) as unknown
    if (!Array.isArray(parsedSpec)) {
      return { ok: false, error: 'Spec must be an array of {operation, spec} entries' }
    }
    spec = parsedSpec as JoltSpecEntry[]
  } catch (e) {
    return { ok: false, error: 'Invalid spec JSON: ' + msg(e) }
  }

  let current: JsonValue = inputData
  for (const [i, entry] of spec.entries()) {
    if (!entry || typeof entry !== 'object' || !entry.operation) {
      return { ok: false, error: `Entry ${i}: missing "operation"` }
    }
    try {
      switch (entry.operation) {
        case 'shift':
          current = applyShift(current, entry.spec as Record<string, unknown>)
          break
        case 'default':
          current = applyDefault(current, entry.spec as JsonValue) as JsonValue
          break
        case 'remove':
          current = applyRemove(current, entry.spec as Record<string, unknown>) as JsonValue
          break
        default:
          return {
            ok: false,
            error: `Entry ${i}: unsupported operation "${entry.operation}"`,
          }
      }
    } catch (e) {
      return { ok: false, error: `Entry ${i} (${entry.operation}): ${msg(e)}` }
    }
  }
  return { ok: true, output: current }
}

// ─── shift ───────────────────────────────────────────────────────

/**
 * Shift relocates input fields to output paths. The spec mirrors the input
 * tree — each leaf string is the dot-path destination. Wildcards `*`
 * match any key; `&N` placeholders re-use the Nth captured key.
 */
function applyShift(input: JsonValue, spec: Record<string, unknown>): JsonValue {
  const output: Record<string, JsonValue> = {}
  shiftRecurse(input, spec, output, [])
  return output
}

function shiftRecurse(
  data: JsonValue,
  spec: Record<string, unknown> | string,
  output: Record<string, JsonValue>,
  captures: string[],
): void {
  if (typeof spec === 'string') {
    placeAtPath(output, resolvePath(spec, captures), data)
    return
  }
  if (data === null || typeof data !== 'object') return

  if (Array.isArray(data)) {
    data.forEach((item, idx) => {
      const key = String(idx)
      const matched = matchKey(spec, key)
      if (matched) {
        shiftRecurse(item, matched.value, output, [...captures, key])
      }
    })
    return
  }

  for (const [key, value] of Object.entries(data)) {
    const matched = matchKey(spec, key)
    if (matched) {
      shiftRecurse(value as JsonValue, matched.value, output, [...captures, key])
    }
  }
}

function matchKey(
  spec: Record<string, unknown>,
  key: string,
): { value: Record<string, unknown> | string } | null {
  // Exact match wins
  if (key in spec) {
    return { value: spec[key] as Record<string, unknown> | string }
  }
  // Wildcard fallback
  if ('*' in spec) {
    return { value: spec['*'] as Record<string, unknown> | string }
  }
  return null
}

function resolvePath(template: string, captures: string[]): string {
  // Replace &N (e.g. &1) with captured key
  return template.replace(/&(\d+)/g, (_, n) => {
    const idx = captures.length - 1 - parseInt(n, 10)
    return captures[idx] ?? ''
  })
}

function placeAtPath(out: Record<string, JsonValue>, path: string, value: JsonValue): void {
  if (!path) return
  const parts = path.split('.')
  let cursor: Record<string, JsonValue> = out
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (typeof cursor[part] !== 'object' || cursor[part] === null || Array.isArray(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, JsonValue>
  }
  const leaf = parts[parts.length - 1]
  // If a value already exists at the path, promote it to an array (Jolt array semantics)
  if (leaf in cursor) {
    const existing = cursor[leaf]
    if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      cursor[leaf] = [existing, value]
    }
  } else {
    cursor[leaf] = value
  }
}

// ─── default ─────────────────────────────────────────────────────

/**
 * Default fills in missing fields. Existing values are preserved (no overwrite).
 */
function applyDefault(input: JsonValue, spec: JsonValue): JsonValue {
  if (Array.isArray(spec)) {
    if (!Array.isArray(input)) return spec
    return input
  }
  if (spec === null || typeof spec !== 'object') return input
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    // Replace primitive/missing with the default object tree
    return JSON.parse(JSON.stringify(spec)) as JsonValue
  }
  const out: Record<string, JsonValue> = { ...(input as Record<string, JsonValue>) }
  for (const [key, value] of Object.entries(spec)) {
    if (!(key in out)) {
      out[key] = JSON.parse(JSON.stringify(value)) as JsonValue
    } else {
      out[key] = applyDefault(out[key], value as JsonValue)
    }
  }
  return out
}

// ─── remove ──────────────────────────────────────────────────────

/**
 * Remove deletes fields whose spec entry is truthy ("" or {} or true).
 * Nested objects in the spec recurse.
 */
function applyRemove(input: JsonValue, spec: Record<string, unknown>): JsonValue {
  if (input === null || typeof input !== 'object') return input
  if (Array.isArray(input)) {
    return input.map((v) => applyRemove(v as JsonValue, spec)) as JsonValue
  }
  const out: Record<string, JsonValue> = { ...(input as Record<string, JsonValue>) }
  for (const [key, value] of Object.entries(spec)) {
    if (!(key in out)) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = applyRemove(out[key], value as Record<string, unknown>)
    } else {
      delete out[key]
    }
  }
  return out
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ───────────────────────────────────────────────────────────────────
// Sample library
// ───────────────────────────────────────────────────────────────────

export interface JoltExample {
  label: string
  input: string
  spec: string
}

const J = (v: unknown) => JSON.stringify(v, null, 2)

/**
 * Jolt samples adapted from Bazaarvoice Jolt's reference set.
 * Restricted to the operators supported by our engine: shift / default / remove.
 */
export const JOLT_EXAMPLES: JoltExample[] = [
  {
    label: '1. Inception (basic shift)',
    input: J({ rating: { primary: { value: 3 }, quality: { value: 3 } } }),
    spec: J([
      {
        operation: 'shift',
        spec: {
          rating: {
            primary: { value: 'Rating' },
            '*': { value: 'SecondaryRatings.&1.Value', $: 'SecondaryRatings.&1.Id' },
          },
        },
      },
    ]),
  },
  {
    label: '2. Convert nested data to "prefix soup"',
    input: J({ author: { name: 'Joe', age: 42 } }),
    spec: J([{ operation: 'shift', spec: { author: { '*': 'author_&' } } }]),
  },
  {
    label: '3. Convert "prefix soup" back to nested data',
    input: J({ author_name: 'Joe', author_age: 42 }),
    spec: J([
      {
        operation: 'shift',
        spec: { author_name: 'author.name', author_age: 'author.age' },
      },
    ]),
  },
  {
    label: '4. Grab LHS key values',
    input: J({ Joe: { age: 42 }, Sue: { age: 25 } }),
    spec: J([{ operation: 'shift', spec: { '*': { age: 'people.&1.age', $: 'people.&1.name' } } }]),
  },
  {
    label: '5. Map → list',
    input: J({ items: { a: { qty: 1 }, b: { qty: 2 } } }),
    spec: J([{ operation: 'shift', spec: { items: { '*': { qty: 'list.qty' } } } }]),
  },
  {
    label: '6. List → map',
    input: J({
      list: [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ],
    }),
    spec: J([{ operation: 'shift', spec: { list: { '*': { v: 'map.&(1,id)' } } } }]),
  },
  {
    label: '7. On a match, apply a String default',
    input: J({ user: { firstName: 'Alice' } }),
    spec: J([
      { operation: 'shift', spec: { user: { firstName: 'name' } } },
      { operation: 'default', spec: { active: true, role: 'guest' } },
    ]),
  },
  {
    label: '8. Base case simple Transpose',
    input: J({ a: 1, b: 2, c: 3 }),
    spec: J([{ operation: 'shift', spec: { a: 'x', b: 'y', c: 'z' } }]),
  },
  {
    label: '9. Filter data from an Array (leaf level)',
    input: J({
      items: [
        { keep: true, v: 1 },
        { keep: false, v: 2 },
        { keep: true, v: 3 },
      ],
    }),
    spec: J([
      { operation: 'shift', spec: { items: { '*': { keep: { true: { '@2,v': 'kept' } } } } } },
    ]),
  },
  {
    label: '10. Remove a field',
    input: J({ user: { name: 'Alice', secret: 'hide-me', email: 'a@b.com' } }),
    spec: J([{ operation: 'remove', spec: { user: { secret: '' } } }]),
  },
  {
    label: '11. Default missing values',
    input: J({ user: { name: 'Alice' } }),
    spec: J([
      {
        operation: 'default',
        spec: { user: { active: true, role: 'guest', tags: [] } },
      },
    ]),
  },
  {
    label: '12. Multi-step pipeline',
    input: J({ user: { firstName: 'Alice', lastName: 'Smith', secret: 'x', email: 'a@b.com' } }),
    spec: J([
      {
        operation: 'shift',
        spec: { user: { firstName: 'profile.name', email: 'profile.contact' } },
      },
      { operation: 'default', spec: { profile: { active: true } } },
      { operation: 'remove', spec: { profile: { secret: '' } } },
    ]),
  },
  {
    label: '13. Wildcard shift on every key',
    input: J({ alpha: 1, beta: 2, gamma: 3 }),
    spec: J([{ operation: 'shift', spec: { '*': 'numbers.&' } }]),
  },
  {
    label: '14. Pull values out of an array',
    input: J({ books: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }),
    spec: J([{ operation: 'shift', spec: { books: { '*': { title: 'titles' } } } }]),
  },
  {
    label: '15. String concatenation by destination',
    input: J({ rating: { stars: 4 }, votes: 100 }),
    spec: J([
      { operation: 'shift', spec: { rating: { stars: 'summary.stars' }, votes: 'summary.votes' } },
    ]),
  },
  {
    label: '16. Type Conversion (move number into string field)',
    input: J({ count: 42 }),
    spec: J([{ operation: 'shift', spec: { count: 'meta.totalAsString' } }]),
  },
  {
    label: '17. Reorder a map',
    input: J({ z: 1, a: 2, m: 3 }),
    spec: J([{ operation: 'shift', spec: { a: 'a', m: 'm', z: 'z' } }]),
  },
]
