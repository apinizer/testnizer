/** What the mock import looks at before a server exists (issue #319). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  inspectMockImportText,
  mockImportProblem,
  readMockImportFile,
  toastMockImportResult,
  MOCK_IMPORT_MAX_BYTES,
} from '../../src/renderer/components/mock/mock-import-file'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import { toast } from '../../src/renderer/lib/toast'

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

const aliasedFolders = (levels: number): string => {
  let out = `info: {name: X, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"}\n`
  out += `defs:\n  a0: &a0 [{name: r, request: {method: GET, url: "http://x/a"}}]\n`
  for (let i = 1; i <= levels; i++) {
    out += `  a${i}: &a${i} [{name: f, item: *a${i - 1}}, {name: f, item: *a${i - 1}}]\n`
  }
  return `${out}item: *a${levels}\n`
}

describe('a file that repeats itself through YAML aliases', () => {
  it('refuses folders that double at each level, before counting them', () => {
    const r = inspectMockImportText(aliasedFolders(22), 'bomb.yaml')
    expect(r).toEqual({ ok: false, error: t('mockNew.importTooComplex') })
  })

  // Not run against old code: 2^40 visits never end.
  it('forty levels answer at once', () => {
    const started = Date.now()
    const r = inspectMockImportText(aliasedFolders(40), 'bomb.yaml')
    expect(r).toEqual({ ok: false, error: t('mockNew.importTooComplex') })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('refuses a folder that contains itself, without overflowing the stack', () => {
    const text = 'info: {name: X}\nitem: &loop [{item: *loop}]\n'
    expect(inspectMockImportText(text, 'loop.yaml')).toEqual({
      ok: false,
      error: t('mockNew.importTooComplex'),
    })
  })

  it('has Turkish text', () => {
    setLocale('tr')
    expect(t('mockNew.importTooComplex')).toMatch(/büyük/)
    expect(t('mockNew.importNoVersion')).toMatch(/sürümü/)
    expect(t('mockNew.importUnsupportedVersion')).toMatch(/desteklenmiyor/)
  })
})

describe('an OpenAPI file with no version it can read', () => {
  it('a paths section alone is refused before a server exists', () => {
    expect(inspectMockImportText('{"paths":{"/health":{"get":{}}}}', 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importNoVersion'),
    })
  })

  it('a version it cannot read is refused', () => {
    const text = '{"openapi":"9.9.9","paths":{"/health":{"get":{}}}}'
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importUnsupportedVersion'),
    })
  })

  it('a newer minor version is still taken', () => {
    const r = inspectMockImportText('{"openapi":"3.2.0","paths":{"/a":{"get":{}}}}', 'x.json')
    expect(r.ok).toBe(true)
  })
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
    ['one file of a Postman v3 folder', '{"$kind":"http-request","url":"https://x.io"}'],
  ])('refuses %s as unsupported, not as unknown', (_label, text) => {
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importUnsupportedPostman'),
    })
  })

  it('takes a Postman v1 collection: its name and its requests', () => {
    const text = JSON.stringify({ name: 'Old', requests: [{ id: 'a' }, { id: 'b' }] })
    expect(inspectMockImportText(text, 'x.json')).toMatchObject({
      ok: true,
      file: { format: 'postman', title: 'Old', endpointCount: 2 },
    })
  })

  it('takes a Postman v3 collection and promises only its HTTP requests', () => {
    const text = JSON.stringify({
      $kind: 'collection',
      name: 'New',
      items: [
        { $kind: 'collection', items: [{ $kind: 'http-request' }] },
        { $kind: 'http-request' },
        { $kind: 'websocket-request' },
      ],
    })
    expect(inspectMockImportText(text, 'x.json')).toMatchObject({
      ok: true,
      file: { format: 'postman', title: 'New', endpointCount: 2 },
    })
  })

  it('a v3 collection with nothing an HTTP mock can answer is empty', () => {
    const text = JSON.stringify({
      $kind: 'collection',
      items: [{ $kind: 'websocket-request' }],
    })
    expect(inspectMockImportText(text, 'x.json')).toEqual({
      ok: false,
      error: t('mockNew.importEmpty'),
    })
  })

  it('takes a v2 collection in YAML', () => {
    const yaml = `info:\n  name: y\n  schema: https://schema.getpostman.com/json/collection/v2.1.0/collection.json\nitem:\n  - name: a\n    request: {method: GET, url: https://x.io/a}\n`
    expect(inspectMockImportText(yaml, 'y.yaml')).toMatchObject({
      ok: true,
      file: { format: 'postman', title: 'y', endpointCount: 1 },
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

describe('toastMockImportResult: the report of a finished import', () => {
  const result = { ok: true, endpointsCreated: 2, responsesCreated: 3, warnings: [] as string[] }
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('a clean import is a plain success', () => {
    const success = vi.spyOn(toast, 'success').mockImplementation(() => undefined)
    const custom = vi.spyOn(toast, 'custom')
    toastMockImportResult(result)
    expect(success).toHaveBeenCalledWith('2 endpoints, 3 responses imported')
    expect(custom).not.toHaveBeenCalled()
  })

  it('shows every warning, not how many there were', () => {
    const success = vi.spyOn(toast, 'success').mockImplementation(() => undefined)
    const dismiss = vi.spyOn(toast, 'dismiss').mockImplementation(() => undefined)
    const custom = vi.spyOn(toast, 'custom').mockImplementation(() => 'id')
    const warnings = Array.from({ length: 12 }, (_, i) => `note ${i}`)
    toastMockImportResult({ ...result, warnings })

    expect(success).not.toHaveBeenCalled()
    expect(custom.mock.calls[0][1]).toMatchObject({ duration: Infinity })
    render(custom.mock.calls[0][0]('id'))
    expect(screen.getByTestId('mock-import-toast').textContent).toContain(
      '2 endpoints, 3 responses imported',
    )
    expect(screen.getAllByTestId('mock-import-warning').map((n) => n.textContent)).toEqual(warnings)
    fireEvent.click(screen.getByTestId('mock-import-toast-close'))
    expect(dismiss).toHaveBeenCalled()
  })

  it('a failure stays an error', () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => undefined)
    toastMockImportResult({ ...result, ok: false, error: 'boom', warnings: ['x'] })
    expect(error).toHaveBeenCalledWith(`${t('mock.importFailed')}: boom`)
  })
})
