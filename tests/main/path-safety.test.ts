import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertTmpSubpath,
  assertImportFilePath,
  GIT_TMP_PREFIXES,
} from '../../src/main/lib/path-safety'

describe('assertTmpSubpath', () => {
  it('accepts a path inside tmpdir with allowed prefix', () => {
    const ok = path.join(tmpdir(), 'testnizer-git-abc', 'sub', 'file.json')
    expect(() => assertTmpSubpath(ok, GIT_TMP_PREFIXES)).not.toThrow()
    expect(assertTmpSubpath(ok, GIT_TMP_PREFIXES)).toBe(path.resolve(ok))
  })

  it('accepts legacy apinizer prefix for migration window', () => {
    const ok = path.join(tmpdir(), 'apinizer-git-123', 'file.json')
    expect(() => assertTmpSubpath(ok, GIT_TMP_PREFIXES)).not.toThrow()
  })

  it('rejects paths outside tmpdir', () => {
    expect(() => assertTmpSubpath('/etc/passwd', GIT_TMP_PREFIXES)).toThrow(/outside system temp/)
    expect(() => assertTmpSubpath('/Users/somebody/file', GIT_TMP_PREFIXES)).toThrow(
      /outside system temp/,
    )
  })

  it('rejects tmpdir subdirs that are not in the allowlist', () => {
    const bad = path.join(tmpdir(), 'other-tool-tmp', 'file.json')
    expect(() => assertTmpSubpath(bad, GIT_TMP_PREFIXES)).toThrow(/not in an allowed/)
  })

  it('rejects path traversal via ..', () => {
    const traversal = path.join(tmpdir(), 'testnizer-git-x', '..', '..', 'etc', 'passwd')
    expect(() => assertTmpSubpath(traversal, GIT_TMP_PREFIXES)).toThrow()
  })

  it('rejects empty or non-string input', () => {
    expect(() => assertTmpSubpath('', GIT_TMP_PREFIXES)).toThrow(/empty/)
    // @ts-expect-error testing runtime guard
    expect(() => assertTmpSubpath(undefined, GIT_TMP_PREFIXES)).toThrow(/empty/)
  })

  it('rejects the tmpdir root itself (no subdirectory)', () => {
    expect(() => assertTmpSubpath(tmpdir(), GIT_TMP_PREFIXES)).toThrow()
  })
})

describe('assertImportFilePath', () => {
  it('accepts an absolute .json path under the user home', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '/Users/test'
    const ok = path.join(home, 'Documents', 'export.json')
    expect(() => assertImportFilePath(ok)).not.toThrow()
  })

  it('rejects non-json extensions', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '/Users/test'
    expect(() => assertImportFilePath(path.join(home, 'a.txt'))).toThrow(/only \.json/)
    expect(() => assertImportFilePath(path.join(home, 'a.js'))).toThrow(/only \.json/)
  })

  it('rejects system directories', () => {
    expect(() => assertImportFilePath('/etc/passwd.json')).toThrow(/system directory/)
    expect(() => assertImportFilePath('/var/log/x.json')).toThrow(/system directory/)
    expect(() => assertImportFilePath('/sys/kernel/x.json')).toThrow(/system directory/)
  })

  it('rejects empty or non-string input', () => {
    expect(() => assertImportFilePath('')).toThrow(/empty/)
    // @ts-expect-error testing runtime guard
    expect(() => assertImportFilePath(undefined)).toThrow(/empty/)
  })

  it('accepts case-insensitive .JSON extension', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '/Users/test'
    expect(() => assertImportFilePath(path.join(home, 'EXPORT.JSON'))).not.toThrow()
  })
})
