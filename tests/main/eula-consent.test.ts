import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock electron — `app.getAppPath()` is referenced from eula-consent.ts.
// We point it at the repo root so `docs/legal/*.md` resolves.
vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getVersion: () => '1.0.3',
  },
}))

import {
  hashDocs,
  hashTexts,
  getConsentState,
  setAccepted,
  clearConsent,
  isConsentValid,
  __setStoreForTesting,
} from '../../src/main/lib/eula-consent'

// ─── In-memory store double ─────────────────────────────────────

interface StoreLike {
  get: (key: string, def?: unknown) => unknown
  set: (key: string, value: unknown) => void
  clear: () => void
}

function makeFakeStore(): StoreLike {
  const data = new Map<string, unknown>()
  return {
    get: (key: string, def?: unknown) => (data.has(key) ? data.get(key) : def),
    set: (key: string, value: unknown) => {
      data.set(key, value)
    },
    clear: () => data.clear(),
  }
}

let fakeStore: StoreLike
beforeEach(() => {
  fakeStore = makeFakeStore()
  __setStoreForTesting(fakeStore)
})

afterEach(() => {
  __setStoreForTesting(null)
})

// ─── hashDocs / hashTexts ───────────────────────────────────────

describe('hashTexts', () => {
  it('produces a stable SHA256 for the same inputs', () => {
    const a = hashTexts('eula body', 'privacy body')
    const b = hashTexts('eula body', 'privacy body')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when EULA text changes', () => {
    const a = hashTexts('eula v1', 'privacy')
    const b = hashTexts('eula v2', 'privacy')
    expect(a).not.toBe(b)
  })

  it('changes when Privacy text changes', () => {
    const a = hashTexts('eula', 'privacy v1')
    const b = hashTexts('eula', 'privacy v2')
    expect(a).not.toBe(b)
  })

  it('treats null / empty as the empty string', () => {
    const a = hashTexts('', '')
    const b = hashTexts(null as unknown as string, undefined as unknown as string)
    expect(a).toBe(b)
  })
})

describe('hashDocs', () => {
  it('reads the bundled docs and produces a deterministic hash', () => {
    const a = hashDocs()
    const b = hashDocs()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches hashTexts when fed the same on-disk content', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = process.cwd()
    const eula = fs.readFileSync(path.join(root, 'docs/legal/eula.md'), 'utf8')
    const privacy = fs.readFileSync(path.join(root, 'docs/legal/privacy-policy.md'), 'utf8')
    expect(hashDocs()).toBe(hashTexts(eula, privacy))
  })
})

// ─── getConsentState / setAccepted / clearConsent ───────────────

describe('getConsentState', () => {
  it('returns the empty state when nothing is persisted', async () => {
    const s = await getConsentState()
    expect(s).toEqual({
      accepted: false,
      acceptedAt: 0,
      acceptedVersion: '',
      acceptedDocsHash: '',
    })
  })

  it('returns the empty state when the persisted blob is corrupt', async () => {
    fakeStore.set('consent', 'not-an-object')
    const s = await getConsentState()
    expect(s.accepted).toBe(false)
  })

  it('returns the empty state when accepted is not boolean', async () => {
    fakeStore.set('consent', { accepted: 'yes', acceptedAt: 0 })
    const s = await getConsentState()
    expect(s.accepted).toBe(false)
  })

  it('coerces missing fields to defaults', async () => {
    fakeStore.set('consent', { accepted: true })
    const s = await getConsentState()
    expect(s.accepted).toBe(true)
    expect(s.acceptedAt).toBe(0)
    expect(s.acceptedVersion).toBe('')
    expect(s.acceptedDocsHash).toBe('')
  })

  it('returns the empty state when the store throws', async () => {
    __setStoreForTesting({
      get: () => {
        throw new Error('boom')
      },
      set: () => {},
      clear: () => {},
    })
    const s = await getConsentState()
    expect(s.accepted).toBe(false)
  })
})

describe('setAccepted', () => {
  it('persists version + hash + timestamp', async () => {
    const before = Date.now()
    const next = await setAccepted('1.2.3', 'h'.repeat(64))
    expect(next.accepted).toBe(true)
    expect(next.acceptedVersion).toBe('1.2.3')
    expect(next.acceptedDocsHash).toBe('h'.repeat(64))
    expect(next.acceptedAt).toBeGreaterThanOrEqual(before)

    const reread = await getConsentState()
    expect(reread).toEqual(next)
  })
})

describe('clearConsent', () => {
  it('reverts a previous acceptance back to the empty state', async () => {
    await setAccepted('1.0.0', 'a'.repeat(64))
    await clearConsent()
    const s = await getConsentState()
    expect(s.accepted).toBe(false)
  })
})

// ─── isConsentValid (re-consent on hash drift) ──────────────────

describe('isConsentValid', () => {
  const baseHash = 'a'.repeat(64)

  it('is false when accepted is false', () => {
    expect(
      isConsentValid(
        { accepted: false, acceptedAt: 0, acceptedVersion: '', acceptedDocsHash: '' },
        baseHash,
      ),
    ).toBe(false)
  })

  it('is false when no hash was recorded', () => {
    expect(
      isConsentValid(
        { accepted: true, acceptedAt: 1, acceptedVersion: '1.0.0', acceptedDocsHash: '' },
        baseHash,
      ),
    ).toBe(false)
  })

  it('is true when accepted hash matches current hash', () => {
    expect(
      isConsentValid(
        {
          accepted: true,
          acceptedAt: 1,
          acceptedVersion: '1.0.0',
          acceptedDocsHash: baseHash,
        },
        baseHash,
      ),
    ).toBe(true)
  })

  it('is false when docs hash drifts (re-consent needed)', () => {
    expect(
      isConsentValid(
        {
          accepted: true,
          acceptedAt: 1,
          acceptedVersion: '1.0.0',
          acceptedDocsHash: baseHash,
        },
        'b'.repeat(64),
      ),
    ).toBe(false)
  })
})

// ─── End-to-end: accept → drift → re-prompt ─────────────────────

describe('end-to-end accept + hash drift', () => {
  it('treats consent as invalid when docs change after acceptance', async () => {
    await setAccepted('1.0.0', hashDocs())
    const s1 = await getConsentState()
    expect(isConsentValid(s1, hashDocs())).toBe(true)

    // Simulate a docs update by hashing a different text.
    const newHash = hashTexts('updated-eula', 'updated-privacy')
    expect(isConsentValid(s1, newHash)).toBe(false)
  })
})
