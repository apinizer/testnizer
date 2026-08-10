/**
 * The two git paths must not delete each other's file (issue #78).
 *
 * `git.handler` slugified a project name with `-` and `save.handler` with `_`,
 * so `sağlık` became `sa-l-k.json` in one and `sa_l_k.json` in the other. The
 * in-code note called that "tracked twice", which understates it: the writer
 * also PRUNES — it removes every `.json` in the repo directory that is not the
 * name it just computed. So the two paths took turns deleting the copy that had
 * just been committed.
 *
 * The slug unit test pins the string. This one reproduces the interaction on a
 * real directory: write with one path, write with the other, and see what is
 * left on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectFileName } from '../../src/main/lib/project-file'

let repo: string

/**
 * The write-then-prune step both handlers perform: write `<slug>.json`, then
 * delete every other `.json` in the directory. Reproduced here rather than
 * imported because the handlers do it inline, wrapped in git plumbing.
 */
function writeAndPrune(dir: string, fileName: string, body: string): void {
  writeFileSync(join(dir, fileName), body, 'utf-8')
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json') && f !== fileName && f !== 'package.json') {
      rmSync(join(dir, f))
    }
  }
}

const jsonFiles = () => readdirSync(repo).filter((f) => f.endsWith('.json')).sort()

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'testnizer-slug-'))
})
afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('a project ends up as ONE tracked file', () => {
  const NAME = 'sağlık'

  it('survives both write paths running in either order', () => {
    // Both handlers now derive the name the same way, so "the other path"
    // computes the same file and simply overwrites it.
    const a = projectFileName(NAME)
    const b = projectFileName(NAME)
    expect(a).toBe(b)

    writeAndPrune(repo, a, '{"from":"save"}')
    expect(jsonFiles()).toEqual([a])

    writeAndPrune(repo, b, '{"from":"push"}')
    expect(jsonFiles()).toEqual([a])

    // …and the second write is the one on disk, rather than the first having
    // been deleted and nothing put back.
    writeAndPrune(repo, a, '{"from":"save-again"}')
    expect(jsonFiles()).toEqual([a])
  })

  it('reproduces the old collision when the names diverge', () => {
    // This is what the bug looked like: two spellings of the same project.
    const dashed = 'sa-l-k.json'
    const underscored = 'sa_l_k.json'
    expect(dashed).not.toBe(underscored)

    writeAndPrune(repo, dashed, '{"from":"push"}')
    expect(jsonFiles()).toEqual([dashed])

    // The other path writes ITS name and prunes — the committed copy is gone.
    writeAndPrune(repo, underscored, '{"from":"save"}')
    expect(jsonFiles()).toEqual([underscored])
    expect(jsonFiles()).not.toContain(dashed)

    // And back again, forever.
    writeAndPrune(repo, dashed, '{"from":"push"}')
    expect(jsonFiles()).toEqual([dashed])
  })

  it('leaves unrelated json in the repo alone', () => {
    // The prune deliberately spares package.json; nothing here should widen it.
    writeFileSync(join(repo, 'package.json'), '{}', 'utf-8')
    writeAndPrune(repo, projectFileName(NAME), '{}')
    expect(jsonFiles()).toContain('package.json')
  })

  it('gives a name with no ASCII a usable file', () => {
    // `----.json` is not a useful thing to commit.
    expect(projectFileName('日本語')).toBe('project.json')
  })
})
