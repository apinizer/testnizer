/**
 * The two request-body pickers name the project, so a real pick can be consent
 * (`dialog:openFile`).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KeyValueTable from '../../src/renderer/components/shared/KeyValueTable'
import BodyTab from '../../src/renderer/components/request/BodyTab'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { KeyValuePair } from '../../src/renderer/types'
import { NO_PROJECT_SETTINGS_SCOPE } from '../../src/shared/request-settings'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

const openFile = vi.fn(async () => ({
  success: true,
  data: { filePath: '/picked/file.bin', fileName: 'file.bin', size: 1 },
}))

beforeEach(() => {
  openFile.mockClear()
  ;(window as unknown as { api: unknown }).api = { dialog: { openFile } }
  useWorkspaceStore.setState({ activeProjectId: 'p1' })
})

afterEach(cleanup)

describe('request body pickers pass the active project', () => {
  it('form-data picker', async () => {
    const onUpdate = vi.fn()
    const row: KeyValuePair = { id: 'r', key: 'f', value: '', enabled: true, type: 'file' }
    render(
      <KeyValueTable
        rows={[row]}
        onUpdate={onUpdate}
        onRemove={() => undefined}
        onAdd={() => undefined}
        enableFileType
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /choose file/i }))
    await waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
    expect(openFile.mock.calls[0]).toEqual([
      expect.objectContaining({ requestBodyProjectId: 'p1' }),
    ])
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('binary picker', async () => {
    useRequestStore.setState({ body: { type: 'binary' } })
    render(<BodyTab />)
    fireEvent.click(screen.getByRole('button', { name: /select file/i }))
    await waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
    expect(openFile.mock.calls[0]).toEqual([
      expect.objectContaining({ requestBodyProjectId: 'p1' }),
    ])
  })

  it('no active project uses the Quick Test scope, so the pick still counts', async () => {
    useWorkspaceStore.setState({ activeProjectId: null })
    useRequestStore.setState({ body: { type: 'binary' } })
    render(<BodyTab />)
    fireEvent.click(screen.getByRole('button', { name: /select file/i }))
    await waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
    expect(openFile.mock.calls[0]).toEqual([
      expect.objectContaining({ requestBodyProjectId: NO_PROJECT_SETTINGS_SCOPE }),
    ])
  })
})
