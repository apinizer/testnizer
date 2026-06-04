/**
 * Main-process variable resolver. Mirrors `src/renderer/lib/variable-resolver.ts`
 * + `src/renderer/lib/dynamic-values.ts` so the Collection Runner produces
 * the same output as the request editor's "Send" — previously the runner
 * used a stripped-down resolver that:
 *
 *   • ignored `{{$dynamicValue}}` expressions
 *   • didn't resolve chained references like `{{baseUrl}}` → `https://{{host}}`
 *
 * Duplicating instead of cross-importing because the main-process tsconfig
 * excludes `src/renderer/**`. The two files should stay in sync — keep the
 * dynamic-value tables (FIRST_NAMES, etc.) byte-for-byte identical when
 * adding new helpers.
 */

const FIRST_NAMES = [
  'Alice',
  'Bob',
  'Carol',
  'David',
  'Eve',
  'Frank',
  'Grace',
  'Henry',
  'Ivy',
  'Jack',
  'Kate',
  'Leo',
  'Maya',
  'Noah',
  'Olivia',
  'Paul',
  'Quinn',
  'Rose',
  'Sam',
  'Tara',
  'Uma',
  'Victor',
  'Wendy',
  'Xander',
]

const LAST_NAMES = [
  'Johnson',
  'Smith',
  'Williams',
  'Brown',
  'Jones',
  'Davis',
  'Miller',
  'Wilson',
  'Moore',
  'Taylor',
  'Anderson',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Garcia',
]

const DOMAINS = ['example.com', 'test.io', 'demo.org', 'mail.dev', 'sample.net']

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function randomName(): string {
  const first = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)]
  const last = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)]
  return `${first} ${last}`
}

function randomEmail(): string {
  const first = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)].toLowerCase()
  const last = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)].toLowerCase()
  const domain = DOMAINS[randomInt(0, DOMAINS.length - 1)]
  return `${first}.${last}@${domain}`
}

function formatDatetime(format: string): string {
  const now = new Date()
  return format
    .replace('YYYY', String(now.getFullYear()))
    .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
    .replace('DD', String(now.getDate()).padStart(2, '0'))
    .replace('HH', String(now.getHours()).padStart(2, '0'))
    .replace('mm', String(now.getMinutes()).padStart(2, '0'))
    .replace('ss', String(now.getSeconds()).padStart(2, '0'))
}

function resolveDynamicValue(expr: string): string {
  const funcMatch = expr.match(/^\$(\w+)\((.+)\)$/)
  if (funcMatch) {
    const name = funcMatch[1]
    const args = funcMatch[2]
    switch (name) {
      case 'randomInt': {
        const parts = args.split(',').map((s) => parseInt(s.trim(), 10))
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return String(randomInt(parts[0], parts[1]))
        }
        return String(randomInt(0, 1000))
      }
      case 'randomString': {
        const len = parseInt(args.trim(), 10)
        return randomString(isNaN(len) ? 8 : len)
      }
      case 'datetime': {
        const fmt = args.replace(/['"]/g, '').trim()
        return formatDatetime(fmt)
      }
      default:
        return expr
    }
  }
  switch (expr) {
    case '$randomInt':
      return String(randomInt(0, 1000))
    case '$timestamp':
      return String(Math.floor(Date.now() / 1000))
    case '$isoTimestamp':
      return new Date().toISOString()
    case '$randomUUID':
      return randomUUID()
    case '$randomEmail':
      return randomEmail()
    case '$randomName':
      return randomName()
    case '$randomString':
      return randomString(8)
    default:
      return expr
  }
}

// Bound on chained `{{a}} → {{b}} → ...` resolution. Same value the
// renderer uses so behaviour matches end-to-end.
const MAX_RESOLVE_DEPTH = 10

/**
 * Resolve `{{var}}` and `{{$dynamicValue}}` placeholders in a single string.
 * Iterates up to MAX_RESOLVE_DEPTH passes so values that reference other
 * variables resolve through; circular references hit the cap rather than
 * spinning forever.
 */
export function resolveVariables(template: string, vars: Record<string, string>): string {
  if (!template) return template

  const substitute = (input: string): string =>
    input.replace(/\{\{([^}]+)\}\}/g, (_match, expression: string) => {
      const trimmed = expression.trim()
      if (trimmed.startsWith('$')) return resolveDynamicValue(trimmed)
      if (trimmed in vars) return vars[trimmed]
      return `{{${trimmed}}}`
    })

  let current = template
  for (let i = 0; i < MAX_RESOLVE_DEPTH; i++) {
    const next = substitute(current)
    if (next === current) return next
    current = next
  }
  return current
}
