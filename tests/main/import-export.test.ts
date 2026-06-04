import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  reconstructPostmanUrl,
  mapPostmanBodyToUi,
  mapPostmanAuthToUi,
  mapInsomniaBodyToUi,
  mapInsomniaAuthToUi,
  extractPostmanEventScripts,
  normalizeInsomniaScript,
  bodyToPostman,
} from '../../src/main/ipc/import-export.handler'

// ─── Postman URL reconstruction ────────────────────────────

describe('reconstructPostmanUrl', () => {
  it('returns string URL as-is', () => {
    expect(reconstructPostmanUrl('https://api.example.com/users')).toBe(
      'https://api.example.com/users',
    )
  })

  it('prefers raw when set', () => {
    expect(
      reconstructPostmanUrl({
        raw: '{{baseUrl}}/users/1',
        host: ['x'],
        path: ['users', '1'],
      }),
    ).toBe('{{baseUrl}}/users/1')
  })

  it('reconstructs from host + path arrays', () => {
    expect(
      reconstructPostmanUrl({
        protocol: 'https',
        host: ['api', 'example', 'com'],
        path: ['v1', 'users'],
      }),
    ).toBe('https://api.example.com/v1/users')
  })

  it('handles port and string host', () => {
    expect(
      reconstructPostmanUrl({
        protocol: 'http',
        host: 'localhost',
        port: '8080',
        path: ['health'],
      }),
    ).toBe('http://localhost:8080/health')
  })

  it('returns empty string for undefined', () => {
    expect(reconstructPostmanUrl(undefined)).toBe('')
  })
})

// ─── Postman body mapping ───────────────────────────────────

describe('mapPostmanBodyToUi', () => {
  it('returns type:none for missing body', () => {
    expect(mapPostmanBodyToUi(undefined)).toEqual({ type: 'none' })
    expect(mapPostmanBodyToUi({ mode: undefined })).toEqual({ type: 'none' })
  })

  it('maps raw JSON body', () => {
    expect(
      mapPostmanBodyToUi({
        mode: 'raw',
        raw: '{"a":1}',
        options: { raw: { language: 'json' } },
      }),
    ).toEqual({ type: 'json', content: '{"a":1}' })
  })

  it('maps raw XML body', () => {
    expect(
      mapPostmanBodyToUi({ mode: 'raw', raw: '<a/>', options: { raw: { language: 'xml' } } }),
    ).toEqual({ type: 'xml', content: '<a/>' })
  })

  it('defaults raw to text when language missing', () => {
    expect(mapPostmanBodyToUi({ mode: 'raw', raw: 'plain' })).toEqual({
      type: 'text',
      content: 'plain',
    })
  })

  it('maps formdata with disabled flag', () => {
    const result = mapPostmanBodyToUi({
      mode: 'formdata',
      formdata: [
        { key: 'title', value: 'demo' },
        { key: 'off', value: 'x', disabled: true },
      ],
    })
    expect(result.type).toBe('form-data')
    expect(result.formData).toHaveLength(2)
    expect(result.formData![0]).toMatchObject({ key: 'title', value: 'demo', enabled: true })
    expect(result.formData![1]).toMatchObject({ key: 'off', enabled: false })
  })

  it('maps form file uploads (src) into type=file with filePath', () => {
    const result = mapPostmanBodyToUi({
      mode: 'formdata',
      formdata: [{ key: 'avatar', type: 'file', src: '/tmp/photo.png' }],
    })
    expect(result.formData).toHaveLength(1)
    const row = result.formData![0]
    expect(row.type).toBe('file')
    expect(row.filePath).toBe('/tmp/photo.png')
    // Display value should be the basename, not the full path.
    expect(row.value).toBe('photo.png')
    expect(row.enabled).toBe(true)
  })

  it('maps text fields with explicit type=text', () => {
    const result = mapPostmanBodyToUi({
      mode: 'formdata',
      formdata: [{ key: 'description', value: 'demo', type: 'text' }],
    })
    expect(result.formData![0]).toMatchObject({
      key: 'description',
      value: 'demo',
      type: 'text',
    })
    expect(result.formData![0].filePath).toBeUndefined()
  })

  it('maps Windows-style file paths', () => {
    const result = mapPostmanBodyToUi({
      mode: 'formdata',
      formdata: [{ key: 'doc', type: 'file', src: 'C:\\Users\\x\\report.pdf' }],
    })
    expect(result.formData![0].type).toBe('file')
    expect(result.formData![0].filePath).toBe('C:\\Users\\x\\report.pdf')
    expect(result.formData![0].value).toBe('report.pdf')
  })

  it('round-trips formdata file fields through bodyToPostman → mapPostmanBodyToUi', () => {
    const exported = bodyToPostman({
      type: 'form-data',
      formData: [
        { key: 'caption', value: 'My photo', enabled: true, type: 'text' },
        {
          key: 'avatar',
          value: 'photo.png',
          enabled: true,
          type: 'file',
          filePath: '/tmp/photo.png',
        },
        {
          key: 'disabled-text',
          value: 'skip',
          enabled: false,
          type: 'text',
        },
      ],
    })
    expect(exported?.mode).toBe('formdata')
    expect(exported?.formdata).toHaveLength(3)
    // Text field
    expect(exported?.formdata![0]).toMatchObject({
      key: 'caption',
      value: 'My photo',
      type: 'text',
    })
    // File field — Postman v2.1 wants `src`, not `value`.
    expect(exported?.formdata![1]).toMatchObject({
      key: 'avatar',
      type: 'file',
      src: '/tmp/photo.png',
    })
    // Disabled flag survives.
    expect(exported?.formdata![2].disabled).toBe(true)

    // Re-import and verify the file row keeps its identity.
    const reImported = mapPostmanBodyToUi(exported)
    expect(reImported.type).toBe('form-data')
    const fileRow = reImported.formData!.find((r) => r.key === 'avatar')!
    expect(fileRow.type).toBe('file')
    expect(fileRow.filePath).toBe('/tmp/photo.png')
    expect(fileRow.value).toBe('photo.png')
    const textRow = reImported.formData!.find((r) => r.key === 'caption')!
    expect(textRow.type).toBe('text')
    expect(textRow.filePath).toBeUndefined()
  })

  it('maps urlencoded body', () => {
    const result = mapPostmanBodyToUi({
      mode: 'urlencoded',
      urlencoded: [{ key: 'q', value: 'test' }],
    })
    expect(result.type).toBe('urlencoded')
    expect(result.urlEncoded).toHaveLength(1)
    expect(result.urlEncoded![0]).toMatchObject({ key: 'q', value: 'test', enabled: true })
  })

  it('maps graphql body to json', () => {
    const result = mapPostmanBodyToUi({
      mode: 'graphql',
      graphql: { query: 'query{x}', variables: '{"v":1}' },
    })
    expect(result.type).toBe('json')
    expect(JSON.parse(result.content!)).toEqual({ query: 'query{x}', variables: { v: 1 } })
  })

  it('maps file upload as binary with src hint', () => {
    expect(mapPostmanBodyToUi({ mode: 'file', file: { src: '/tmp/x' } })).toEqual({
      type: 'binary',
      content: '/tmp/x',
    })
  })
})

// ─── Postman auth mapping ───────────────────────────────────

describe('mapPostmanAuthToUi', () => {
  it('returns null for missing auth', () => {
    expect(mapPostmanAuthToUi(undefined)).toBeNull()
  })

  it('maps basic auth (array form)', () => {
    expect(
      mapPostmanAuthToUi({
        type: 'basic',
        basic: [
          { key: 'username', value: 'u' },
          { key: 'password', value: 'p' },
        ],
      }),
    ).toEqual({ type: 'basic', basic: { username: 'u', password: 'p' } })
  })

  it('maps basic auth (object form)', () => {
    expect(
      mapPostmanAuthToUi({ type: 'basic', basic: { username: 'u', password: 'p' } }),
    ).toEqual({ type: 'basic', basic: { username: 'u', password: 'p' } })
  })

  it('maps bearer with default Bearer prefix', () => {
    const result = mapPostmanAuthToUi({
      type: 'bearer',
      bearer: [{ key: 'token', value: 'abc' }],
    })
    expect(result).toEqual({ type: 'bearer', bearer: { token: 'abc', prefix: 'Bearer' } })
  })

  it('maps apikey with header location', () => {
    expect(
      mapPostmanAuthToUi({
        type: 'apikey',
        apikey: [
          { key: 'key', value: 'X-K' },
          { key: 'value', value: 'V' },
          { key: 'in', value: 'header' },
        ],
      }),
    ).toEqual({
      type: 'api-key',
      apiKey: { key: 'X-K', value: 'V', in: 'header' },
    })
  })

  it('maps apikey with query location', () => {
    const r = mapPostmanAuthToUi({
      type: 'apikey',
      apikey: [
        { key: 'key', value: 'k' },
        { key: 'value', value: 'v' },
        { key: 'in', value: 'query' },
      ],
    })
    expect((r!.apiKey as { in: string }).in).toBe('query')
  })

  it('maps oauth2 best-effort', () => {
    const result = mapPostmanAuthToUi({
      type: 'oauth2',
      oauth2: [
        { key: 'accessTokenUrl', value: 'https://t/' },
        { key: 'clientId', value: 'cid' },
        { key: 'accessToken', value: 'tok' },
      ],
    })
    expect(result?.type).toBe('oauth2')
    expect((result!.oauth2 as { token: string }).token).toBe('tok')
  })

  it('returns type:none for noauth', () => {
    expect(mapPostmanAuthToUi({ type: 'noauth' })).toEqual({ type: 'none' })
  })
})

// ─── Insomnia body mapping ──────────────────────────────────

describe('mapInsomniaBodyToUi', () => {
  it('returns none for empty body', () => {
    expect(mapInsomniaBodyToUi(undefined)).toEqual({ type: 'none' })
    expect(mapInsomniaBodyToUi({})).toEqual({ type: 'none' })
  })

  it('maps application/json', () => {
    expect(mapInsomniaBodyToUi({ mimeType: 'application/json', text: '{"a":1}' })).toEqual({
      type: 'json',
      content: '{"a":1}',
    })
  })

  it('maps application/xml and text/xml', () => {
    expect(mapInsomniaBodyToUi({ mimeType: 'application/xml', text: '<a/>' }).type).toBe('xml')
    expect(mapInsomniaBodyToUi({ mimeType: 'text/xml', text: '<a/>' }).type).toBe('xml')
  })

  it('maps multipart with disabled', () => {
    const r = mapInsomniaBodyToUi({
      mimeType: 'multipart/form-data',
      params: [
        { name: 'a', value: '1' },
        { name: 'b', value: '2', disabled: true },
      ],
    })
    expect(r.type).toBe('form-data')
    expect(r.formData).toHaveLength(2)
    expect(r.formData![1].enabled).toBe(false)
  })

  it('maps multipart file fields with type=file', () => {
    const r = mapInsomniaBodyToUi({
      mimeType: 'multipart/form-data',
      params: [
        { name: 'caption', value: 'demo', type: 'text' },
        { name: 'attachment', value: '', type: 'file', fileName: '/var/data/report.pdf' },
      ],
    })
    expect(r.type).toBe('form-data')
    expect(r.formData).toHaveLength(2)
    expect(r.formData![0].type).toBe('text')
    expect(r.formData![1].type).toBe('file')
    expect(r.formData![1].filePath).toBe('/var/data/report.pdf')
    expect(r.formData![1].value).toBe('report.pdf')
  })

  it('maps urlencoded', () => {
    expect(
      mapInsomniaBodyToUi({
        mimeType: 'application/x-www-form-urlencoded',
        params: [{ name: 'q', value: 'test' }],
      }).type,
    ).toBe('urlencoded')
  })

  it('falls back to text for unknown mime', () => {
    expect(mapInsomniaBodyToUi({ mimeType: 'application/x-custom', text: 'data' })).toEqual({
      type: 'text',
      content: 'data',
    })
  })
})

// ─── Insomnia auth mapping ──────────────────────────────────

describe('mapInsomniaAuthToUi', () => {
  it('returns null when disabled', () => {
    expect(
      mapInsomniaAuthToUi({ type: 'basic', username: 'u', password: 'p', disabled: true }),
    ).toBeNull()
  })

  it('maps basic auth', () => {
    expect(mapInsomniaAuthToUi({ type: 'basic', username: 'u', password: 'p' })).toEqual({
      type: 'basic',
      basic: { username: 'u', password: 'p' },
    })
  })

  it('maps bearer', () => {
    expect(mapInsomniaAuthToUi({ type: 'bearer', token: 't' })).toEqual({
      type: 'bearer',
      bearer: { token: 't', prefix: 'Bearer' },
    })
  })

  it('maps apikey with addTo=queryParams', () => {
    const r = mapInsomniaAuthToUi({ type: 'apikey', key: 'k', value: 'v', addTo: 'queryParams' })
    expect(r).toEqual({ type: 'api-key', apiKey: { key: 'k', value: 'v', in: 'query' } })
  })

  it('maps apikey defaults to header', () => {
    const r = mapInsomniaAuthToUi({ type: 'apikey', key: 'k', value: 'v' })
    expect((r!.apiKey as { in: string }).in).toBe('header')
  })

  it('returns null for type=none', () => {
    expect(mapInsomniaAuthToUi({ type: 'none' })).toBeNull()
  })
})

// ─── Round-trip integration: Postman → UI → Postman ──────

describe('Postman fixtures → UI → Postman round-trip', () => {
  it('parses fixture without errors', async () => {
    // Importer needs DB; we only verify the helpers extract sensible UI shape
    // from the fixture's sample request.
    const { readFileSync } = await import('node:fs')
    const path = (await import('node:path')).resolve(
      __dirname,
      '../fixtures/import-export/postman-v2.1.json',
    )
    const fixture = JSON.parse(readFileSync(path, 'utf8'))

    // Find the "Get user by id" request
    const usersFolder = fixture.item.find((i: { name: string }) => i.name === 'Users')
    const getUser = usersFolder.item[0]
    const url = reconstructPostmanUrl(getUser.request.url)
    expect(url).toContain('{{baseUrl}}')
    expect(url).toContain('users')

    const createUser = usersFolder.item[1]
    const body = mapPostmanBodyToUi(createUser.request.body)
    expect(body).toEqual({ type: 'json', content: '{"name":"alice"}' })

    const auth = mapPostmanAuthToUi(createUser.request.auth)
    expect(auth).toEqual({ type: 'basic', basic: { username: 'admin', password: 'secret' } })
  })
})

describe('Insomnia v4 fixtures → UI', () => {
  it('parses request body and auth', async () => {
    const { readFileSync } = await import('node:fs')
    const path = (await import('node:path')).resolve(
      __dirname,
      '../fixtures/import-export/insomnia-v4.json',
    )
    const fixture = JSON.parse(readFileSync(path, 'utf8'))
    const create = fixture.resources.find((r: { _id: string }) => r._id === 'req_create_user')
    expect(mapInsomniaBodyToUi(create.body)).toEqual({
      type: 'json',
      content: '{"name":"alice"}',
    })
    expect(mapInsomniaAuthToUi(create.authentication)).toEqual({
      type: 'basic',
      basic: { username: 'admin', password: 'secret' },
    })
  })
})

describe('Insomnia v5 YAML fixture → object', () => {
  it('parses YAML and matches v5 structure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = (await import('js-yaml')) as unknown as { load: (s: string) => unknown }
    const fixturePath = path.resolve(__dirname, '../fixtures/import-export/insomnia-v5.yaml')
    const doc = yaml.load(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
    expect(doc.type).toBe('collection.insomnia.rest/5.0')
    expect(Array.isArray(doc.collection)).toBe(true)
  })
})

// ─── Script extraction ─────────────────────────────────────

describe('extractPostmanEventScripts', () => {
  it('returns empty when no events', () => {
    expect(extractPostmanEventScripts(undefined)).toEqual({})
    expect(extractPostmanEventScripts([])).toEqual({})
  })

  it('extracts pre-request and test scripts', () => {
    const result = extractPostmanEventScripts([
      {
        listen: 'prerequest',
        script: { exec: ['pm.environment.set("k", 1);', 'console.log("pre");'] },
      },
      {
        listen: 'test',
        script: { exec: 'pm.test("ok", () => pm.response.to.have.status(200));' },
      },
    ])
    expect(result.preScript).toContain('pm.environment.set')
    expect(result.preScript).toContain('console.log')
    expect(result.postScript).toContain('pm.test')
  })

  it('skips events with no script', () => {
    const result = extractPostmanEventScripts([{ listen: 'prerequest', script: {} }])
    expect(result.preScript).toBeUndefined()
  })
})

describe('normalizeInsomniaScript', () => {
  it('rewrites insomnia.* to pm.*', () => {
    const input = `
      const v = insomnia.iterationData.get('run_once');
      if (v !== 'yes') insomnia.execution.skipRequest();
      insomnia.test('ok', function () {
        insomnia.expect(insomnia.response.json().status).to.eql('OK');
      });
      insomnia.environment.set('k', '1');
    `
    const out = normalizeInsomniaScript(input)
    expect(out).toContain("pm.iterationData.get('run_once')")
    expect(out).toContain('pm.execution.skipRequest()')
    expect(out).toContain("pm.test('ok'")
    expect(out).toContain('pm.expect(pm.response.json()')
    expect(out).toContain("pm.environment.set('k', '1')")
    expect(out).not.toContain('insomnia.')
  })

  it('preserves non-insomnia identifiers', () => {
    const input = `const insomniaCount = 5; pm.test('x', () => {});`
    const out = normalizeInsomniaScript(input)
    expect(out).toContain('insomniaCount = 5') // word boundary should preserve var name
  })
})

// ─── Real-world fixtures ───────────────────────────────────

describe('Real-world Postman fixture (Oracle CRUD)', () => {
  it('extracts pre-request scripts from event[]', () => {
    const fixturePath = path.resolve(
      __dirname,
      '../fixtures/import-export/oracle-postman.json',
    )
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const firstItem = doc.item[0]
    expect(firstItem.name).toContain('Create Employee')
    const scripts = extractPostmanEventScripts(firstItem.event)
    expect(scripts.preScript).toContain('pm.environment.set')
    expect(scripts.preScript).toContain("'employee_body'")
    expect(scripts.postScript).toContain('pm.test')
    expect(scripts.postScript).toContain('Status code is 200')
  })

  it('reconstructs templated URL', () => {
    const fixturePath = path.resolve(
      __dirname,
      '../fixtures/import-export/oracle-postman.json',
    )
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const firstItem = doc.item[0]
    const url = reconstructPostmanUrl(firstItem.request.url)
    expect(url).toBe('{{baseUrl}}/employee')
  })
})

describe('Real-world Insomnia v5 fixture (Oracle CRUD)', () => {
  it('parses YAML with scripts and normalizes them', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = (await import('js-yaml')) as unknown as { load: (s: string) => unknown }
    const fixturePath = path.resolve(
      __dirname,
      '../fixtures/import-export/oracle-insomnia-v5.yaml',
    )
    const doc = yaml.load(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
    expect(doc.type).toBe('collection.insomnia.rest/5.0')
    const collection = doc.collection as Array<{ children?: unknown[] }>
    const root = collection[0]
    expect(root.children).toBeDefined()
    const first = (root.children as Array<{ name: string; scripts?: { preRequest?: string } }>)[0]
    expect(first.name).toContain('Create Employee')
    expect(first.scripts?.preRequest).toContain('insomnia.environment.set')
    const normalized = normalizeInsomniaScript(first.scripts!.preRequest!)
    expect(normalized).toContain('pm.environment.set')
    expect(normalized).not.toContain('insomnia.environment')
  })
})

describe('Multi-iteration Insomnia fixture', () => {
  it('contains iterationData calls and skipRequest patterns', () => {
    const text = readFileSync(
      path.resolve(__dirname, '../fixtures/import-export/multi-iteration-insomnia.yaml'),
      'utf8',
    )
    expect(text).toContain('insomnia.iterationData.get')
    expect(text).toContain('insomnia.execution.skipRequest')
    // After normalization the runner sees pm.* equivalents:
    expect(normalizeInsomniaScript(text)).toContain('pm.iterationData.get')
    expect(normalizeInsomniaScript(text)).toContain('pm.execution.skipRequest')
  })
})

describe('OpenAPI 3.0 fixture', () => {
  it('parses spec with multiple methods, params, and tags', () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/import-export/openapi-3.0.json')
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8'))
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.paths['/pets']).toBeDefined()
    expect(doc.paths['/pets'].get).toBeDefined()
    expect(doc.paths['/pets'].post).toBeDefined()
    expect(doc.paths['/pets/{petId}'].get).toBeDefined()
    expect(doc.servers[0].url).toBe('https://petstore.example.com/v1')
    // Path templating
    const pathParams = (doc.paths['/pets/{petId}'].get.parameters as Array<{ in: string }>).filter(
      (p) => p.in === 'path',
    )
    expect(pathParams).toHaveLength(1)
  })
})

describe('Swagger 2.0 fixture', () => {
  it('parses host + basePath + schemes form', () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/import-export/swagger-2.0.json')
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8'))
    expect(doc.swagger).toBe('2.0')
    expect(doc.host).toBe('legacy.example.com')
    expect(doc.basePath).toBe('/api/v1')
    expect(doc.schemes).toContain('https')
    expect(doc.paths['/users'].get.parameters[0].name).toBe('page')
  })
})

describe('HAR 1.2 fixture', () => {
  it('parses entries with json + form bodies', () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/import-export/sample.har')
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8'))
    expect(doc.log.version).toBe('1.2')
    expect(doc.log.entries).toHaveLength(2)

    const first = doc.log.entries[0]
    expect(first.request.method).toBe('POST')
    expect(first.request.postData.mimeType).toBe('application/json')

    const second = doc.log.entries[1]
    expect(second.request.postData.mimeType).toBe('application/x-www-form-urlencoded')
    expect(second.request.postData.params).toHaveLength(2)
  })
})

describe('Iteration data file (Postman test data)', () => {
  it('parses test_data-cb.json as iteration rows', () => {
    const data = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../fixtures/import-export/iteration-data.json'),
        'utf8',
      ),
    )
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(5)
    expect(data[0]).toMatchObject({ run_once: 'yes', auth_case: 'valid' })
    expect(data[2]).toMatchObject({ _iteration_label: expect.stringContaining('BANNED') })
  })
})
