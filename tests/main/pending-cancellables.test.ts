import { describe, it, expect, vi } from 'vitest'
import { createPendingRegistry } from '../../src/main/lib/pending-cancellables'

describe('createPendingRegistry', () => {
  it('cancels a registered handle and removes it', () => {
    const reg = createPendingRegistry()
    const fn = vi.fn()
    reg.register('a', fn)
    expect(reg.cancel('a')).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
    expect(reg._size()).toBe(0)
  })

  it('returns false for unknown id', () => {
    const reg = createPendingRegistry()
    expect(reg.cancel('missing')).toBe(false)
  })

  it('cancelling the same id twice runs the handle once', () => {
    const reg = createPendingRegistry()
    const fn = vi.fn()
    reg.register('a', fn)
    reg.cancel('a')
    reg.cancel('a')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('register with the same id overwrites the previous handle', () => {
    const reg = createPendingRegistry()
    const first = vi.fn()
    const second = vi.fn()
    reg.register('a', first)
    reg.register('a', second)
    reg.cancel('a')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('dispose removes the handle without invoking it', () => {
    const reg = createPendingRegistry()
    const fn = vi.fn()
    reg.register('a', fn)
    reg.dispose('a')
    expect(fn).not.toHaveBeenCalled()
    expect(reg._size()).toBe(0)
    expect(reg.cancel('a')).toBe(false)
  })

  it('swallows errors thrown by the cancel handle', () => {
    const reg = createPendingRegistry()
    reg.register('a', () => {
      throw new Error('boom')
    })
    expect(() => reg.cancel('a')).not.toThrow()
    expect(reg._size()).toBe(0)
  })

  it('tracks multiple independent handles', () => {
    const reg = createPendingRegistry()
    const fa = vi.fn()
    const fb = vi.fn()
    reg.register('a', fa)
    reg.register('b', fb)
    expect(reg._size()).toBe(2)
    reg.cancel('a')
    expect(fa).toHaveBeenCalledOnce()
    expect(fb).not.toHaveBeenCalled()
    expect(reg._size()).toBe(1)
  })
})
