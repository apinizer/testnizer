/**
 * "New mock server" dialog, Import option (issue #319): a mock can start from
 * an OpenAPI or Postman file, and a bad file or a failed import leaves nothing
 * behind. The Endpoints tab import reports the same way.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { calls, httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge } from './mock-mcp-bridge-stub'
import NewMockServerModal from '../../src/renderer/components/mock/NewMockServerModal'
import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import { toast } from '../../src/renderer/lib/toast'

void React

const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Pet Store', version: '1' },
  paths: { '/pets': { get: {}, post: {} } },
})
const COLLECTION = JSON.stringify({
  info: {
    name: 'Shop',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [{ name: 'a', request: { method: 'GET', url: '/a' } }],
})
const IMPORTED = { ok: true, endpointsCreated: 2, responsesCreated: 2, warnings: [] as string[] }

function fileOf(text: string, name = 'spec.json'): File {
  const file = new File([text], name)
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}

const importFn = (fn: ReturnType<typeof vi.fn>, value: unknown): void => {
  fn.mockImplementation(() => Promise.resolve(value))
}

const nameValue = (): string => (screen.getByTestId('mock-new-name') as HTMLInputElement).value

async function pick(text: string, name?: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId('mock-new-import-input'), {
      target: { files: [fileOf(text, name)] },
    })
  })
}

async function clickCreate(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('mock-new-create'))
  })
}

function openOnImport(onClose: () => void = vi.fn()): void {
  render(<NewMockServerModal initialKind="http" onClose={onClose} />)
  fireEvent.click(screen.getByTestId('mock-new-preset-import'))
}

beforeEach(async () => {
  setLocale('en')
  resetHttpBridge([httpServer({ id: 'h1', name: 'Users API', port: 3001 })])
  installBridge([])
  httpBridge.importOpenApi.mockReset()
  httpBridge.importPostman.mockReset()
  importFn(httpBridge.importOpenApi, { success: true, data: IMPORTED })
  importFn(httpBridge.importPostman, { success: true, data: IMPORTED })
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({ servers: [], projectId: null })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  await act(async () => {
    await useMockStore.getState().loadServers('p-1')
  })
  calls.length = 0
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const servers = (): string[] => useMockStore.getState().servers.map((s) => s.name)

describe('New mock server: start from a file', () => {
  it('only the HTTP type offers it, and the file row shows only when it is chosen', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(screen.queryByTestId('mock-new-import')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-new-preset-import'))
    expect(screen.getByTestId('mock-new-import')).toBeInTheDocument()
    for (const kind of ['mcp', 'sse', 'ai']) {
      fireEvent.click(screen.getByTestId(`mock-new-type-${kind}`))
      expect(screen.queryByTestId('mock-new-preset-import')).toBeNull()
      expect(screen.queryByTestId('mock-new-import')).toBeNull()
    }
  })

  it('creates the server, imports into it by detected format and opens its tab', async () => {
    const onClose = vi.fn()
    const success = vi.spyOn(toast, 'success')
    openOnImport(onClose)
    await pick(SPEC)
    expect(screen.getByTestId('mock-new-import-summary')).toHaveTextContent(
      'spec.json · OpenAPI · 2 endpoints',
    )
    await clickCreate()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const created = useMockStore.getState().servers.find((s) => s.name === 'Pet Store')
    expect(created).toBeDefined()
    expect(httpBridge.importOpenApi).toHaveBeenCalledWith(created?.id, SPEC)
    expect(httpBridge.importPostman).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs.map((tab) => tab.name)).toContain('Pet Store')
    expect(success).toHaveBeenCalledWith(expect.stringContaining('2 endpoints'))
  })

  it('routes a Postman collection to the Postman importer', async () => {
    openOnImport()
    await pick(COLLECTION, 'shop.json')
    expect(screen.getByTestId('mock-new-import-summary')).toHaveTextContent('Postman')
    await clickCreate()
    await waitFor(() => expect(httpBridge.importPostman).toHaveBeenCalled())
    expect(httpBridge.importOpenApi).not.toHaveBeenCalled()
  })

  it('the name follows the spec title, stays unique, and never overrides a typed name', async () => {
    openOnImport()
    await pick(JSON.stringify({ ...JSON.parse(SPEC), info: { title: 'Users API' } }))
    expect(nameValue()).toBe('Users API 2')
    await pick(SPEC)
    expect(nameValue()).toBe('Pet Store')
    fireEvent.change(screen.getByTestId('mock-new-name'), { target: { value: 'Mine' } })
    await pick(COLLECTION)
    expect(nameValue()).toBe('Mine')
  })

  it('without a file: says so and creates nothing', async () => {
    openOnImport()
    await clickCreate()
    expect(screen.getByTestId('mock-new-error')).toHaveTextContent(t('mockNew.importRequired'))
    expect(calls).not.toContain('server.create')
  })

  it('a bad file: says why, drops the previous choice and creates nothing', async () => {
    openOnImport()
    await pick(SPEC)
    await pick('{"a":1}', 'other.json')
    expect(screen.getByTestId('mock-new-import-error')).toHaveTextContent(
      t('mockNew.importNotRecognised'),
    )
    expect(screen.queryByTestId('mock-new-import-summary')).toBeNull()
    expect(nameValue()).toBe('Mock Server')
    await clickCreate()
    expect(calls).not.toContain('server.create')
    // A good file clears the error.
    await pick(SPEC)
    expect(screen.queryByTestId('mock-new-import-error')).toBeNull()
  })

  it('choosing a file does not start from a template picked afterwards', async () => {
    const onClose = vi.fn()
    openOnImport(onClose)
    await pick(SPEC)
    fireEvent.click(screen.getByTestId('mock-new-preset-blank'))
    expect(nameValue()).toBe('Mock Server')
    await clickCreate()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(httpBridge.importOpenApi).not.toHaveBeenCalled()
  })

  it('leaving the HTTP type forgets the file', async () => {
    openOnImport()
    await pick(SPEC)
    fireEvent.click(screen.getByTestId('mock-new-type-mcp'))
    fireEvent.click(screen.getByTestId('mock-new-type-http'))
    fireEvent.click(screen.getByTestId('mock-new-preset-import'))
    expect(screen.queryByTestId('mock-new-import-summary')).toBeNull()
  })

  it.each([
    [
      'the importer refuses',
      { success: true, data: { ...IMPORTED, ok: false, error: 'No paths' } },
      'No paths',
    ],
    ['the IPC fails', { success: false, error: 'db locked' }, 'db locked'],
    [
      'the import creates nothing',
      { success: true, data: { ...IMPORTED, endpointsCreated: 0 } },
      'This file has no requests to mock.',
    ],
  ])('when %s: no server is left, the dialog stays with the reason', async (_l, reply, reason) => {
    const onClose = vi.fn()
    importFn(httpBridge.importOpenApi, reply)
    openOnImport(onClose)
    await pick(SPEC)
    await clickCreate()

    await waitFor(() => expect(screen.getByTestId('mock-new-error')).toHaveTextContent(reason))
    expect(onClose).not.toHaveBeenCalled()
    expect(calls).toContain('server.delete')
    expect(servers()).toEqual(['Users API'])
    expect(useTabsStore.getState().tabs).toEqual([])
    // Retry works: the name and the port were given back.
    expect(screen.getByTestId('mock-new-create')).not.toBeDisabled()
    importFn(httpBridge.importOpenApi, { success: true, data: IMPORTED })
    await clickCreate()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(servers()).toContain('Pet Store')
  })

  it('a rejected IPC call is handled the same way', async () => {
    httpBridge.importOpenApi.mockImplementation(() => Promise.reject(new Error('crash')))
    openOnImport()
    await pick(SPEC)
    await clickCreate()
    await waitFor(() => expect(screen.getByTestId('mock-new-error')).toHaveTextContent('crash'))
    expect(servers()).toEqual(['Users API'])
  })

  it('Create is locked while the file is being read', async () => {
    let finish: (text: string) => void = () => {}
    const slow = new File(['x'], 'slow.json')
    Object.defineProperty(slow, 'text', {
      value: () => new Promise<string>((resolve) => (finish = resolve)),
    })
    openOnImport()
    await act(async () => {
      fireEvent.change(screen.getByTestId('mock-new-import-input'), { target: { files: [slow] } })
    })
    expect(screen.getByTestId('mock-new-create')).toBeDisabled()
    await act(async () => finish(SPEC))
    expect(screen.getByTestId('mock-new-create')).not.toBeDisabled()
  })
})

describe('Endpoints tab import reports the same way', () => {
  /** Runs the button's file dialog with `file` (the input is created on click). */
  function chooseOnClick(file: File): void {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { value: [file] })
      void this.onchange?.(new Event('change'))
    })
  }

  async function mountEditor(): Promise<void> {
    const server = httpServer({ id: 'h1', name: 'Users API' })
    useMockStore.setState({ servers: [server] })
    await act(async () => {
      render(<MockServerEditor serverId="h1" />)
    })
  }

  async function importWith(file: File): Promise<void> {
    await mountEditor()
    chooseOnClick(file)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-import-openapi'))
    })
  }

  it('shows the error main gave, not a bare failure', async () => {
    const error = vi.spyOn(toast, 'error')
    importFn(httpBridge.importOpenApi, { success: false, error: 'db locked' })
    await importWith(fileOf(SPEC))
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('db locked')))
  })

  it('0 endpoints is not reported as success', async () => {
    const error = vi.spyOn(toast, 'error')
    const success = vi.spyOn(toast, 'success')
    importFn(httpBridge.importOpenApi, {
      success: true,
      data: { ...IMPORTED, endpointsCreated: 0 },
    })
    await importWith(fileOf(SPEC))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(success).not.toHaveBeenCalled()
  })

  it('a file that cannot be read does not leave Importing on screen', async () => {
    const error = vi.spyOn(toast, 'error')
    const broken = new File(['x'], 'gone.json')
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('NotReadableError')),
    })
    await importWith(broken)
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining('NotReadableError')),
    )
    expect(screen.queryByText(t('mock.importing'))).toBeNull()
  })
})
