/**
 * Dialog text was blurry on 1x (non-Retina) monitors: the content box was
 * centred with `translate(-50%, -50%)`, which puts it on its own compositor
 * layer at a half pixel whenever its width / height is odd. It is now
 * centred with `inset-0` + auto margins — no transform at all.
 */
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import Modal, { CENTERED_CONTENT_CLASS } from '../../src/renderer/components/shared/Modal'

afterEach(cleanup)

describe('Modal centring (crisp text on 1x screens)', () => {
  it('centres without a transform', () => {
    render(
      <Modal open onOpenChange={() => {}} title="t" testId="m">
        <div>body</div>
      </Modal>,
    )
    const content = screen.getByTestId('m')
    expect(content.className).toBe(CENTERED_CONTENT_CLASS)
    expect(content.className).not.toMatch(/translate/)
    expect(content.className).toContain('m-auto')
    expect(content.getAttribute('style') ?? '').not.toMatch(/transform/)
  })
})
