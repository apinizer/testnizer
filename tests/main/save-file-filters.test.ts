/**
 * `export:saveFile` dialog filters follow the suggested file name.
 *
 * The handler used to pass a fixed `[JSON, YAML, All Files]` list for every
 * caller. On macOS the first filter wins, so "Save HTML report…" (MCP Security
 * Scan, issue #142) suggested `mcp-security-<host>-<stamp>.html` and the
 * dialog saved it as `.json`. These tests pin the per-extension mapping, that
 * "All Files" is always last, and the bare-name extension append.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ensureDefaultExtension,
  saveFileFiltersFor,
  type SaveFileFilter,
} from '../../src/main/lib/save-file-filters'

const names = (filters: SaveFileFilter[]): string[] => filters.map((f) => f.name)
const ALL_FILES: SaveFileFilter = { name: 'All Files', extensions: ['*'] }

describe('saveFileFiltersFor', () => {
  it('puts HTML first for an .html report name (the reported bug)', () => {
    const filters = saveFileFiltersFor('mcp-security-localhost-20261008-1412.html')
    expect(filters).toEqual([{ name: 'HTML', extensions: ['html', 'htm'] }, ALL_FILES])
  })

  it('treats .htm and upper-case extensions the same as .html', () => {
    expect(names(saveFileFiltersFor('report.htm'))).toEqual(['HTML', 'All Files'])
    expect(names(saveFileFiltersFor('REPORT.HTML'))).toEqual(['HTML', 'All Files'])
  })

  it('keeps the historical JSON-first list for .json names', () => {
    const expected = [
      { name: 'JSON', extensions: ['json'] },
      { name: 'YAML', extensions: ['yaml', 'yml'] },
      ALL_FILES,
    ]
    expect(saveFileFiltersFor('openapi.json')).toEqual(expected)
    // EnvironmentModal's double-dotted name resolves on the last extension.
    expect(saveFileFiltersFor('dev.testnizer_environment.json')).toEqual(expected)
  })

  it('puts YAML first for .yaml / .yml names', () => {
    expect(names(saveFileFiltersFor('openapi.yaml'))).toEqual(['YAML', 'JSON', 'All Files'])
    expect(names(saveFileFiltersFor('openapi.yml'))).toEqual(['YAML', 'JSON', 'All Files'])
  })

  it('gives csv / xml / txt / md a single matching filter first', () => {
    expect(saveFileFiltersFor('results.csv')).toEqual([
      { name: 'CSV', extensions: ['csv'] },
      ALL_FILES,
    ])
    expect(saveFileFiltersFor('envelope.xml')).toEqual([
      { name: 'XML', extensions: ['xml'] },
      ALL_FILES,
    ])
    expect(saveFileFiltersFor('notes.txt')).toEqual([
      { name: 'Text', extensions: ['txt'] },
      ALL_FILES,
    ])
    expect(saveFileFiltersFor('README.md')).toEqual([
      { name: 'Markdown', extensions: ['md'] },
      ALL_FILES,
    ])
  })

  it('falls back to the historical list for unknown or missing extensions', () => {
    const fallback = ['JSON', 'YAML', 'All Files']
    expect(names(saveFileFiltersFor('dump.bin'))).toEqual(fallback)
    expect(names(saveFileFiltersFor('report'))).toEqual(fallback)
    expect(names(saveFileFiltersFor('.env'))).toEqual(fallback)
    expect(names(saveFileFiltersFor(''))).toEqual(fallback)
    // Prototype keys are not extensions.
    expect(names(saveFileFiltersFor('x.constructor'))).toEqual(fallback)
    expect(names(saveFileFiltersFor('x.__proto__'))).toEqual(fallback)
  })

  it('always ends with "All Files"', () => {
    for (const name of [
      'a.html',
      'a.htm',
      'a.json',
      'a.yaml',
      'a.yml',
      'a.csv',
      'a.xml',
      'a.txt',
      'a.md',
      'a.bin',
      'a',
    ]) {
      const filters = saveFileFiltersFor(name)
      expect(filters.at(-1)).toEqual(ALL_FILES)
      expect(filters.filter((f) => f.name === 'All Files')).toHaveLength(1)
    }
  })

  it('returns a fresh list each call (callers may mutate it)', () => {
    const first = saveFileFiltersFor('a.html')
    first[0].extensions.push('xhtml')
    first.pop()
    expect(saveFileFiltersFor('a.html')).toEqual([
      { name: 'HTML', extensions: ['html', 'htm'] },
      ALL_FILES,
    ])
  })
})

describe('ensureDefaultExtension', () => {
  it('appends the suggested extension to a bare name', () => {
    expect(ensureDefaultExtension('/home/u/report', 'mcp-security-x.html')).toBe(
      '/home/u/report.html',
    )
  })

  it('does not double the dot for a trailing-dot name', () => {
    expect(ensureDefaultExtension('/home/u/report.', 'a.html')).toBe('/home/u/report.html')
  })

  it('leaves a path that already has an extension alone, even a different one', () => {
    expect(ensureDefaultExtension('/home/u/report.html', 'a.html')).toBe('/home/u/report.html')
    expect(ensureDefaultExtension('/home/u/report.txt', 'a.html')).toBe('/home/u/report.txt')
  })

  it('leaves the path alone when the suggested name has no extension', () => {
    expect(ensureDefaultExtension('/home/u/report', 'report')).toBe('/home/u/report')
    expect(ensureDefaultExtension('/home/u/report', '')).toBe('/home/u/report')
  })

  it('looks at the file name only, not dotted directories', () => {
    expect(ensureDefaultExtension('/Users/x/My.Folder/report', 'a.json')).toBe(
      '/Users/x/My.Folder/report.json',
    )
  })

  it('uses the last extension of a double-dotted suggested name', () => {
    expect(ensureDefaultExtension('/home/u/dev', 'dev.testnizer_environment.json')).toBe(
      '/home/u/dev.json',
    )
  })
})

describe('export:saveFile wiring', () => {
  const handler = readFileSync(
    resolve(__dirname, '../../src/main/ipc/import-export.handler.ts'),
    'utf-8',
  )

  it('derives the dialog filters from the suggested name, not a fixed list', () => {
    expect(handler).toMatch(/filters:\s*saveFileFiltersFor\(defaultName\)/)
    expect(handler).toMatch(/ensureDefaultExtension\(result\.filePath,\s*defaultName\)/)
  })
})
