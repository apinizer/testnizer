/**
 * Templating layer for mock-server response bodies and headers.
 *
 * Three-pass render:
 *   1. Dynamic values: `{{$timestamp}}`, `{{$randomUUID}}`, `{{$randomInt}}`,
 *      `{{$randomString(n)}}` etc.
 *   2. Environment variables: `{{baseUrl}}` etc. — resolved against the
 *      project's active env + globals so mock responses pick up the same
 *      values as "Send" in the request editor.
 *   3. Handlebars: `{{#if}}`, `{{#each}}`, `{{request.path}}`, `{{state.x}}`
 *      and our small helper set (json, eq, neq, upper, lower, default).
 *
 * Steps 1 and 2 run before Handlebars sees the template — Handlebars would
 * treat `{{baseUrl}}` as a context lookup and emit empty strings otherwise.
 *
 * LLM shortcuts (issue #221): `{{lastUserMessage}}`, `{{lastToolResult}}`
 * and `{{model}}` are read from an OpenAI / Anthropic style request body
 * (`llmRequestShortcuts`) — Handlebars has no "last element" path, so
 * `request.body.messages.[-1]` cannot express them. Empty when the body has
 * no such shape, which is exactly what an unknown name rendered before.
 * Note: the env pre-pass runs first, so a project variable of the same name
 * (e.g. `model`) wins over the shortcut.
 */

import Handlebars from 'handlebars'
import { resolveVariables } from '../lib/variable-resolver'

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
  /**
   * Project env vars + globals. Pre-applied to the template before
   * Handlebars compiles it so plain `{{baseUrl}}` placeholders work the
   * same way they do in the request editor.
   */
  envVars?: Record<string, string>
  /** Text of the last user message that carries text (see `llmRequestShortcuts`). */
  lastUserMessage?: string
  /** Text of the latest tool result in the conversation. */
  lastToolResult?: string
  /** `model` of the request body. */
  model?: string
  /**
   * Per-frame values of an SSE stream (issue #221), set only while a
   * `bodyType: 'sse'` block is rendered: `{{stream.seq}}` (1-based frame
   * number on this connection), `{{stream.iteration}}` (1-based pass over the
   * list) and `{{stream.now}}` (ISO time of the render).
   */
  stream?: { seq: number; iteration: number; now: string }
}

export interface LlmRequestShortcuts {
  lastUserMessage: string
  lastToolResult: string
  model: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** A message `content`: a string, or the text parts of a part / block list. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const part of content) {
    const p = asRecord(part)
    if (p && p.type === 'text' && typeof p.text === 'string') texts.push(p.text)
  }
  return texts.join('\n')
}

/** The latest tool result carried by one message, or null when it has none. */
function toolResultOf(msg: Record<string, unknown>): string | null {
  // OpenAI chat completions: `{ role: 'tool', content }`.
  if (msg.role === 'tool') return contentText(msg.content)
  // Anthropic messages: a `tool_result` block inside a user message.
  if (msg.role === 'user' && Array.isArray(msg.content)) {
    for (let i = msg.content.length - 1; i >= 0; i--) {
      const block = asRecord(msg.content[i])
      if (block?.type === 'tool_result') return contentText(block.content)
    }
  }
  return null
}

/**
 * `lastUserMessage` / `lastToolResult` / `model` from an OpenAI chat
 * completions or Anthropic messages request body (`messages[]`, `model`).
 * A user message that only carries tool results (Anthropic's tool round
 * trip) is skipped for `lastUserMessage`, so it stays the human's text.
 * A JSON body sent without a JSON content type arrives as text and is parsed
 * here. Anything else gives empty strings.
 */
export function llmRequestShortcuts(body: unknown): LlmRequestShortcuts {
  let parsed = body
  if (typeof body === 'string' && body.trimStart().startsWith('{')) {
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }
  }
  const out: LlmRequestShortcuts = { lastUserMessage: '', lastToolResult: '', model: '' }
  const req = asRecord(parsed)
  if (!req) return out
  if (typeof req.model === 'string') out.model = req.model
  const messages = Array.isArray(req.messages) ? req.messages : []
  let userFound = false
  let toolFound = false
  for (let i = messages.length - 1; i >= 0 && !(userFound && toolFound); i--) {
    const msg = asRecord(messages[i])
    if (!msg) continue
    if (!toolFound) {
      const result = toolResultOf(msg)
      if (result !== null) {
        out.lastToolResult = result
        toolFound = true
      }
    }
    if (!userFound && msg.role === 'user') {
      const text = contentText(msg.content)
      if (text !== '') {
        out.lastUserMessage = text
        userFound = true
      }
    }
  }
  return out
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
 *
 *  Pass order: dynamic values → env vars → Handlebars. Both pre-passes
 *  happen before Handlebars compiles the template so plain `{{baseUrl}}`
 *  / `{{$randomUUID}}` placeholders aren't treated as Handlebars context
 *  lookups (which would emit empty strings). */
export function renderTemplate(source: string, ctx: TemplateContext): string {
  if (!source) return ''
  // `resolveVariables` from the shared resolver handles both `{{$dynamic}}`
  // and plain `{{varName}}` against the provided env map. If no env vars
  // were supplied, fall back to the standalone dynamic-only pass so
  // existing tests / call sites keep working.
  const stage0 = ctx.envVars ? resolveVariables(source, ctx.envVars) : applyDynamicValues(source)
  try {
    const compiled = hb.compile(stage0, { noEscape: true })
    return compiled(withCaseInsensitiveHeaders(ctx))
  } catch {
    // Invalid Handlebars syntax — return the partially-resolved source.
    return stage0
  }
}

/**
 * HTTP header names are case-insensitive (RFC 7230 §3.2), but the request
 * headers map is stored lowercased and Handlebars does an exact-key lookup —
 * so `{{request.headers.Authorization}}` / `AUTHORIZATION` resolved to empty
 * while only the lowercase form worked (issue #29). Wrap `request.headers` in
 * a case-insensitive Proxy. Handlebars' `lookupProperty` gates reads on
 * `hasOwnProperty`, so the Proxy must answer `get`, `has`, AND
 * `getOwnPropertyDescriptor` for any casing.
 */
function withCaseInsensitiveHeaders(ctx: TemplateContext): TemplateContext {
  const headers = ctx.request?.headers
  if (!headers || typeof headers !== 'object') return ctx
  const lower: Record<string, string> = {}
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k]
  const resolve = (prop: string): string | undefined =>
    prop in headers ? headers[prop] : lower[prop.toLowerCase()]
  const ciHeaders = new Proxy(headers, {
    get(target, prop) {
      if (typeof prop === 'string') {
        const v = resolve(prop)
        if (v !== undefined) return v
      }
      return Reflect.get(target, prop)
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop.toLowerCase() in lower) return true
      return Reflect.has(target, prop)
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && !(prop in target) && prop.toLowerCase() in lower) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: lower[prop.toLowerCase()],
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  })
  return { ...ctx, request: { ...ctx.request, headers: ciHeaders } }
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
