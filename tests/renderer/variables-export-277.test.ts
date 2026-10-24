/**
 * Issue #277 — the Environments modal exports the globals too (Postman
 * globals format), and both exports carry `_postman_exported_at`.
 *
 * Fail-before: the export button only handled a selected environment; with the
 * Globals pane open it was disabled, and no export had `_postman_exported_at`.
 */
import { describe, it, expect } from 'vitest'
import { buildVariablesExport } from '../../src/renderer/lib/variables-export'
import { classifyPostmanDocument } from '../../src/shared/postman-detect'
import type { Environment, GlobalVariable } from '../../src/renderer/types'

const NOW = new Date('2026-10-24T08:00:00.000Z')

const globals: GlobalVariable[] = [
  {
    id: 'g1',
    key: 'host',
    value: 'https://g.test',
    enabled: true,
    secret: false,
    workspace_id: 'w',
  },
  {
    id: 'g2',
    key: 'apiKey',
    value: 'super-secret-value',
    enabled: true,
    secret: true,
    workspace_id: 'w',
  },
  {
    id: 'g3',
    key: 'seed',
    value: '',
    initialValue: 'from-initial',
    enabled: false,
    secret: false,
    workspace_id: 'w',
  },
]

const env: Environment = {
  id: 'e1',
  workspace_id: 'w',
  name: 'Staging',
  is_active: true,
  created_at: 0,
  updated_at: 0,
  variables: [
    { id: 'v1', key: 'baseUrl', value: 'https://s.test', enabled: true, secret: false },
    { id: 'v2', key: 'token', value: 'hidden-token', enabled: true, secret: true },
  ],
}

describe('issue #277 — environment / globals export', () => {
  it('globals (env = null) → a Postman globals file; secret values stay empty', () => {
    const out = buildVariablesExport(null, globals, NOW)!
    expect(out.fileName).toBe('globals.testnizer_globals.json')
    expect(out.doc).toEqual({
      name: 'Globals',
      values: [
        { key: 'host', value: 'https://g.test', enabled: true, type: 'default' },
        { key: 'apiKey', value: '', enabled: true, type: 'secret' },
        { key: 'seed', value: 'from-initial', enabled: false, type: 'default' },
      ],
      _postman_variable_scope: 'globals',
      _postman_exported_at: '2026-10-24T08:00:00.000Z',
      _postman_exported_using: 'Testnizer',
    })
    expect(JSON.stringify(out.doc)).not.toContain('super-secret-value')
    // The Postman importer recognises it as globals.
    expect(classifyPostmanDocument(out.doc)?.kind).toBe('globals')
  })

  it('an environment keeps its shape and gains _postman_exported_at', () => {
    const out = buildVariablesExport(env, globals, NOW)!
    expect(out.fileName).toBe('Staging.testnizer_environment.json')
    expect(out.doc).toMatchObject({
      id: 'e1',
      name: 'Staging',
      _postman_variable_scope: 'environment',
      _postman_exported_at: '2026-10-24T08:00:00.000Z',
    })
    expect(JSON.stringify(out.doc)).not.toContain('hidden-token')
    expect(classifyPostmanDocument(out.doc)?.kind).toBe('environment')
  })

  it('no environment selected (undefined) → nothing to export', () => {
    expect(buildVariablesExport(undefined, globals, NOW)).toBeNull()
  })
})
