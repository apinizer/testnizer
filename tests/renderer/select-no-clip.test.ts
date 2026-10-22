/**
 * Native <select> text must not be clipped (Mock MCP "Protocol version pin",
 * MCP transport picker).
 *
 * Chromium centres a select's text only while the line box fits the content
 * box; otherwise it pins the text to the top and clips the bottom. The old
 * global `padding: 5px 10px` left an `h-8` select (2rem = 2 x --font-size-base
 * = 26px at the default 13px) a 14px content box for a 19.5px line box.
 *
 * Since issue #245 the global select rule lives in `@layer base`, so Tailwind
 * utilities on a select take effect (`text-*`, `py-*`, `h-*`, `rounded-*`,
 * `bg-*`). That moves the clipping risk from globals.css into the TSX: a select
 * with a FIXED height (`h-7`, `h-[30px]`, inline `height`) plus vertical
 * padding is the shape that clips. An auto-height select with `py-*` just
 * grows, like the input next to it.
 *
 * jsdom does no layout, so this pins the invariants instead:
 *  1. CSS: no global rule gives a select vertical padding, the base select
 *     floor is 2rem (= `h-8`) and the chevron keeps 26px on the right.
 *  2. TSX: no <select> combines a fixed height with vertical padding, and none
 *     lowers the 2rem floor with `min-h-*`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import postcss, { type AtRule, type Container, type Rule } from 'postcss'

const GLOBALS = resolve(__dirname, '../../src/renderer/styles/globals.css')
const RENDERER = resolve(__dirname, '../../src/renderer')

// ───────────────────────────────────────────────────────────── CSS half ──

const cssRoot = postcss.parse(readFileSync(GLOBALS, 'utf8'))

function layerOf(rule: Rule): string | null {
  let cur: Container | undefined = rule.parent as Container | undefined
  while (cur) {
    if (cur.type === 'atrule' && (cur as AtRule).name === 'layer') return (cur as AtRule).params
    cur = cur.parent as Container | undefined
  }
  return null
}

const targetsSelect = (sel: string) => /(^|[\s>+~])select(?![-\w])/.test(sel)

function declsOf(rule: Rule): Map<string, string> {
  const m = new Map<string, string>()
  rule.walkDecls((d) => {
    m.set(d.prop, d.value)
  })
  return m
}

/** The rule whose whole selector is `select` in the given layer (null = unlayered). */
function selectRule(layer: string | null): Map<string, string> | undefined {
  let found: Map<string, string> | undefined
  cssRoot.walkRules((rule) => {
    if (
      rule.selectors.length === 1 &&
      rule.selectors[0].trim() === 'select' &&
      layerOf(rule) === layer
    ) {
      found = declsOf(rule)
    }
  })
  return found
}

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
  it('has a base-layer `select` rule (utilities on a select win, issue #245)', () => {
    expect(selectRule('base')).toBeDefined()
  })

  it('no global rule gives a select vertical padding', () => {
    cssRoot.walkRules((rule) => {
      if (!rule.selectors.some(targetsSelect)) return
      for (const v of verticalPadding(declsOf(rule))) {
        expect(v, `${rule.selector} sets vertical padding ${v}`).toMatch(/^0(px|rem|em)?$/)
      }
    })
  })

  it('floors select height at 2rem, the `h-8` control height', () => {
    expect(selectRule('base')?.get('min-height')).toBe('2rem')
  })

  it('keeps room on the right for the chevron, even against `px-*`', () => {
    const base = selectRule('base')
    expect(base?.get('appearance')).toBe('none')
    expect((base?.get('padding') ?? '').split(/\s+/)[1]).toBe('26px')
    // Tailwind v4 `px-2` is `padding-inline: 8px`; the unlayered physical
    // end padding beats it, so long option text never runs under the arrow.
    expect(selectRule(null)?.get('padding-right')).toBe('26px')
  })
})

// ───────────────────────────────────────────────────────────── TSX half ──

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** Value of `const NAME = '…'` in `file`, following one named import if needed. */
function resolveConst(file: string, name: string, src = readFileSync(file, 'utf8')): string | null {
  const def = new RegExp(`const ${name}\\s*(?::[^=]+)?=\\s*(['"\`])([\\s\\S]*?)\\1`).exec(src)
  if (def) return def[2]
  const imp = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(src)
  if (!imp) return null
  for (const ext of ['.tsx', '.ts']) {
    const p = resolve(dirname(file), imp[1] + ext)
    if (existsSync(p)) return resolveConst(p, name)
  }
  return null
}

/** Index of the `>` closing a JSX opening tag that starts at `start`. */
function openingTagEnd(src: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (depth === 0 && (c === '"' || c === "'")) quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return src.length
}

/** The `className=…` expression of an opening tag (`"…"` or `{…}`), or ''. */
function classNameExpr(open: string): string {
  const m = /className=(\{|")/.exec(open)
  if (!m) return ''
  const from = m.index + 'className='.length
  if (m[1] === '"') return open.slice(from, open.indexOf('"', from + 1) + 1)
  let depth = 0
  for (let j = from; j < open.length; j++) {
    if (open[j] === '{') depth++
    else if (open[j] === '}' && --depth === 0) return open.slice(from, j + 1)
  }
  return open.slice(from)
}

interface SelectFinding {
  where: string
  problem: string
}

/**
 * Every class token a select can carry: all string literals in its className
 * expression (both branches of a ternary) plus UPPER_CASE class constants,
 * resolved in the file or through its import.
 */
function scanSelects(file: string, src: string): { count: number; findings: SelectFinding[] } {
  const findings: SelectFinding[] = []
  let count = 0
  for (const m of src.matchAll(/<select(?=[\s>])/g)) {
    count++
    const open = src.slice(m.index, openingTagEnd(src, m.index + 7) + 1)
    const where = `${relative(RENDERER, file)}:${src.slice(0, m.index).split('\n').length}`
    const expr = classNameExpr(open)
    // Template literal text (interpolations blanked) + every quoted string,
    // including the ones inside `${cond ? 'h-7' : 'h-8'}`.
    const parts = [
      ...[...expr.matchAll(/`([^`]*)`/g)].map((x) => x[1].replace(/\$\{[^}]*\}/g, ' ')),
      ...[...expr.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]),
    ]
    for (const id of new Set([...expr.matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)].map((x) => x[1]))) {
      const v = resolveConst(file, id, src)
      if (v === null) findings.push({ where, problem: `cannot resolve class constant ${id}` })
      else parts.push(v)
    }
    // Only unconditional tokens matter for the resting layout (variants skip).
    const toks = parts
      .join(' ')
      .split(/\s+/)
      .filter((t) => t && !t.includes(':'))
    const style = /style=\{\{([\s\S]*?)\}\}/.exec(open)?.[1] ?? ''

    const fixedHeight =
      toks.find((t) => /^h-(\d|\[)/.test(t)) ??
      (/\bheight\s*:/.test(style) ? 'inline height' : null)
    const vPad =
      toks.find((t) => /^(p|py|pt|pb)-/.test(t) && !/^(p|py|pt|pb)-0$/.test(t)) ??
      (/\bpadding(Top|Bottom|Block)?\s*:\s*['"]?(?!0['"\s,])/.test(style) ? 'inline padding' : null)
    if (fixedHeight && vPad) {
      findings.push({
        where,
        problem: `fixed height (${fixedHeight}) + vertical padding (${vPad}) clips the text`,
      })
    }
    const minH = toks.find((t) => /^min-h-/.test(t))
    if (minH) findings.push({ where, problem: `${minH} lowers the 2rem select floor` })
  }
  return { count, findings }
}

describe('no <select> in the renderer combines a fixed height with vertical padding (issue #245)', () => {
  it('scans every select and finds none', () => {
    let total = 0
    const all: SelectFinding[] = []
    for (const f of tsxFiles(RENDERER)) {
      const { count, findings } = scanSelects(f, readFileSync(f, 'utf8'))
      total += count
      all.push(...findings)
    }
    // Sanity: the scan really walks the renderer (85 selects when written).
    expect(total).toBeGreaterThan(60)
    expect(all).toEqual([])
  })

  it('the scanner catches the clipping shapes', () => {
    const file = join(RENDERER, 'components/__fake__.tsx')
    const src = `
      const SEL = 'h-7 w-full rounded px-2 py-1'
      export function A() {
        return (
          <>
            <select className="h-8 py-1" />
            <select className={SEL} />
            <select className={\`\${x ? 'h-[30px]' : 'h-[30px]'} pt-1\`} />
            <select style={{ height: 28, padding: '4px 8px' }} />
            <select className="min-h-0" />
            <select className="h-8 px-2 text-[12px]" />
            <select className="px-2 py-1 text-xs" />
          </>
        )
      }`
    const { count, findings } = scanSelects(file, src)
    expect(count).toBe(7)
    expect(findings.map((f) => f.where.split(':')[1])).toEqual(['6', '7', '8', '9', '10'])
  })
})
