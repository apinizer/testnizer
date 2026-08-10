/**
 * One name for a project's tracked repo file (issue #78).
 *
 * Three call sites wrote it and two disagreed: `git.handler` replaced unsafe
 * characters with `-`, `save.handler` with `_`. That is worse than two files
 * side by side — `save:git` deletes every `.json` in the repo directory that is
 * not the name IT computed, so the two paths took turns deleting each other's
 * committed copy: push, then save-to-git, and the file committed a moment ago
 * is gone from the working tree.
 *
 * These tests pin the single answer, and — more importantly — that no call site
 * computes its own.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectFileSlug, projectFileName } from '../../src/main/lib/project-file'

describe('projectFileSlug', () => {
  it('keeps a plain ASCII name intact', () => {
    expect(projectFileSlug('orders-api')).toBe('orders-api')
    expect(projectFileSlug('Orders_API2')).toBe('Orders_API2')
  })

  it('replaces unsafe characters with a single convention', () => {
    // The reported case: 'sağlık' became `sa_l_k.json` in one path and
    // `sa-l-k.json` in the other.
    expect(projectFileSlug('sağlık')).toBe('sa-l-k')
    expect(projectFileSlug('my project!')).toBe('my-project-')
  })

  it('never produces an all-separator name', () => {
    // A fully non-ASCII name collapses to dashes; committing `----.json` is
    // not a useful outcome.
    expect(projectFileSlug('日本語')).toBe('project')
    expect(projectFileSlug('')).toBe('project')
    expect(projectFileSlug(undefined)).toBe('project')
    expect(projectFileSlug('   ')).toBe('project')
  })

  it('appends the extension exactly once', () => {
    expect(projectFileName('sağlık')).toBe('sa-l-k.json')
  })

  it('is stable — the same name always yields the same file', () => {
    // The pruning path only finds its own file if this never drifts.
    expect(projectFileSlug('sağlık')).toBe(projectFileSlug('sağlık'))
  })
})

describe('no handler computes the slug itself', () => {
  const files = ['src/main/ipc/save.handler.ts', 'src/main/ipc/git.handler.ts']

  it.each(files)('%s goes through the shared helper', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8')

    // The divergence came back the moment someone hand-rolled the character
    // class again, so the guard is on the pattern rather than on the outcome.
    expect(src).not.toMatch(/\[\^a-zA-Z0-9[^\]]*\]\/g/)
    expect(src).toContain('projectFileSlug')
  })
})
