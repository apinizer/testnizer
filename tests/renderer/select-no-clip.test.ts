/**
 * Native <select> text must not be clipped (Mock MCP "Protocol version pin",
 * MCP transport picker).
 *
 * globals.css styles `select` with an UNLAYERED rule, which beats every
 * Tailwind utility (they live in `@layer utilities`), so `py-0`/`text-[12px]`
 * on a select do nothing; of the `h-*` utilities only `h-8` and up take effect
 * (smaller ones are floored to 2rem by the select min-height). Chromium centres a select's
 * text only while the line box fits the content box; otherwise it pins the text
 * to the top and clips the bottom. The old `padding: 5px 10px` left an `h-8`
 * select (2rem = 2 x --font-size-base = 26px at the default 13px) a 14px
 * content box for a 19.5px line box.
 *
 * jsdom does no layout, so this pins the CSS invariant instead: no global rule
 * gives a select vertical padding, and the select floor is 2rem (= `h-8`).
 * Source-text check: it sees plain compound selectors (`select`, `select:focus`,
 * `div > select`), not a `select` nested inside `:is()`/`:where()`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../src/renderer/styles/globals.css'), 'utf8')
  // Comments mention `padding: 5px 10px`; they are not declarations.
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Innermost `selector { declarations }` blocks (works through @media nesting). */
function rules(): Array<{ selectors: string[]; decls: Map<string, string> }> {
  const out: Array<{ selectors: string[]; decls: Map<string, string> }> = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const decls = new Map<string, string>()
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim())
    }
    out.push({ selectors, decls })
  }
  return out
}

const targetsSelect = (sel: string) => /(^|[\s>+~])select(?![-\w])/.test(sel)

/** The block whose whole selector is `select` (not the shared font-size reset). */
const baseSelectRule = () =>
  rules().find((r) => r.selectors.length === 1 && r.selectors[0] === 'select')

/** Vertical padding values a block sets, as written. */
function verticalPadding(decls: Map<string, string>): string[] {
  const vals: string[] = []
  const shorthand = decls.get('padding')
  if (shorthand !== undefined) {
    const parts = shorthand.split(/\s+/)
    vals.push(parts[0], parts[2] ?? parts[0])
  }
  for (const k of ['padding-top', 'padding-bottom', 'padding-block']) {
    const v = decls.get(k)
    if (v !== undefined) vals.push(...v.split(/\s+/))
  }
  return vals
}

describe('global select styling cannot clip the selected option', () => {
  it('has a base `select` rule', () => {
    expect(baseSelectRule()).toBeDefined()
  })

  it('no unlayered rule gives a select vertical padding', () => {
    for (const r of rules()) {
      if (!r.selectors.some(targetsSelect)) continue
      for (const v of verticalPadding(r.decls)) {
        expect(v, `${r.selectors.join(', ')} sets vertical padding ${v}`).toMatch(/^0(px|rem|em)?$/)
      }
    }
  })

  it('floors select height at 2rem, the `h-8` control height', () => {
    const base = baseSelectRule()
    expect(base?.decls.get('min-height')).toBe('2rem')
  })

  it('keeps room on the right for the chevron', () => {
    const base = baseSelectRule()
    const shorthandRight = (base?.decls.get('padding') ?? '').split(/\s+/)[1]
    expect(base?.decls.get('padding-right') ?? shorthandRight).toBe('26px')
    expect(base?.decls.get('appearance')).toBe('none')
  })
})
