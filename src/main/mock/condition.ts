/**
 * Conditional response evaluator.
 *
 * Each MockResponse carries a MockCondition; the engine picks the first
 * response whose condition evaluates to true. `{type:'always'}` is the
 * default-match catchall.
 */

import { JSONPath } from 'jsonpath-plus'
import type { MockCondition, MockConditionOp } from './types'

export interface ConditionContext {
  method: string
  headers: Record<string, string>
  query: Record<string, string>
  pathParams: Record<string, string>
  body: unknown
  bodyText: string
}

export function evaluateCondition(cond: MockCondition, ctx: ConditionContext): boolean {
  switch (cond.type) {
    case 'always':
      return true
    case 'method':
      return ctx.method.toUpperCase() === cond.method.toUpperCase()
    case 'header': {
      const v = ctx.headers[cond.name.toLowerCase()] ?? ''
      return compareWithOp(v, cond.op, cond.value)
    }
    case 'query': {
      const v = ctx.query[cond.name] ?? ''
      return compareWithOp(v, cond.op, cond.value)
    }
    case 'pathParam': {
      const v = ctx.pathParams[cond.name] ?? ''
      return compareWithOp(v, cond.op, cond.value)
    }
    case 'jsonPath': {
      try {
        type JsonValue = string | number | boolean | object | unknown[] | null
        const matches = JSONPath({
          path: cond.path,
          json: ctx.body as JsonValue,
        }) as unknown as unknown[]
        if (cond.op === 'exists') return matches.length > 0
        if (matches.length === 0) return false
        const first = matches[0]
        const str = typeof first === 'string' ? first : JSON.stringify(first)
        return compareWithOp(str, cond.op, cond.value ?? '')
      } catch {
        return false
      }
    }
    case 'xpath': {
      // XPath against bodyText (XML). Using a lazy import would make this async;
      // since matcher runs in a synchronous loop, do a minimal contains/eq fallback
      // when XML parsing isn't available — full XPath wired in via the engine pre-step.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DOMParser } = require('@xmldom/xmldom') as typeof import('@xmldom/xmldom')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const xpath = require('xpath') as typeof import('xpath')
        const doc = new DOMParser({ onError: () => {} }).parseFromString(ctx.bodyText, 'text/xml')
        const select = xpath.useNamespaces({})
        const raw = select(cond.expression, doc as unknown as Node)
        if (cond.op === 'exists') {
          if (Array.isArray(raw)) return raw.length > 0
          if (typeof raw === 'string') return raw.length > 0
          return raw != null
        }
        const str = Array.isArray(raw)
          ? (raw as Node[]).map((n) => (n.textContent ?? '').trim()).join(',')
          : String(raw ?? '')
        return compareWithOp(str, cond.op, cond.value ?? '')
      } catch {
        return false
      }
    }
    case 'and':
      return cond.conditions.every((c) => evaluateCondition(c, ctx))
    case 'or':
      return cond.conditions.some((c) => evaluateCondition(c, ctx))
  }
}

function compareWithOp(actual: string, op: MockConditionOp, expected: string): boolean {
  switch (op) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'contains':
      return actual.includes(expected)
    case 'regex':
      try {
        return new RegExp(expected).test(actual)
      } catch {
        return false
      }
    case 'exists':
      return actual !== '' && actual !== undefined && actual !== null
  }
}
