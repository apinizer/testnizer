import { describe, it, expect } from 'vitest'
import {
  detectImportFormat,
  checkTypeMismatch,
} from '../../src/renderer/lib/import-format-detect'

describe('detectImportFormat', () => {
  it('detects WSDL from <?xml + <definitions root', () => {
    const xml = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="Foo"/>`
    expect(detectImportFormat(xml)).toBe('wsdl')
  })

  it('detects WSDL from wsdl: prefix on root element', () => {
    const xml = `<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"></wsdl:definitions>`
    expect(detectImportFormat(xml)).toBe('wsdl')
  })

  it('detects OpenAPI JSON', () => {
    expect(detectImportFormat('{"openapi":"3.0.0","info":{"title":"X"}}')).toBe('openapi')
    expect(detectImportFormat('{"swagger":"2.0","info":{"title":"X"}}')).toBe('openapi')
  })

  it('detects OpenAPI YAML', () => {
    expect(detectImportFormat('openapi: 3.0.0\ninfo:\n  title: X')).toBe('openapi')
    expect(detectImportFormat('swagger: "2.0"\ninfo:\n  title: X')).toBe('openapi')
  })

  it('detects Postman from _postman_id', () => {
    const pm = JSON.stringify({
      info: { _postman_id: 'abc', name: 'My Collection' },
      item: [],
    })
    expect(detectImportFormat(pm)).toBe('postman')
  })

  it('detects Postman from schema URL', () => {
    const pm = JSON.stringify({
      info: { name: 'X', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/' },
      item: [],
    })
    expect(detectImportFormat(pm)).toBe('postman')
  })

  it('detects Postman environment files (_postman_variable_scope)', () => {
    const env = JSON.stringify({
      id: 'env-1',
      name: 'Dev',
      values: [{ key: 'baseUrl', value: 'https://example.com' }],
      _postman_variable_scope: 'environment',
    })
    // Routed through the Postman card — the main handler dispatches collections
    // and environments internally.
    expect(detectImportFormat(env)).toBe('postman')
  })

  it('detects Insomnia v4 export', () => {
    const ins = JSON.stringify({ _type: 'export', __export_format: 4, resources: [] })
    expect(detectImportFormat(ins)).toBe('insomnia')
  })

  it('detects Insomnia v5 export', () => {
    const ins = JSON.stringify({ type: 'collection.insomnia.rest/5.0.0' })
    expect(detectImportFormat(ins)).toBe('insomnia')
  })

  it('detects cURL command', () => {
    expect(detectImportFormat('curl -X GET https://example.com')).toBe('curl')
  })

  it('detects RAML from #%RAML header', () => {
    expect(detectImportFormat('#%RAML 1.0\ntitle: My API')).toBe('raml')
  })

  it('detects proto from syntax line', () => {
    expect(detectImportFormat('syntax = "proto3";\n\npackage foo;')).toBe('proto')
  })

  it('detects proto from extension when syntax missing', () => {
    expect(detectImportFormat('package foo;\n', '/tmp/foo.proto')).toBe('proto')
  })

  it('detects SoapUI project', () => {
    const xml = `<?xml version="1.0"?>
<con:soapui-project xmlns:con="http://eviware.com/soapui/config" name="X"/>`
    expect(detectImportFormat(xml)).toBe('soapui')
  })

  it('returns null for empty / unrecognized content', () => {
    expect(detectImportFormat('')).toBe(null)
    expect(detectImportFormat('   random text  ')).toBe(null)
  })

  it('returns null when JSON is malformed', () => {
    expect(detectImportFormat('{ not json')).toBe(null)
  })

  it('falls back to generic json for unknown JSON objects', () => {
    expect(detectImportFormat('{"foo":"bar"}')).toBe('json')
  })
})

describe('checkTypeMismatch', () => {
  it('flags WSDL file under REST/OpenAPI selection', () => {
    const m = checkTypeMismatch('openapi', 'wsdl')
    expect(m).toEqual({ detected: 'WSDL', expected: 'OpenAPI/Swagger' })
  })

  it('flags Postman content under OpenAPI selection', () => {
    expect(checkTypeMismatch('openapi', 'postman')).toEqual({
      detected: 'Postman',
      expected: 'OpenAPI/Swagger',
    })
  })

  it('flags OpenAPI content under WSDL selection', () => {
    expect(checkTypeMismatch('wsdl', 'openapi')).toEqual({
      detected: 'OpenAPI/Swagger',
      expected: 'WSDL',
    })
  })

  it('accepts WSDL content when WSDL is selected', () => {
    expect(checkTypeMismatch('wsdl', 'wsdl')).toBe(null)
  })

  it('accepts generic JSON for any JSON-based format (no false positive)', () => {
    expect(checkTypeMismatch('openapi', 'json')).toBe(null)
    expect(checkTypeMismatch('postman', 'json')).toBe(null)
    expect(checkTypeMismatch('insomnia', 'json')).toBe(null)
  })

  it('accepts generic XML for WSDL/SoapUI (no false positive)', () => {
    expect(checkTypeMismatch('wsdl', 'xml')).toBe(null)
    expect(checkTypeMismatch('soapui', 'xml')).toBe(null)
  })

  it('returns null when detection is inconclusive', () => {
    expect(checkTypeMismatch('openapi', null)).toBe(null)
  })

  it('flags HAR content as mismatch since no HAR format card exists', () => {
    expect(checkTypeMismatch('openapi', 'har')).toEqual({
      detected: 'HAR',
      expected: 'OpenAPI/Swagger',
    })
  })
})
