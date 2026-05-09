/**
 * Templating layer for mock-server response bodies and headers.
 *
 * Two-pass render:
 *   1. Handlebars template (supports {{#if}}, {{#each}}, {{lookup}}, {{> partial}}, …)
 *   2. Variable resolver-style substitutions for built-in dynamic values:
 *        {{$timestamp}}, {{$isoTimestamp}}, {{$randomUUID}},
 *        {{$randomInt}}, {{$randomInt(min,max)}}, {{$randomEmail}},
 *        {{$randomString}}, {{$randomString(n)}}.
 *
 * The first pass runs first because Handlebars treats `$timestamp` as a missing
 * helper and would emit empty strings — so we delay the dynamic-value replacement
 * to a post-step that operates on Handlebars output. Templates without Handlebars
 * markup pass through unchanged.
 */

import Handlebars from 'handlebars'

export interface TemplateContext {
  request: {
    method: string
    path: string
    headers: Record<string, string>
    query: Record<string, string>
    params: Record<string, string>
    body: unknown
    bodyText: string
  }
  /** When true, response body is also surfaced (used by interceptors). */
  state?: Record<string, unknown>
}

const hb = Handlebars.create()

// Useful helpers that don't expose anything dangerous.
hb.registerHelper('json', (ctx) => JSON.stringify(ctx))
hb.registerHelper('eq', (a, b) => a === b)
hb.registerHelper('neq', (a, b) => a !== b)
hb.registerHelper('upper', (s: unknown) => String(s ?? '').toUpperCase())
hb.registerHelper('lower', (s: unknown) => String(s ?? '').toLowerCase())
hb.registerHelper('default', (a: unknown, b: unknown) => ((a ?? '') === '' ? b : a))

/** Render a template against a context. Errors return the literal source.
 *  Order matters: we apply dynamic values FIRST, before Handlebars compiles
 *  the template. Handlebars treats `{{$randomUUID}}` as a missing context
 *  lookup and would emit empty strings; pre-resolving them sidesteps that. */
export function renderTemplate(source: string, ctx: TemplateContext): string {
  if (!source) return ''
  const stage0 = applyDynamicValues(source)
  try {
    const compiled = hb.compile(stage0, { noEscape: true })
    return compiled(ctx)
  } catch {
    // Invalid Handlebars syntax — return the partially-resolved source.
    return stage0
  }
}

/** Replace dynamic-value tokens like {{$randomUUID}}. */
function applyDynamicValues(src: string): string {
  return src.replace(/\{\{\$([a-zA-Z]+)(\([^)]*\))?\}\}/g, (full, name: string, args?: string) => {
    try {
      const argList = args
        ? args
            .slice(1, -1)
            .split(',')
            .map((a) => a.trim())
        : []
      switch (name) {
        case 'timestamp':
          return String(Math.floor(Date.now() / 1000))
        case 'isoTimestamp':
          return new Date().toISOString()
        case 'randomUUID':
          return cryptoUUID()
        case 'randomInt': {
          const min = argList.length >= 1 ? Number(argList[0]) : 0
          const max = argList.length >= 2 ? Number(argList[1]) : 1000
          return String(Math.floor(Math.random() * (max - min + 1)) + min)
        }
        case 'randomEmail':
          return `user${Math.floor(Math.random() * 100000)}@example.com`
        case 'randomString': {
          const n = argList.length >= 1 ? Number(argList[0]) : 8
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
          let out = ''
          for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
          return out
        }
      }
    } catch {
      return full
    }
    return full
  })
}

function cryptoUUID(): string {
  // Use Node's crypto.randomUUID via dynamic require so this module also
  // works in the renderer (jsdom) test env where it's exposed on globalThis.
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // Fallback: very simple v4 generator
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += hex[(Math.random() * 4) | 8]
    else s += hex[(Math.random() * 16) | 0]
  }
  return s
}
