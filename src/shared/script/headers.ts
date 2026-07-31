/**
 * Case-insensitive header collection backing `pm.request.headers`.
 *
 * Lived in the renderer's `test-runner.ts`, which main cannot import — so the
 * Runner's `pm.request` was a stub (`{ method: '', url: '', headers: {} }`) and
 * a script's `pm.request.headers.upsert(...)` simply vanished on the Run path
 * while working on Send. That is the Send/Run divergence `src/shared/script/`
 * exists to prevent, so the class lives here and both paths use this one.
 */
export interface HeaderEntry {
  key: string
  value: string
}

export class HeaderCollection {
  private store: Map<string, HeaderEntry> = new Map()

  constructor(initial?: HeaderEntry[] | Record<string, string>) {
    if (!initial) return
    if (Array.isArray(initial)) {
      for (const h of initial) {
        if (h && h.key) this.upsert(h)
      }
    } else {
      for (const [k, v] of Object.entries(initial)) {
        if (k) this.upsert({ key: k, value: v })
      }
    }
  }

  get(name: string): string | undefined {
    return this.store.get(name.toLowerCase())?.value
  }

  has(name: string): boolean {
    return this.store.has(name.toLowerCase())
  }

  add(h: HeaderEntry): void {
    // Postman semantics: add overwrites if present (its HeaderList allows
    // duplicates but most scripts use it interchangeably with upsert). We
    // pick upsert behaviour to stay aligned with case-insensitive single-
    // value HTTP header expectations on the wire.
    this.upsert(h)
  }

  upsert(h: HeaderEntry): void {
    if (!h || !h.key) return
    this.store.set(h.key.toLowerCase(), { key: h.key, value: h.value ?? '' })
  }

  remove(name: string): void {
    this.store.delete(name.toLowerCase())
  }

  each(fn: (h: HeaderEntry) => void): void {
    for (const entry of this.store.values()) fn(entry)
  }

  toArray(): HeaderEntry[] {
    return Array.from(this.store.values())
  }

  toJSON(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const entry of this.store.values()) out[entry.key] = entry.value
    return out
  }
}
