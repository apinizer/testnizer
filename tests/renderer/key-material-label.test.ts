/**
 * The chip that tells you WHICH key a security tool is about to use.
 *
 * `MaterialSource` is opaque by design — it stores ids, never names or key
 * bytes — so the friendly label ("keystore 'prod' › client1") only exists at
 * pick time, in component state. Anything that remounts the field (reopening
 * the tab, switching protocols, restoring a persisted config) loses it and
 * falls back to `describeSource`, which without help can only print the raw
 * UUID. A user who has just saved a keystore then reads
 * `keystore '70683c1c-…' › test` and reasonably concludes something broke.
 *
 * These pin the resolver contract: with a lookup, names; without one, the id
 * (never a crash, never an empty chip); and resolution stays LIVE, so a
 * renamed keystore shows its new name rather than a stale copy.
 */
import { describe, it, expect } from 'vitest'
import { describeSource } from '../../src/renderer/lib/key-material'
import type { MaterialSource } from '../../src/renderer/types'

const KS_ID = '70683c1c-5658-464d-8d19-3ff999f8b7a9'
const CERT_ID = 'c0ffee00-1111-2222-3333-444455556666'

const keystoreSource: MaterialSource = { kind: 'keystore', keystoreId: KS_ID, alias: 'test' }
const certSource: MaterialSource = { kind: 'certRow', certificateId: CERT_ID }

describe('describeSource — human labels for opaque sources', () => {
  it('names the keystore when a resolver is supplied', () => {
    const label = describeSource(keystoreSource, {
      keystoreName: (id) => (id === KS_ID ? 'prod-store' : undefined),
    })
    expect(label).toBe("keystore 'prod-store' › test")
    expect(label).not.toContain(KS_ID)
  })

  it('falls back to the id rather than showing nothing', () => {
    expect(describeSource(keystoreSource)).toBe(`keystore '${KS_ID}' › test`)
    expect(describeSource(keystoreSource, { keystoreName: () => undefined })).toBe(
      `keystore '${KS_ID}' › test`,
    )
  })

  it('resolves a project certificate by host', () => {
    expect(describeSource(certSource, { certHost: (id) => (id === CERT_ID ? 'api.acme.com' : undefined) })).toBe(
      'certificate api.acme.com',
    )
    expect(describeSource(certSource)).toBe(`certificate ${CERT_ID}`)
  })

  it('resolves live, so a rename is reflected immediately', () => {
    let name = 'old-name'
    const label = () => describeSource(keystoreSource, { keystoreName: () => name })
    expect(label()).toBe("keystore 'old-name' › test")
    name = 'new-name'
    expect(label()).toBe("keystore 'new-name' › test")
  })

  it('leaves the non-keystore paths — the defaults — alone', () => {
    expect(describeSource({ kind: 'inline' } as MaterialSource)).toBe('pasted PEM')
    expect(describeSource({ kind: 'file', pfxPath: '/tmp/client.p12' } as MaterialSource)).toBe(
      '/tmp/client.p12',
    )
    expect(describeSource(null)).toBe('')
    expect(describeSource(undefined)).toBe('')
  })

  it('never leaks a secret into the label', () => {
    const withSecrets = {
      kind: 'keystore',
      keystoreId: KS_ID,
      alias: 'test',
      storePassword: 'super-secret',
      keyPassword: 'also-secret',
    } as MaterialSource
    const label = describeSource(withSecrets, { keystoreName: () => 'prod-store' })
    expect(label).not.toContain('super-secret')
    expect(label).not.toContain('also-secret')
  })
})
