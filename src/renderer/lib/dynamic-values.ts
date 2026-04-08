/**
 * Resolves built-in dynamic value expressions.
 * Supported:
 *   $randomInt          — random integer 0-1000
 *   $randomInt(min,max) — random integer in range
 *   $timestamp          — unix timestamp (seconds)
 *   $isoTimestamp       — ISO 8601 string
 *   $randomUUID         — v4-style UUID
 *   $randomEmail        — random email address
 *   $randomName         — random full name
 *   $randomString(n)    — random alphanumeric string of length n
 *   $datetime(format)   — formatted date (basic support)
 */

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank',
  'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Leo',
  'Maya', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rose',
  'Sam', 'Tara', 'Uma', 'Victor', 'Wendy', 'Xander',
]

const LAST_NAMES = [
  'Johnson', 'Smith', 'Williams', 'Brown', 'Jones', 'Davis',
  'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas',
  'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia',
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

/**
 * Resolve a single dynamic value expression.
 * @param expr — e.g. "$randomInt", "$randomInt(1,100)", "$timestamp"
 */
export function resolveDynamicValue(expr: string): string {
  // Parse function-style calls: $name(args)
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

  // Simple (no-arg) dynamic values
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
