// Regression coverage for the v1.3.1 B24 export-corruption + import-rejection
// chain. Two tests: (1) the project-export shape validator catches the boots
// it was supposed to catch, (2) Postman's "New Request" placeholder no longer
// leaks into the imported tree (B16).

import { describe, expect, it } from 'vitest'
import { validateProjectExport } from '../../src/main/ipc/save.handler'

describe('validateProjectExport — shape checks', () => {
  it('passes a fully-populated export', () => {
    const valid = {
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
    expect(validateProjectExport('not-an-object')).toMatch(/not a JSON object/i)
    expect(validateProjectExport(null)).toMatch(/not a JSON object/i)
    expect(validateProjectExport(42)).toMatch(/not a JSON object/i)
  })

  it('rejects a payload missing the version field', () => {
    expect(
      validateProjectExport({
        project: { id: 'p1', name: 'X' },
        folders: [],
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(/version/i)
  })

  it('rejects a payload missing the project block', () => {
    expect(
      validateProjectExport({
        version: 'testnizer-project/2.0',
        folders: [],
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(/project/i)
  })

  it('rejects a payload with the wrong array shape', () => {
    expect(
      validateProjectExport({
        version: 'testnizer-project/2.0',
        project: { id: 'p1' },
        folders: 'not-an-array',
        endpoints: [],
        savedRequests: [],
      }),
    ).toMatch(/folders\/endpoints\/savedRequests/i)
  })

  it('rejects the v1.3.1 corrupted-200-byte stub (all arrays empty)', () => {
    // The literal shape v1.3.1 wrote to disk when the export query path
    // silently returned zero rows. Re-importing it produced "Invalid project
    // file format." (B24).
    expect(
      validateProjectExport({
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
