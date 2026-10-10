/**
 * Issue #189 — one max-tokens cap for main and renderer (`src/shared/ai-limits`).
 * Main clamps an IPC payload above the cap; the renderer field must reject the
 * same values with its inline validation, so a value is never accepted in the
 * editor and then silently lowered by main.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { AI_MAX_TOKENS_CAP } from '../../src/shared/ai-limits'
import { isValidMaxTokens, parseMaxTokensInput } from '../../src/renderer/lib/ai-chat-config'
import { useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import AiChatParameters from '../../src/renderer/components/protocols/ai-chat/AiChatParameters'

beforeEach(() => {
  useAiChatStore.setState({ maxTokens: null, temperature: null })
})

afterEach(() => {
  cleanup()
})

describe('issue #189 — max tokens: renderer cap = main cap', () => {
  it('the shared cap is 200 000', () => {
    expect(AI_MAX_TOKENS_CAP).toBe(200_000)
  })

  it('parse / validate: 200 000 accepted, 200 001 rejected', () => {
    expect(parseMaxTokensInput('200000')).toBe(200_000)
    expect(parseMaxTokensInput('200001')).toBeUndefined()
    expect(isValidMaxTokens(200_000)).toBe(true)
    expect(isValidMaxTokens(200_001)).toBe(false)
  })

  it('the field shows invalid for 200 001 (not applied) and accepts 200 000', () => {
    render(<AiChatParameters />)
    const field = screen.getByTestId('ai-max-tokens') as HTMLInputElement
    expect(field.max).toBe(String(AI_MAX_TOKENS_CAP))

    fireEvent.change(field, { target: { value: '200001' } })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Invalid value — not applied.')).toBeTruthy()
    expect(useAiChatStore.getState().maxTokens).toBeNull()

    fireEvent.change(field, { target: { value: '200000' } })
    expect(field.getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByText('Invalid value — not applied.')).toBeNull()
    expect(useAiChatStore.getState().maxTokens).toBe(200_000)
  })

  it('setMaxTokens never keeps a value above the cap', () => {
    useAiChatStore.getState().setMaxTokens(AI_MAX_TOKENS_CAP + 1)
    expect(useAiChatStore.getState().maxTokens).toBeNull()
  })
})
