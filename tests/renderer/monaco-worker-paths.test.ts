/**
 * Monaco worker imports must resolve through the monaco-editor `exports` map
 * (issue #288). monaco-editor 0.56 added `"./*.js": "./esm/vs/*.js"`, so the
 * old `monaco-editor/esm/vs/…` specifiers stopped resolving. Only the
 * production build noticed (typecheck and the unit tests stub the `?worker`
 * modules), so this checks every specifier in `monaco-workers.ts` with Node's
 * resolver, which applies the same `exports` rules.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const source = readFileSync(join(ROOT, 'src/renderer/monaco-workers.ts'), 'utf-8')
const specifiers = [...source.matchAll(/from '(monaco-editor\/[^'?]+)\?worker'/g)].map((m) => m[1])
const req = createRequire(join(ROOT, 'package.json'))

describe('monaco-workers.ts worker specifiers', () => {
  it('imports the five workers', () => {
    expect(specifiers).toHaveLength(5)
  })

  it.each(specifiers)('%s resolves to a file inside monaco-editor/esm', (spec) => {
    const resolved = req.resolve(spec)
    expect(existsSync(resolved)).toBe(true)
    expect(resolved.replace(/\\/g, '/')).toMatch(
      /node_modules\/monaco-editor\/esm\/vs\/.+\.worker\.js$/,
    )
  })
})
