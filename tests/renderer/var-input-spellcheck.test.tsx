/**
 * Review item 14 — `VariableAutocompleteInput` passes `spellCheck` /
 * `autoComplete` through; URL inputs (MCP URL, HTTP URL bar) turn both off.
 */
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import VariableAutocompleteInput from '../../src/renderer/components/shared/VariableAutocompleteInput'

afterEach(cleanup)

describe('VariableAutocompleteInput spellCheck / autoComplete', () => {
  it('passes both through to the real <input>', () => {
    render(
      <VariableAutocompleteInput
        value=""
        onChange={() => {}}
        data-testid="v"
        spellCheck={false}
        autoComplete="off"
      />,
    )
    const input = screen.getByTestId('v')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('autocomplete')).toBe('off')
  })

  it('leaves the browser default when not given', () => {
    render(<VariableAutocompleteInput value="" onChange={() => {}} data-testid="v" />)
    expect(screen.getByTestId('v').getAttribute('spellcheck')).toBeNull()
  })
})

void React
