/**
 * Shared vocabulary for the JWK tool's four tabs. Pure move out of
 * `JwkTool.tsx`; no behaviour changed.
 */
import type { ReactNode } from 'react'
import type { Jwk } from '../../../lib/tools/jwk'

export type Mode = 'fromPem' | 'toPem' | 'generate' | 'set'

export type Origin = 'pasted' | 'generated' | 'keystore'

export interface KeyEntry {
  id: string
  jwk: Jwk
  origin: Origin
  label: string
}

export interface ModePanes {
  input: ReactNode
  output: ReactNode
}

export type AddKey = (jwk: Jwk, origin: Origin) => void

export const RED = '#cc2200'
export const GREEN = '#1a7a4a'

let entrySeq = 0
export function nextId(): string {
  entrySeq += 1
  return `jwk-${entrySeq}`
}

/**
 * Are these the same key?
 *
 * Compared on canonical JSON — key order in a JWK carries no meaning, so two
 * documents that differ only in field order describe one key and must not both
 * end up in the set.
 */
export function sameJwk(a: Jwk, b: Jwk): boolean {
  const canon = (j: Jwk): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(j as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)),
      ),
    )
  return canon(a) === canon(b)
}

export const SAMPLE_JWK = `{
  "kty": "EC",
  "crv": "P-256",
  "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  "alg": "ES256"
}`
