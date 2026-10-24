/**
 * Issue #280 — the generated snippets PARSE, for the languages a checker is
 * available offline: JavaScript / Node (in-process, wrapped in an async
 * function so top-level `await` is legal), Python (`ast.parse`), Ruby
 * (`RubyVM::InstructionSequence.compile`) and bash (`bash -n`). A missing
 * interpreter skips its block — CI images differ.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../../../../src/shared/codegen'
import { generateSnippet } from '../../../../src/renderer/lib/code-generator'
import { BASELINE_CASES, EXTRA_CASES } from '../../../fixtures/codegen-cases'

const CASES = [...BASELINE_CASES, ...EXTRA_CASES]
const OPTION_SETS = [
  {},
  {
    asyncAwait: false,
    followRedirect: false,
    requestTimeout: 1500,
    includeBoilerplate: true,
    indentType: 'tab',
  },
]

function snippets(language: string): Array<{ label: string; code: string }> {
  const out: Array<{ label: string; code: string }> = []
  for (const v of ALL_VARIANTS.filter((x) => x.language === language)) {
    for (const c of CASES) {
      for (const [i, variantOptions] of OPTION_SETS.entries()) {
        out.push({
          label: `${v.id} × ${c.name} #${i}`,
          code: generateSnippet(v.id, c.req, { ...c.options, variantOptions }),
        })
      }
    }
  }
  return out
}

function has(bin: string, args: string[]): boolean {
  return spawnSync(bin, args, { stdio: 'ignore' }).status === 0
}

const dir = mkdtempSync(join(tmpdir(), 'tn-codegen-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('generated code parses', () => {
  it('JavaScript and NodeJS variants', () => {
    const all = [...snippets('javascript'), ...snippets('nodejs')]
    expect(all.length).toBeGreaterThan(0)
    for (const s of all) {
      expect(() => new Function(`return (async () => {\n${s.code}\n})`), s.label).not.toThrow()
    }
  })

  it.skipIf(!has('python3', ['--version']))('Python variants (ast.parse)', () => {
    const file = join(dir, 'py.json')
    writeFileSync(file, JSON.stringify(snippets('python')))
    const script =
      'import ast, json, sys\n' +
      'bad = []\n' +
      'for s in json.load(open(sys.argv[1])):\n' +
      '    try:\n        ast.parse(s["code"])\n' +
      '    except SyntaxError as e:\n        bad.append(s["label"] + ": " + str(e))\n' +
      'print("\\n".join(bad))\n'
    const out = execFileSync('python3', ['-I', '-c', script, file], { encoding: 'utf8' })
    expect(out.trim()).toBe('')
  })

  it.skipIf(!has('ruby', ['--version']))('Ruby variant (InstructionSequence.compile)', () => {
    const file = join(dir, 'rb.json')
    writeFileSync(file, JSON.stringify(snippets('ruby')))
    const script =
      'require "json"; bad = []; JSON.parse(File.read(ARGV[0])).each { |s| ' +
      'begin; RubyVM::InstructionSequence.compile(s["code"]); rescue SyntaxError => e; bad << s["label"] + ": " + e.message; end }; ' +
      'puts bad.join("\\n")'
    const out = execFileSync('ruby', ['-e', script, file], { encoding: 'utf8' })
    expect(out.trim()).toBe('')
  })

  it.skipIf(!has('bash', ['--version']))('bash cURL, wget and HTTPie (bash -n)', () => {
    const shell = [
      ...snippets('shell'),
      ...snippets('curl').filter((s) => s.label.startsWith('curl ×')),
    ]
    for (const s of shell) {
      const file = join(dir, 'snippet.sh')
      writeFileSync(file, `${s.code}\n`)
      const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' })
      expect(r.status, `${s.label}\n${r.stderr}`).toBe(0)
    }
  })
})
