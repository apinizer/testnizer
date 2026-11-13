/**
 * `pickProjectFile` — which `.json` in a git checkout belongs to THIS project.
 * `readdir()[0]` used to win, so a repo holding two projects imported the
 * wrong one (and Push then deleted the other's file).
 */
import { describe, it, expect } from 'vitest'
import { pickProjectFile } from '../../src/main/lib/project-file'
import { GitCodedError, GIT_ERROR_TEXT } from '../../src/shared/git-errors'

describe('pickProjectFile', () => {
  it('prefers the slug the project would be written as', () => {
    expect(pickProjectFile(['Billing.json', 'Acme-APIs.json'], 'Acme APIs')).toBe('Acme-APIs.json')
  })
  it('accepts a lone file whatever its name (renamed project, hand-made repo)', () => {
    expect(pickProjectFile(['whatever.json'], 'Acme APIs')).toBe('whatever.json')
  })
  it('refuses to guess between several non-matching files', () => {
    const codeOf = (fn: () => unknown): unknown => {
      try {
        fn()
      } catch (e) {
        expect(e).toBeInstanceOf(GitCodedError)
        return e
      }
      return undefined
    }
    expect(codeOf(() => pickProjectFile(['a.json', 'b.json'], 'Acme APIs'))).toMatchObject({
      code: 'GIT_PROJECT_FILE_AMBIGUOUS',
      params: { files: 'a.json, b.json', name: 'Acme-APIs.json' },
    })
    expect(codeOf(() => pickProjectFile([], 'x'))).toMatchObject({
      code: 'GIT_PROJECT_FILE_MISSING',
      message: GIT_ERROR_TEXT.GIT_PROJECT_FILE_MISSING,
    })
  })
})
