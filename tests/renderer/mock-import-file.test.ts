/** What the mock import looks at before a server exists (issue #319). */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  inspectMockImportText,
  mockImportProblem,
  readMockImportFile,
  MOCK_IMPORT_MAX_BYTES,
} from '../../src/renderer/components/mock/mock-import-file'
import { setLocale, t } from '../../src/renderer/lib/i18n'

beforeEach(() => setLocale('en'))

const openapi = (paths: unknown, extra: object = {}): string =>
  JSON.stringify({ openapi: '3.0.0', info: { title: 'Pets', version: '1' }, paths, ...extra })
const postman = (item: unknown, name = 'Shop'): string =>
  JSON.stringify({
    info: {
      name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item,
  })

describe('inspectMockImportText', () => {
  it('recognises OpenAPI JSON, counts operations and takes the title', () => {
    const r = inspectMockImportText(
      openapi({ '/a': { get: {}, post: {}, parameters: [] }, '/b': { delete: {} } }),
      'pets.json',
    )
    expect(r).toMatchObject({
      ok: true,
      file: { format: 'openapi', title: 'Pets', endpointCount: 3, fileName: 'pets.json' },
    })
  })

  it('recognises OpenAPI YAML and unquoted swagger: 2.0', () => {
    const r = inspectMockImportText(
      'swagger: 2.0\ninfo: { title: Old, version: "1" }\npaths:\n  /a:\n    get: {}\n',
      'old.yaml',
    )
    expect(r).toMatchObject({ ok: true, file: { format: 'openapi', title: 'Old' } })
  })

  it('a path item that is a $ref counts: only main can follow it', () => {
    const r = inspectMockImportText(
      openapi(
        { '/a': { $ref: '#/components/pathItems/a' } },
        { components: { pathItems: { a: { get: {} } } } },
      ),
      'a.json',
    )
    expect(r).toMatchObject({ ok: true, file: { endpointCount: 1 } })
  })

  it('recognises a Postman v2.1 collection and counts nested requests', () => {
    const r = inspectMockImportText(
      postman([{ name: 'f', item: [{ request: { url: '/a' } }] }, { request: { url: '/b' } }]),
      'shop.json',
    )
    expect(r).toMatchObject({
      ok: true,
      file: { format: 'postman', title: 'Shop', endpointCount: 2 },
    })
  })

  it('falls back to the file name when the spec has no title, and clips a long one', () => {
    const noTitle = JSON.stringify({ openapi: '3.0.0', paths: { '/a': { get: {} } } })
    expect(inspectMockImportText(noTitle, 'my.spec.yaml')).toMatchObject({
      file: { title: 'my.spec' },
    })
    const long = inspectMockImportText(postman([{ request: {} }], 'x'.repeat(200)), 'l.json')
    expect(long.ok && long.file.title.length).toBe(80)
  })

  it.each([
    ['garbage', '{{ not json: ['],
    ['an array', '[1, 2]'],
    ['an empty file', ''],
    ['a scalar', 'hello'],
    ['some other JSON', '{"a":1}'],
  ])('refuses %s as not recognised', (_label, text) => {
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importNotRecognised'),
    })
  })

  it.each([
    ['a Postman environment', '{"_postman_variable_scope":"environment","values":[]}'],
    ['a Postman v1 collection', '{"name":"c","requests":[]}'],
    ['a Postman v3 file', '{"$kind":"collection"}'],
  ])('refuses %s as unsupported, not as unknown', (_label, text) => {
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importUnsupportedPostman'),
    })
  })

  it('refuses a v2 collection in YAML: the importer reads JSON', () => {
    const yaml = `info:\n  name: y\n  schema: https://schema.getpostman.com/json/collection/v2.1.0/collection.json\nitem: []\n`
    expect(inspectMockImportText(yaml, 'y.yaml')).toEqual({
      ok: false,
      error: t('mockNew.importUnsupportedPostman'),
    })
  })

  it.each([
    ['no paths key', JSON.stringify({ openapi: '3.0.0', info: {} })],
    ['empty paths', openapi({})],
    ['paths without an operation', openapi({ '/a': { parameters: [] } })],
    ['an empty collection', postman([])],
    ['only empty folders', postman([{ name: 'f', item: [] }])],
  ])('refuses %s as having nothing to mock', (_label, text) => {
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importEmpty'),
    })
  })
})

describe('readMockImportFile', () => {
  it('refuses an oversized file without reading it', async () => {
    let read = false
    const file = {
      name: 'big.json',
      size: MOCK_IMPORT_MAX_BYTES + 1,
      text: async () => {
        read = true
        return ''
      },
    } as unknown as File
    expect(await readMockImportFile(file)).toEqual({
      ok: false,
      error: t('mockNew.importTooLarge'),
    })
    expect(read).toBe(false)
  })

  it('a read failure is an error, not a rejection', async () => {
    const file = {
      name: 'gone.json',
      size: 1,
      text: () => Promise.reject(new Error('NotReadableError')),
    } as unknown as File
    expect(await readMockImportFile(file)).toEqual({
      ok: false,
      error: t('mockNew.importUnreadable'),
    })
  })
})

describe('mockImportProblem', () => {
  const result = { ok: true, endpointsCreated: 2, responsesCreated: 2, warnings: [] }
  it('passes a success, fails an error and an import that created nothing', () => {
    expect(mockImportProblem(result)).toBeNull()
    expect(mockImportProblem({ ...result, ok: false, error: 'boom' })).toBe('boom')
    expect(mockImportProblem({ ...result, ok: false })).toBe('')
    expect(mockImportProblem({ ...result, endpointsCreated: 0 })).toBe(t('mockNew.importEmpty'))
  })
})
