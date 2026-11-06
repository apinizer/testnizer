/**
 * The `window.api` slice "Create mock server from folder" uses, over the REAL
 * IPC handlers of a test harness. Unit tests of that flow stubbed this bridge
 * with tidy rows; going through the handlers keeps the row shape and the
 * repository's order (docs/e2e/test-rules.md, rule 2).
 */
import { createServer } from 'node:net'
import type { MockFromFolderApi } from '../../../src/renderer/components/mock/mock-from-folder'
import type { HandlerHarness } from './helpers'

export function realMockFromFolderApi(harness: HandlerHarness): MockFromFolderApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    harness.invoke(channel, ...args) as Promise<T>
  return {
    mock: {
      server: {
        list: (projectId) => call('mock:server:list', projectId),
        create: (input) => call('mock:server:create', input),
        delete: (id) => call('mock:server:delete', id),
      },
      endpoint: { create: (input) => call('mock:endpoint:create', input) },
      response: { create: (input) => call('mock:response:create', input) },
    },
    endpoint: { get: (id) => call('endpoint:get', id) },
    savedRequest: { get: (id) => call('savedRequest:get', id) },
    savedResponse: { list: (type, id) => call('savedResponse:list', type, id) },
  }
}

export function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}
