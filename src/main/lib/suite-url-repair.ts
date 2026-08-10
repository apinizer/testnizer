/**
 * Put back the `{{variable}}` prefix that suite items lost when they were
 * created (reported 30 July, again on 4 August for suites already on disk).
 *
 * `snapshotEndpointForSuite` used to read `endpoints.path` — the path alone —
 * instead of `request_schema.url`, which is where an importer keeps the whole
 * address. "Create Test Suite from this folder" therefore produced items whose
 * URL was `/test/healthcheck` rather than `{{AccessURL}}/test/healthcheck`, and
 * nothing in the suite ran without being edited by hand first.
 *
 * The creation-time bug is fixed, so NEW suites are correct. Two populations
 * are not, and both need this rule:
 *
 *   1. Suites already on disk — repaired once, by the startup migration.
 *   2. Suites arriving from an EXPORT taken on a build that still had the bug.
 *      The import copies `url` verbatim, so it faithfully reproduces the
 *      truncation. That is why this lives in its own module instead of inside
 *      the migration: one rule, applied at both doors, so a re-import cannot
 *      quietly reintroduce what the migration just fixed.
 *
 * Neither case needs the source endpoint: the same snapshot wrote the FULL url
 * into the item's own `request_schema`, and only the `url` column was cut.
 */

/**
 * The URL a suite item should carry, or `null` when it should be left alone.
 *
 * The signature is deliberately narrow, because this rewrites user data:
 *
 *   - the schema URL is a non-empty string that differs from the stored one,
 *   - the stored URL is exactly its TAIL, and
 *   - the part that went missing contains `{{`.
 *
 * That is precisely "a variable prefix was dropped". A URL somebody shortened
 * on purpose (say `https://api.example.com/health` → `/health`) does not match,
 * because nothing containing `{{` was lost. Applying it twice is a no-op: a
 * repaired row no longer differs from its schema URL.
 */
export function repairedSuiteItemUrl(
  storedUrl: string | null | undefined,
  requestSchema: string | null | undefined,
): string | null {
  const stored = storedUrl ?? ''
  if (stored === '' || !requestSchema) return null

  let schemaUrl: unknown
  try {
    schemaUrl = (JSON.parse(requestSchema) as { url?: unknown }).url
  } catch {
    return null
  }
  if (typeof schemaUrl !== 'string' || schemaUrl === '' || schemaUrl === stored) return null
  if (!schemaUrl.endsWith(stored)) return null

  const lostPrefix = schemaUrl.slice(0, schemaUrl.length - stored.length)
  if (!lostPrefix.includes('{{')) return null

  return schemaUrl
}
