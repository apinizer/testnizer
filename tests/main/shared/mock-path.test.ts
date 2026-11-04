/**
 * What a mock endpoint binds, from any stored request URL. `endpoints.path`
 * holds the FULL URL after an OpenAPI import (the server + the path), a saved
 * request holds `{{baseUrl}}/x` — none of which a mock can match.
 */
import { describe, it, expect } from 'vitest'
import { requestUrlToMockPath } from '../../../src/shared/mock-path'

describe('requestUrlToMockPath', () => {
  it.each([
    // The reported one: a literal server + an OpenAPI template.
    [
      'https://petstore.swagger.io/v2/pet/{petId}/uploadImage',
      '/v2/pet/:petId/uploadImage',
      'param',
    ],
    ['https://petstore.swagger.io/v2/pet', '/v2/pet', 'exact'],
    ['http://localhost:8080/a/b', '/a/b', 'exact'],
    // `new URL` would turn these into %7B…%7D.
    ['{{baseUrl}}/pet/{{id}}', '/pet/:id', 'param'],
    ['{{ baseUrl }}/pet/{{ id }}', '/pet/:id', 'param'],
    ['{{scheme}}://{{host}}/pet', '/pet', 'exact'],
    ['https://{{host}}:8443/pet/:id', '/pet/:id', 'param'],
    ['{{baseUrl}}', '/', 'exact'],
    // Already a path.
    ['/pet/{id}', '/pet/:id', 'param'],
    ['/pet/:id', '/pet/:id', 'param'],
    ['/pet', '/pet', 'exact'],
    ['pet/{id}', '/pet/:id', 'param'],
    // No scheme, but clearly a host.
    ['petstore.swagger.io/v2/pet', '/v2/pet', 'exact'],
    ['localhost:3000/pet', '/pet', 'exact'],
    // Query and fragment are not part of what a mock binds.
    ['https://x.test/a?b={{c}}&d=1#frag', '/a', 'exact'],
    ['{{baseUrl}}/a?b=1', '/a', 'exact'],
    ['https://x.test', '/', 'exact'],
    // A `:` that is no path variable.
    ['/a/b:c', '/a/b:c', 'exact'],
  ])('%s → %s (%s)', (url, path, mode) => {
    expect(requestUrlToMockPath(url)).toEqual({ path, mode })
  })

  it.each([[''], ['   '], ['?a=1'], ['#x']])('%j has no path to bind', (url) => {
    expect(requestUrlToMockPath(url)).toBeNull()
  })
})
