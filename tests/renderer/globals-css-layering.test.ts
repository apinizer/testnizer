/**
 * Issue #223: Tailwind text-size and font-mono classes must take effect.
 *
 * Tailwind v4 emits its utilities inside `@layer utilities`. In the CSS
 * cascade an UNLAYERED declaration beats every layered one, whatever the
 * specificity. globals.css used to carry an unlayered
 * `*, *::before, *::after { font-family: inherit; font-size: inherit }` reset
 * (plus a `button, input, …, th { font-size: inherit }` list and a bare
 * `button { font-family: inherit }`), so every `text-[11px]`, `text-xs` and
 * `font-mono` class in the renderer silently did nothing (measured: 1554 of
 * 1580 sized elements and 495 of 520 font-mono elements rendered wrong).
 *
 * jsdom does not run the cascade, so this pins the source invariant instead:
 * no rule outside an `@layer` may set font-size / font-family on `*` or on a
 * bare element selector. The few allowed exceptions are listed below with
 * their reason.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Container, type Rule } from 'postcss'

const GLOBALS = resolve(__dirname, '../../src/renderer/styles/globals.css')

/**
 * Bare-element selectors that may set a font property outside a layer.
 *  - html / body: the root font itself (everything else inherits from it).
 *  - code / pre: always monospace (`font-family: var(--font-mono) !important`).
 *  - select: the unlayered select rule pins font-size together with its
 *    height / padding so the selected option is never clipped
 *    (tests/renderer/select-no-clip.test.ts). Known leftover: `text-*` on a
 *    <select> is still dead.
 */
const ALLOWED = new Set(['html', 'body', 'code', 'pre', 'select'])

const FONT_PROPS = new Set(['font-size', 'font-family', 'font'])

function inLayer(node: Rule): boolean {
  let cur: Container | undefined = node.parent as Container | undefined
  while (cur) {
    if (cur.type === 'atrule' && (cur as AtRule).name === 'layer') return true
    cur = cur.parent as Container | undefined
  }
  return false
}

/** `*`, `*::before`, `button`, `input:focus`, `p::first-line` — no class, id, attribute or combinator. */
function isUniversalOrBareElement(selector: string): boolean {
  return /^(\*|[a-z][a-z0-9-]*)(::?[a-z-]+(\([^)]*\))?)*$/i.test(selector.trim())
}

function unlayeredFontRules(css: string): string[] {
  const root = postcss.parse(css)
  const out: string[] = []
  root.walkRules((rule) => {
    if (inLayer(rule)) return
    // keyframe stops (`from`, `to`, `50%`) are not element selectors
    if (rule.parent?.type === 'atrule' && /keyframes$/.test((rule.parent as AtRule).name)) return
    const props: string[] = []
    rule.walkDecls((d) => {
      if (FONT_PROPS.has(d.prop)) props.push(d.prop)
    })
    if (!props.length) return
    for (const sel of rule.selectors) {
      const s = sel.trim()
      if (!isUniversalOrBareElement(s)) continue
      if (ALLOWED.has(s)) continue
      out.push(`${s} { ${props.join(', ')} }`)
    }
  })
  return out
}

describe('globals.css font rules do not override Tailwind utilities (issue #223)', () => {
  const css = readFileSync(GLOBALS, 'utf8')

  it('no unlayered rule sets font-size / font-family on * or a bare element', () => {
    expect(unlayeredFontRules(css)).toEqual([])
  })

  it('the detector catches the pre-#223 reset', () => {
    const old = `
      *, *::before, *::after { font-family: inherit; font-size: inherit; }
      button, input, select, textarea, label, a, span, div, p, li, td, th { font-size: inherit; }
      button { font-family: inherit; }
      code, pre, .mono, [data-mono] { font-family: var(--font-mono) !important; }
    `
    const hits = unlayeredFontRules(old)
    expect(hits).toContain('* { font-family, font-size }')
    expect(hits).toContain('*::before { font-family, font-size }')
    expect(hits).toContain('span { font-size }')
    expect(hits).toContain('button { font-family }')
    // allowed / not bare: the mono rule and the select entry of the list
    expect(hits.some((h) => h.startsWith('select'))).toBe(false)
    expect(hits.some((h) => h.startsWith('.mono') || h.startsWith('code'))).toBe(false)
  })

  it('keeps the inheritance reset, inside @layer base', () => {
    const root = postcss.parse(css)
    let found = false
    root.walkRules((rule) => {
      if (!rule.selectors.map((s) => s.trim()).includes('*')) return
      const decls = new Set<string>()
      rule.walkDecls((d) => {
        decls.add(d.prop)
      })
      if (!decls.has('font-size') || !decls.has('font-family')) return
      const parent = rule.parent as AtRule | undefined
      expect(parent?.type).toBe('atrule')
      expect(parent?.name).toBe('layer')
      expect(parent?.params).toBe('base')
      found = true
    })
    expect(found).toBe(true)
  })

  it('maps the named text sizes to --font-size-base (text-xs is not 0.75rem = 9.75px)', () => {
    const root = postcss.parse(css)
    const theme = new Map<string, string>()
    root.walkAtRules('theme', (at) => {
      at.walkDecls((d) => {
        theme.set(d.prop, d.value)
      })
    })
    for (const name of ['xs', 'sm', 'base', 'lg', 'xl']) {
      expect(theme.get(`--text-${name}`), `--text-${name}`).toMatch(/var\(--font-size-base\)/)
      expect(theme.has(`--text-${name}--line-height`), `--text-${name}--line-height`).toBe(true)
    }
  })

  it('font-mono resolves to the app mono stack (unlayered --font-mono beats the theme default)', () => {
    const root = postcss.parse(css)
    let mono: string | undefined
    root.walkRules(':root', (rule) => {
      if (inLayer(rule)) return
      rule.walkDecls('--font-mono', (d) => {
        mono = d.value
      })
    })
    expect(mono).toMatch(/monospace\s*$/)
  })
})
