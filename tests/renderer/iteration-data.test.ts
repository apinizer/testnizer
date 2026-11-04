/**
 * The Runner's iteration data file: a user's file, in whatever shape Excel or
 * another tool wrote it. A good file gives one row per iteration with the
 * columns the user sees; a bad one gives a message, never a silent single run.
 */
import { describe, expect, it } from 'vitest'
import {
  assertIterationFileSize,
  MAX_ITERATION_FILE_BYTES,
  MAX_ITERATION_ROWS,
  parseIterationData,
} from '../../src/renderer/lib/iteration-data'

const t = (key: string): string => key

const csv = (text: string) => parseIterationData(text, 'data.csv', t)
const json = (text: string) => parseIterationData(text, 'data.json', t)

describe('CSV', () => {
  it('reads a plain comma file', () => {
    expect(csv('id,name\n1,Ada\n2,Grace\n')).toEqual([
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
    ])
  })

  it('takes the BOM of an Excel "CSV UTF-8" file off the first header', () => {
    expect(csv('\uFEFFid,name\n1,Ada\n')).toEqual([{ id: '1', name: 'Ada' }])
  })

  it('reads the semicolon file Turkish and EU Excel writes', () => {
    expect(csv('id;tutar\n1;12,50\n2;3,75\n')).toEqual([
      { id: '1', tutar: '12,50' },
      { id: '2', tutar: '3,75' },
    ])
  })

  it('reads a tab-separated file', () => {
    expect(csv('id\tname\n1\tAda\n')).toEqual([{ id: '1', name: 'Ada' }])
  })

  it('a semicolon inside a comma file stays in its cell', () => {
    expect(csv('id,note\n1,a;b\n')).toEqual([{ id: '1', note: 'a;b' }])
  })

  it('a delimiter inside a quoted header does not decide the delimiter', () => {
    expect(csv('"a,b,c";d\n1;2\n')).toEqual([{ 'a,b,c': '1', d: '2' }])
  })

  it('a quoted cell with a line break is one cell, not extra rows', () => {
    expect(csv('id,note\n1,"line one\nline two"\n2,x\n')).toEqual([
      { id: '1', note: 'line one\nline two' },
      { id: '2', note: 'x' },
    ])
  })

  it('reads an escaped quote and CRLF line ends', () => {
    expect(csv('id,note\r\n1,"say ""hi"""\r\n')).toEqual([{ id: '1', note: 'say "hi"' }])
  })

  it('a short row gets empty cells; a long row keeps the known columns', () => {
    expect(csv('a,b\n1\n1,2,3\n')).toEqual([
      { a: '1', b: '' },
      { a: '1', b: '2' },
    ])
  })

  it('skips blank lines and the empty rows Excel leaves at the end', () => {
    expect(csv('a;b\n1;2\n\n;\n;\n')).toEqual([{ a: '1', b: '2' }])
  })

  it('an unnamed column from a trailing delimiter is not a variable', () => {
    expect(csv('a;b;\n1;2;\n')).toEqual([{ a: '1', b: '2' }])
  })

  it('the extension is matched in any case', () => {
    expect(parseIterationData('a\n1\n', 'DATA.CSV', t)).toEqual([{ a: '1' }])
  })
})

describe('JSON', () => {
  it('keeps the type of every value, as Postman does', () => {
    expect(json('[{"id":1,"ok":true,"none":null,"name":"Ada"}]')).toEqual([
      { id: 1, ok: true, none: null, name: 'Ada' },
    ])
  })

  it('takes a BOM off', () => {
    expect(json('\uFEFF[{"id":1}]')).toEqual([{ id: 1 }])
  })

  it('keeps nested values parsed', () => {
    expect(json('[{"user":{"id":1},"tags":["a","b"]}]')).toEqual([
      { user: { id: 1 }, tags: ['a', 'b'] },
    ])
  })
})

describe('a bad file gets a message', () => {
  it.each([
    ['empty CSV', 'data.csv', '', 'runnerConfig.csvTooShort'],
    ['whitespace-only CSV', 'data.csv', '\n\n', 'runnerConfig.csvTooShort'],
    ['CSV with a header and no rows', 'data.csv', 'id,name\n', 'runnerConfig.csvTooShort'],
    ['BOM-only CSV', 'data.csv', '\uFEFF', 'runnerConfig.csvTooShort'],
    ['CSV with an unclosed quote', 'data.csv', 'a,b\n1,"open\n', 'runnerConfig.csvInvalid'],
    ['CSV of only unnamed columns', 'data.csv', ',\n1,2\n', 'runnerConfig.csvTooShort'],
    [
      'binary content named .csv',
      'data.csv',
      'PK\u0003\u0004\u0000\u0000x,y\n1,2',
      'runnerConfig.dataNotText',
    ],
    [
      'UTF-16 text read as UTF-8',
      'data.csv',
      'a\u0000,\u0000b\u0000\n',
      'runnerConfig.dataNotText',
    ],
    ['empty JSON file', 'data.json', '', 'runnerConfig.jsonInvalid'],
    ['broken JSON', 'data.json', '[{"a":1', 'runnerConfig.jsonInvalid'],
    ['an empty JSON array', 'data.json', '[]', 'runnerConfig.dataEmpty'],
    ['a JSON object', 'data.json', '{"a":1}', 'runnerConfig.dataNotArray'],
    ['a JSON row that is not an object', 'data.json', '[1]', 'runnerConfig.dataRowNotObject'],
    ['a JSON row that is an array', 'data.json', '[[1,2]]', 'runnerConfig.dataRowNotObject'],
    ['a null JSON row', 'data.json', '[null]', 'runnerConfig.dataRowNotObject'],
    ['another format', 'data.xlsx', 'a,b\n1,2', 'runnerConfig.dataUnsupported'],
    ['no extension', 'data', 'a,b\n1,2', 'runnerConfig.dataUnsupported'],
  ])('%s', (_name, filename, text, key) => {
    expect(() => parseIterationData(text, filename, t)).toThrow(key)
  })
})

describe('an oversized file gets a message', () => {
  it('refuses a file over the size limit, accepts one at it', () => {
    expect(() => assertIterationFileSize(MAX_ITERATION_FILE_BYTES + 1, t)).toThrow(
      'runnerConfig.dataTooLarge',
    )
    expect(() => assertIterationFileSize(MAX_ITERATION_FILE_BYTES, t)).not.toThrow()
  })

  it('refuses more rows than the limit, in CSV and JSON', () => {
    const over = MAX_ITERATION_ROWS + 1
    expect(() => csv(`a\n${'1\n'.repeat(over)}`)).toThrow('runnerConfig.dataTooManyRows')
    expect(() => json(JSON.stringify(Array.from({ length: over }, () => ({ a: 1 }))))).toThrow(
      'runnerConfig.dataTooManyRows',
    )
  })

  it('accepts exactly the row limit', () => {
    expect(csv(`a\n${'1\n'.repeat(MAX_ITERATION_ROWS)}`)).toHaveLength(MAX_ITERATION_ROWS)
  })
})
