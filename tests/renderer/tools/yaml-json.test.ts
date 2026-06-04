import { describe, it, expect } from 'vitest'
import { jsonToYaml, yamlToJson } from '../../../src/renderer/lib/tools/yaml-json'

describe('yamlToJson', () => {
  it('parses a basic YAML document', () => {
    const r = yamlToJson('name: Alice\nage: 30\ntags:\n  - a\n  - b\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.parse(r.output)).toEqual({ name: 'Alice', age: 30, tags: ['a', 'b'] })
  })

  it('returns empty string for empty input', () => {
    const r = yamlToJson('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toBe('')
  })

  it('respects sort-keys', () => {
    const r = yamlToJson('z: 1\na: 2\nm: 3', { sortKeys: true })
    if (!r.ok) throw new Error(r.error)
    const lines = r.output.split('\n').map((l) => l.trim())
    const aIdx = lines.findIndex((l) => l.startsWith('"a"'))
    const mIdx = lines.findIndex((l) => l.startsWith('"m"'))
    const zIdx = lines.findIndex((l) => l.startsWith('"z"'))
    expect(aIdx).toBeLessThan(mIdx)
    expect(mIdx).toBeLessThan(zIdx)
  })

  it('returns ok:false on invalid YAML', () => {
    const r = yamlToJson('foo: [unclosed')
    expect(r.ok).toBe(false)
  })
})

describe('jsonToYaml', () => {
  it('serialises a simple object', () => {
    const r = jsonToYaml('{"name":"Alice","age":30}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toContain('name: Alice')
    expect(r.output).toContain('age: 30')
  })

  it('handles nested arrays + objects', () => {
    const r = jsonToYaml(JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }))
    if (!r.ok) throw new Error(r.error)
    expect(r.output).toMatch(/items:\s*\n\s*-\s*id:\s*1/)
  })

  it('returns ok:false on invalid JSON', () => {
    const r = jsonToYaml('{not json')
    expect(r.ok).toBe(false)
  })
})

describe('round-trip', () => {
  it('JSON → YAML → JSON preserves a sample document', () => {
    const original = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: { '/x': { get: { summary: 'Hi', responses: { '200': { description: 'OK' } } } } },
    }
    const yamlForm = jsonToYaml(JSON.stringify(original))
    expect(yamlForm.ok).toBe(true)
    if (!yamlForm.ok) return
    const back = yamlToJson(yamlForm.output)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(JSON.parse(back.output)).toEqual(original)
  })
})
