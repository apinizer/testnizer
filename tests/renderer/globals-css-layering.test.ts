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
 * (`select` used to be here: its unlayered rule pinned the font size, so
 * `text-*` on a select was dead. Issue #245 moved it into `@layer base`.)
 */
const ALLOWED = new Set(['html', 'body', 'code', 'pre'])

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
    // `select` is no longer exempt (issue #245): its entry in the list is reported too
    expect(hits).toContain('select { font-size }')
    // not bare: the mono rule
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

/* ── Issue #245: form-control defaults ──
 * The same trap one level down: unlayered `input[type=text]…, textarea
 * { background; color; caret-color }` made `bg-*` / `text-[var(--x)]` dead on
 * inputs and textareas, `::placeholder { color }` made `placeholder:*` dead,
 * and the unlayered `select { font-size; padding; min-height; … }` made
 * `text-*`, `py-*`, `h-*`, `rounded-*` and `bg-*` dead on a select. */

/** `input`, `input[type='text']`, `input:not([type])`, `textarea::placeholder`, `select:hover` … */
function isFormControlSelector(selector: string): boolean {
  return /^(input|textarea|select)(\[[^\]]*\]|::?[a-z-]+(\([^)]*\))?)*$/i.test(selector.trim())
}

/** Properties a Tailwind utility sets on a control, so an unlayered default would kill it. */
const CONTROL_PROPS =
  /^(font|font-size|font-family|background|background-color|color|caret-color|padding(-(top|bottom|block|block-start|block-end|left|inline|inline-start))?|min-height|height|border|border-radius|border-width|border-style|box-shadow)$/

/**
 * Unlayered form-control rules that are allowed, with the only properties
 * they may set:
 *  - `select { padding-right }`: room for the chevron. Tailwind v4's `px-*` is
 *    `padding-inline`, which would pull the end padding to 8px and run option
 *    text under the arrow; unlayered, the physical end side wins.
 *  - `select:hover` / `select:focus { border-color }`: in the base layer every
 *    `border-[var(--x)]` utility would beat them. They set no property from
 *    CONTROL_PROPS anyway. (The `input:focus, … { box-shadow }` focus ring is
 *    NOT exempt: it moved to the base layer so `shadow-*` / `ring-*` work.)
 */
const CONTROL_ALLOWED: Record<string, readonly string[]> = {
  select: ['padding-right'],
}

function unlayeredControlRules(css: string): string[] {
  const root = postcss.parse(css)
  const out: string[] = []
  root.walkRules((rule) => {
    if (inLayer(rule)) return
    for (const sel of rule.selectors) {
      const s = sel.trim()
      if (!isFormControlSelector(s)) continue
      const bad: string[] = []
      rule.walkDecls((d) => {
        if (CONTROL_ALLOWED[s]?.includes(d.prop)) return
        if (CONTROL_PROPS.test(d.prop) || (s === 'select' && d.prop !== 'padding-right'))
          bad.push(d.prop)
      })
      if (bad.length) out.push(`${s} { ${bad.join(', ')} }`)
    }
  })
  return out
}

describe('globals.css form-control defaults do not override Tailwind utilities (issue #245)', () => {
  const css = readFileSync(GLOBALS, 'utf8')

  it('no unlayered rule sets a utility-owned property on input / textarea / select', () => {
    expect(unlayeredControlRules(css)).toEqual([])
  })

  it('the detector catches the pre-#245 rules', () => {
    const old = `
      input[type='text'], input[type='password'], input:not([type]), textarea {
        background: var(--white); color: var(--text); caret-color: var(--accent);
      }
      input::placeholder, textarea::placeholder { color: var(--placeholder); opacity: 1; }
      select {
        background: var(--white); color: var(--text); border: 1px solid var(--border);
        border-radius: 7px; padding: 0 26px 0 10px; min-height: 2rem;
        font-size: var(--font-size-base); appearance: none;
      }
      select:hover { border-color: var(--border2); }
      input:focus, textarea:focus, select:focus {
        border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-light);
      }
    `
    const hits = unlayeredControlRules(old)
    expect(hits).toContain("input[type='text'] { background, color, caret-color }")
    expect(hits).toContain('input:not([type]) { background, color, caret-color }')
    expect(hits).toContain('textarea { background, color, caret-color }')
    expect(hits).toContain('input::placeholder { color }')
    expect(hits.find((h) => h.startsWith('select {'))).toMatch(/font-size/)
    expect(hits.find((h) => h.startsWith('select {'))).toMatch(/min-height/)
    expect(hits).toContain('input:focus { box-shadow }')
    // a hover state that sets only border-color: not reported
    expect(hits.some((h) => h.startsWith('select:hover'))).toBe(false)
  })

  it('the only unlayered `select` rule sets padding-right alone (chevron room)', () => {
    const root = postcss.parse(css)
    const props: string[] = []
    root.walkRules((rule) => {
      if (inLayer(rule)) return
      if (!rule.selectors.map((s) => s.trim()).includes('select')) return
      rule.walkDecls((d) => {
        props.push(`${d.prop}: ${d.value}`)
      })
    })
    expect(props).toEqual(['padding-right: 26px'])
  })

  it('keeps the input / textarea / select defaults, inside @layer base', () => {
    const root = postcss.parse(css)
    const found = new Map<string, Set<string>>()
    root.walkRules((rule) => {
      const parent = rule.parent as AtRule | undefined
      if (parent?.type !== 'atrule' || parent.name !== 'layer' || parent.params !== 'base') return
      for (const sel of rule.selectors.map((s) => s.trim())) {
        const props = found.get(sel) ?? new Set<string>()
        rule.walkDecls((d) => {
          props.add(d.prop)
        })
        found.set(sel, props)
      }
    })
    for (const sel of ["input[type='text']", 'input:not([type])', 'textarea']) {
      expect([...(found.get(sel) ?? [])], sel).toEqual(
        expect.arrayContaining(['background', 'color', 'caret-color']),
      )
    }
    expect([...(found.get('input::placeholder') ?? [])]).toContain('color')
    expect([...(found.get('select') ?? [])]).toEqual(
      expect.arrayContaining(['font-size', 'min-height', 'padding', 'border', 'background-image']),
    )
    for (const sel of ['input:focus', 'textarea:focus', 'select:focus']) {
      expect([...(found.get(sel) ?? [])], sel).toEqual(
        expect.arrayContaining(['border-color', 'box-shadow']),
      )
    }
  })
})

/* ── Issue #245 follow-up: focus-visible radius and ::selection ──
 * `:focus-visible { border-radius: 4px }` squared every focused `rounded-*`
 * control, and `::selection { background; color }` made `selection:*` dead.
 * Both moved to the base layer. The focus OUTLINE must stay unlayered: in a
 * layer, the `outline-none` utility that hundreds of controls carry would
 * erase the keyboard focus ring (accessibility). */

/** Unlayered `:focus-visible` / `::selection` declarations, as `selector { prop }`. */
function unlayeredPseudo(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  postcss.parse(css).walkRules((rule) => {
    if (inLayer(rule)) return
    for (const sel of rule.selectors.map((x) => x.trim())) {
      if (!/^(\*)?(:focus-visible|::selection)$/.test(sel)) continue
      const props = out.get(sel) ?? []
      rule.walkDecls((d) => {
        props.push(d.prop)
      })
      out.set(sel, props)
    }
  })
  return out
}

/** The only properties an unlayered `:focus-visible` may set. */
const FOCUS_VISIBLE_UNLAYERED = ['outline', 'outline-offset']

function pseudoViolations(css: string): string[] {
  const bad: string[] = []
  for (const [sel, props] of unlayeredPseudo(css)) {
    const allowed = sel.endsWith(':focus-visible') ? FOCUS_VISIBLE_UNLAYERED : []
    const extra = props.filter((p) => !allowed.includes(p))
    if (extra.length) bad.push(`${sel} { ${extra.join(', ')} }`)
  }
  return bad
}

describe('globals.css focus-visible and selection rules (issue #245)', () => {
  const css = readFileSync(GLOBALS, 'utf8')

  it('no unlayered :focus-visible / ::selection rule sets a utility-owned property', () => {
    expect(pseudoViolations(css)).toEqual([])
  })

  it('the detector catches the pre-#245 rules', () => {
    const old = `
      :focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
      ::selection { background: var(--accent-light); color: var(--text); }
    `
    expect(pseudoViolations(old)).toEqual([
      ':focus-visible { border-radius }',
      '::selection { background, color }',
    ])
  })

  it('the keyboard focus outline stays unlayered, so `outline-none` cannot hide it', () => {
    const focus = unlayeredPseudo(css).get(':focus-visible')
    expect(focus).toEqual(expect.arrayContaining(FOCUS_VISIBLE_UNLAYERED))
    let outline: string | undefined
    postcss.parse(css).walkRules(':focus-visible', (rule) => {
      if (inLayer(rule)) return
      rule.walkDecls('outline', (d) => {
        outline = d.value
      })
    })
    expect(outline).toBe('2px solid var(--accent)')
  })

  it('the focus radius and the selection colours live in @layer base', () => {
    const base = new Map<string, Map<string, string>>()
    postcss.parse(css).walkRules((rule) => {
      const parent = rule.parent as AtRule | undefined
      if (parent?.type !== 'atrule' || parent.name !== 'layer' || parent.params !== 'base') return
      for (const sel of rule.selectors.map((x) => x.trim())) {
        const m = base.get(sel) ?? new Map<string, string>()
        rule.walkDecls((d) => {
          m.set(d.prop, d.value)
        })
        base.set(sel, m)
      }
    })
    expect(base.get(':focus-visible')?.get('border-radius')).toBe('4px')
    expect(base.get('::selection')?.get('background')).toBe('var(--accent-light)')
    expect(base.get('::selection')?.get('color')).toBe('var(--text)')
  })
})
