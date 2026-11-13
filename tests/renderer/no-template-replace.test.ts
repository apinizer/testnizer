/**
 * Guard: UI text placeholders are filled by `fillTemplate` only.
 *
 * `t('toast.duplicated').replace('{name}', name)` passes the user's text as a
 * REPLACEMENT STRING, so `$&`, `$1`, `$$`, `` $` `` and `$'` in it are
 * expanded: a project named "$&" made the Duplicate toast print the template
 * back. `t(key, values)` and `fillTemplate(text, values)`
 * (`src/shared/fill-template.ts`) insert the value verbatim, in one pass, and
 * fill every occurrence of a placeholder.
 *
 * The guard parses every `.ts` / `.tsx` under `src/` (TypeScript's parser, so
 * comments and strings that merely mention the pattern do not count) and fails
 * on any `.replace(…)` / `.replaceAll(…)` whose first argument names a single
 * template placeholder, whatever the receiver is — a `t()` call, a variable
 * holding one, a `formatCount(…)` result or a multi-line chain:
 *   - a string literal `'{name}'`,
 *   - a template literal `` `{${key}}` ``,
 *   - a regular expression `/\{name\}/g` (or `/{name}/g`).
 * `{{var}}` (variable syntax, two braces) is not a UI placeholder and is not
 * matched.
 *
 * `ALLOWED` holds the few non-UI templates (keyed `file|first argument`, never
 * by line), each with its reason. An entry that matches nothing fails too, so
 * the list cannot go stale.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(__dirname, '../..')
const SRC = join(ROOT, 'src')

const ALLOWED: Record<string, string> = {
  // RAML `baseUri: https://api.example.com/{version}` — the spec's own URI
  // template filled with the document's `version`, not interface text.
  'src/main/ipc/import-export.handler.ts|/\\{version\\}/g': 'RAML baseUri template, not UI text',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function isPlaceholderPattern(arg: ts.Expression): boolean {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return /^\{(?!\{)[^{}]+\}$/.test(arg.text)
  }
  if (ts.isTemplateExpression(arg)) {
    // `{${key}}` — a placeholder whose name is computed.
    const last = arg.templateSpans[arg.templateSpans.length - 1]
    return arg.head.text === '{' && last.literal.text === '}'
  }
  if (arg.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    return /^\/\\?\{[A-Za-z0-9_-]+\\?\}\/[a-z]*$/.test(arg.getText())
  }
  return false
}

type Hit = { file: string; line: number; arg: string; text: string }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('.replace')) continue
    const sf = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'replace' || node.expression.name.text === 'replaceAll') &&
        node.arguments.length >= 1 &&
        isPlaceholderPattern(node.arguments[0])
      ) {
        const at = sf.getLineAndCharacterOfPosition(node.getStart())
        hits.push({
          file: relative(ROOT, file).split('\\').join('/'),
          line: at.line + 1,
          arg: node.arguments[0].getText(),
          text: node.getText().replace(/\s+/g, ' ').slice(0, 120),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return hits
}

describe('UI templates are filled with fillTemplate, never String.replace', () => {
  const hits = scan()

  it("no `.replace('{x}', value)` on interface text", () => {
    const offending = hits
      .filter((h) => !(`${h.file}|${h.arg}` in ALLOWED))
      .map((h) => `${h.file}:${h.line}  ${h.text}`)
    expect(
      offending,
      `${offending.length} placeholder replace(s); use t(key, values) / fillTemplate`,
    ).toEqual([])
  })

  it('every allow-list entry still matches a call', () => {
    const seen = new Set(hits.map((h) => `${h.file}|${h.arg}`))
    expect(Object.keys(ALLOWED).filter((k) => !seen.has(k))).toEqual([])
  })
})
