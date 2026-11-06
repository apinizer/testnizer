/**
 * The Runner's data file picker: what a file produces reaches the run, and what
 * is wrong with a file reaches the user under the picker. Dropping back to a
 * single iteration without a word is the one outcome a bad file must not have.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import RunnerConfig from '../../src/renderer/components/runner/RunnerConfig'
import { MAX_ITERATION_FILE_BYTES } from '../../src/renderer/lib/iteration-data'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const noop = (): void => {}

/** What the picker uses of a File; jsdom's own File has no `text()`. */
function fileOf(name: string, content: string, size = content.length) {
  return { name, size, text: vi.fn(async () => content) }
}

function renderPicker() {
  const setIterationData = vi.fn()
  render(
    <RunnerConfig
      delay={0}
      setDelay={noop}
      iterationDelay={0}
      setIterationDelay={noop}
      iterations={1}
      setIterations={noop}
      environmentId=""
      setEnvironmentId={noop}
      stopOnError
      setStopOnError={noop}
      persistResponses
      setPersistResponses={noop}
      keepVariableValues
      setKeepVariableValues={noop}
      iterationData={[]}
      setIterationData={setIterationData}
      runPreScript=""
      setRunPreScript={noop}
      runPostScript=""
      setRunPostScript={noop}
      runFailScript=""
      setRunFailScript={noop}
      onRun={noop}
      onSchedule={noop}
      isRunning={false}
      selectedCount={2}
      canSchedule
      onSaveConfig={async () => true}
    />,
  )
  return setIterationData
}

/** Press the button and hand the hidden file input `file`, as the OS dialog would. */
async function pick(file: ReturnType<typeof fileOf>): Promise<void> {
  const realCreate = document.createElement.bind(document)
  let input: HTMLInputElement | undefined
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag)
    if (tag === 'input') {
      input = el as HTMLInputElement
      vi.spyOn(input, 'click').mockImplementation(() => {})
    }
    return el
  })
  fireEvent.click(screen.getByRole('button', { name: 'Select Data File…' }))
  spy.mockRestore()
  Object.defineProperty(input, 'files', { value: [file] })
  await act(async () => {
    await input?.onchange?.(new Event('change'))
  })
}

beforeEach(() => {
  useUIStore.getState().setLocale('en')
})

afterEach(cleanup)

describe('the data file picker', () => {
  it('a semicolon CSV with a BOM gives its rows to the run', async () => {
    const setIterationData = renderPicker()
    await pick(fileOf('data.csv', '\uFEFFid;tutar\n1;12,50\n'))
    expect(setIterationData).toHaveBeenLastCalledWith([{ id: '1', tutar: '12,50' }])
  })

  it('an empty JSON array says so instead of running once', async () => {
    const setIterationData = renderPicker()
    await pick(fileOf('data.json', '[]'))
    expect(screen.getByText(/The JSON array has no rows/)).toBeInTheDocument()
    expect(setIterationData).toHaveBeenLastCalledWith([])
  })

  it('a broken CSV shows the reason', async () => {
    renderPicker()
    await pick(fileOf('data.csv', 'a,b\n1,"open\n'))
    expect(screen.getByText(/The CSV file could not be read/)).toBeInTheDocument()
  })

  it('an oversized file is refused without being read', async () => {
    const setIterationData = renderPicker()
    const file = fileOf('data.csv', 'a\n1\n', MAX_ITERATION_FILE_BYTES + 1)
    await pick(file)
    expect(file.text).not.toHaveBeenCalled()
    expect(screen.getByText(/larger than the 50 MB limit/)).toBeInTheDocument()
    expect(setIterationData).toHaveBeenLastCalledWith([])
  })
})
