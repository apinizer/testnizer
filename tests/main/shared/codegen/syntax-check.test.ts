/**
 * Issue #280 — the generated snippets PARSE, for the languages a checker is
 * available offline: JavaScript / Node (in-process, wrapped in an async
 * function so top-level `await` is legal), Python (`ast.parse`), Ruby
 * (`RubyVM::InstructionSequence.compile`), PHP (`php -l`), R (`parse`), Dart
 * (`dart format`) and bash (`bash -n`). A missing interpreter skips its
 * block — CI images differ.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

/** Write each snippet to its own file under `dir/<sub>`; file path → label. */
function writeAll(
  sub: string,
  ext: string,
  list: Array<{ label: string; code: string }>,
): Map<string, string> {
  mkdirSync(join(dir, sub), { recursive: true })
  const files = new Map<string, string>()
  list.forEach((s, i) => {
    const file = join(dir, sub, `snippet-${i}.${ext}`)
    writeFileSync(file, `${s.code}\n`)
    files.set(file, s.label)
  })
  expect(files.size).toBeGreaterThan(0)
  return files
}

/** Checker output lines (`<file>\t<message>`) → `<label>: <message>`. */
function failures(out: string, files: Map<string, string>): string[] {
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [file, ...msg] = l.split('\t')
      return `${files.get(file) ?? file}: ${msg.join('\t')}`
    })
}

/** A deliberately broken file each batch checker must flag (proves it really checks). */
const CANARY = 'canary (deliberately broken)'

/** Failures other than the canary; fails the test when the checker missed the canary. */
function realFailures(out: string, files: Map<string, string>): string[] {
  const all = failures(out, files)
  expect(
    all.some((l) => l.startsWith(`${CANARY}:`)),
    'checker missed the canary',
  ).toBe(true)
  return all.filter((l) => !l.startsWith(`${CANARY}:`))
}

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

  // One checker process per language over a directory of files: spawning the
  // interpreter per snippet (~170 PHP, ~80 Dart) would blow the test timeout.
  it.skipIf(!has('php', ['--version']))(
    'PHP variants (token_get_all TOKEN_PARSE — php -l without running anything)',
    () => {
      const files = writeAll('php', 'php', [
        ...snippets('php'),
        { label: CANARY, code: '<?php\n$a = ;' },
      ])
      const script =
        'foreach (array_slice($argv, 1) as $f) { try { token_get_all(file_get_contents($f), TOKEN_PARSE); } ' +
        'catch (ParseError $e) { echo $f, "\\t", $e->getMessage(), " line ", $e->getLine(), "\\n"; } }'
      // No `-n`: distro PHP loads the tokenizer extension from its ini files.
      const out = execFileSync('php', ['-r', script, ...files.keys()], { encoding: 'utf8' })
      expect(realFailures(out, files)).toEqual([])
    },
    60_000,
  )

  it.skipIf(!has('Rscript', ['--version']))(
    'R variants (parse)',
    () => {
      const files = writeAll('r', 'R', [...snippets('r'), { label: CANARY, code: 'x <- c(1,' }])
      const script =
        'for (f in commandArgs(TRUE)) ' +
        'tryCatch(parse(file = f), error = function(e) cat(f, "\\t", gsub("\\n", " ", conditionMessage(e)), "\\n", sep = ""))'
      const out = execFileSync('Rscript', ['--vanilla', '-e', script, ...files.keys()], {
        encoding: 'utf8',
      })
      expect(realFailures(out, files)).toEqual([])
    },
    60_000,
  )

  // `dart format` only parses (no `pub get` needed, unlike `dart analyze`);
  // it exits non-zero on a syntax error, never on a formatting difference.
  it.skipIf(!has('dart', ['--version']))(
    'Dart variants (dart format)',
    () => {
      const files = writeAll('dart', 'dart', snippets('dart'))
      const r = spawnSync('dart', ['format', '--output=none', ...files.keys()], {
        encoding: 'utf8',
      })
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
      const [canary] = writeAll('dart-canary', 'dart', [
        { label: CANARY, code: 'void main() { var x = ; }' },
      ]).keys()
      const c = spawnSync('dart', ['format', '--output=none', canary], { encoding: 'utf8' })
      expect(c.status, 'dart format missed the canary').not.toBe(0)
    },
    120_000,
  )

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
