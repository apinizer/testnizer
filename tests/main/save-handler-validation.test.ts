// Regression coverage for the v1.3.1 B24 export-corruption + import-rejection
// chain. Two tests: (1) the project-export shape validator catches the boots
// it was supposed to catch, (2) Postman's "New Request" placeholder no longer
// leaks into the imported tree (B16).

import { describe, expect, it } from 'vitest'
import { validateProjectExport } from '../../src/main/ipc/save.handler'

describe('validateProjectExport — shape checks', () => {
  // v1.4.6: the validator collapses all "wrong file type" branches to a
  // single generic message (matches the Postman/Insomnia/SoapUI/cURL
  // guards). Only an obviously-Testnizer file that's just empty gets a
  // separate, more helpful message ("re-export the source project").
  const WRONG_TYPE = /not a Testnizer project file/i

  it('passes a fully-populated export', () => {
    const valid = {
      kind: 'project',
      version: 'testnizer-project/2.0',
      exportedAt: Date.now(),
      project: { id: 'p1', name: 'My Project' },
      folders: [{ id: 'f1', name: 'Folder' }],
      endpoints: [{ id: 'e1', name: 'GET things' }],
      endpointCases: [],
      savedRequests: [],
      environments: [],
      environmentVariables: [],
      globalVariables: [],
    }
    expect(validateProjectExport(valid)).toBeNull()
  })

  it('rejects a non-object payload', () => {
    expect(validateProjectExport('not-an-object')).toMatch(WRONG_TYPE)
    expect(validateProjectExport(null)).toMatch(WRONG_TYPE)
    expect(validateProjectExport(42)).toMatch(WRONG_TYPE)
  })

  it('rejects a payload missing the kind:"project" marker', () => {
    expect(
      validateProjectExport({
        version: 'testnizer-project/2.0',
        project: { id: 'p1', name: 'X' },
        folders: [],
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(WRONG_TYPE)
  })

  it('rejects a payload missing the version field', () => {
    expect(
      validateProjectExport({
        kind: 'project',
        project: { id: 'p1', name: 'X' },
        folders: [],
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(WRONG_TYPE)
  })

  it('rejects a payload missing the project block', () => {
    expect(
      validateProjectExport({
        kind: 'project',
        version: 'testnizer-project/2.0',
        folders: [],
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(WRONG_TYPE)
  })

  it('rejects a payload with the wrong array shape', () => {
    expect(
      validateProjectExport({
        kind: 'project',
        version: 'testnizer-project/2.0',
        project: { id: 'p1' },
        folders: 'not-an-array',
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(WRONG_TYPE)
  })

  it('rejects the v1.3.1 corrupted-200-byte stub (all arrays empty)', () => {
    // Shape is right but the export is empty — different message ("re-
    // export the source") so the user knows the file isn't the wrong
    // type, the original export just failed.
    expect(
      validateProjectExport({
        kind: 'project',
        version: 'testnizer-project/2.0',
        exportedAt: Date.now(),
        project: { id: 'p1', name: 'My Project' },
        folders: [],
        endpoints: [],
        endpointCases: [],
        savedRequests: [],
        environments: [],
        environmentVariables: [],
        globalVariables: [],
      }),
    ).toMatch(/no folders, endpoints, suites or mocks/i)
  })

  it('accepts an export that only carries mock servers (mocks-only project)', () => {
    expect(
      validateProjectExport({
        kind: 'project',
        version: 'testnizer-project/2.0',
        project: { id: 'p1', name: 'mocks-only' },
        folders: [],
        endpoints: [],
        savedRequests: [],
        mockServers: [{ id: 'm1', name: 'mock' }],
      }),
    ).toBeNull()
  })
})
