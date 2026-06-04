/**
 * Build-time fetch of the latest Testnizer release from
 * apinizer/testnizer-releases. Astro evaluates this at build time, so the
 * generated HTML embeds whatever the GitHub API returned at deploy time.
 *
 * Behaviour:
 * - Tries the unauthenticated API; if `GITHUB_TOKEN` is in env (CI) it uses it
 *   to dodge the 60/hr anonymous rate limit.
 * - On any failure (offline build, rate limit, schema drift) returns FALLBACK
 *   so the site still builds. The fallback values are pinned to a known-good
 *   release and updated in lockstep with package bumps.
 */
const REPO = 'apinizer/testnizer-releases'
const API = `https://api.github.com/repos/${REPO}/releases/latest`

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface LatestRelease {
  /** e.g. "v1.2.0" — always with leading "v". */
  tag: string
  /** e.g. "1.2.0" — without the leading "v". */
  version: string
  htmlUrl: string
  publishedAt: string | null
  /** All non-blockmap, non-yml assets (i.e. installers + zips users care about). */
  assets: ReleaseAsset[]
  /** Convenience map keyed by asset name — useful for the download page. */
  byName: Record<string, ReleaseAsset>
}

const FALLBACK: LatestRelease = {
  tag: 'v1.4.10',
  version: '1.4.10',
  htmlUrl: `https://github.com/${REPO}/releases/latest`,
  publishedAt: null,
  assets: [],
  byName: {},
}

let cached: LatestRelease | null = null

export async function fetchLatestRelease(): Promise<LatestRelease> {
  if (cached) return cached

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'testnizer-website-build',
    }
    const token = process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(API, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      tag_name: string
      html_url: string
      published_at: string | null
      assets?: { name: string; browser_download_url: string; size: number }[]
    }

    const rawAssets = data.assets ?? []
    // Hide blockmaps + electron-updater metadata from the download UI.
    const assets: ReleaseAsset[] = rawAssets
      .filter((a) => !a.name.endsWith('.blockmap'))
      .filter((a) => !a.name.endsWith('.yml'))
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))

    const byName: Record<string, ReleaseAsset> = {}
    for (const a of assets) byName[a.name] = a

    const tag = data.tag_name
    const version = tag.startsWith('v') ? tag.slice(1) : tag

    cached = {
      tag,
      version,
      htmlUrl: data.html_url,
      publishedAt: data.published_at,
      assets,
      byName,
    }
    return cached
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[latest-release] Falling back to pinned ${FALLBACK.tag} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    cached = FALLBACK
    return FALLBACK
  }
}

/**
 * Resolve a download URL for a given asset, with three layers of fallback:
 *
 *   1. Exact name match (e.g. "Testnizer-1.2.0-arm64.dmg")
 *   2. Pattern match — useful when the upstream filename's version segment
 *      doesn't exactly match what we expect (e.g. dev/canary suffixes).
 *   3. The release page — so the link still goes somewhere meaningful even if
 *      the asset has been pulled.
 */
export function resolveAsset(
  release: LatestRelease,
  match: { exact?: string; pattern?: RegExp },
): { url: string; name: string | null } {
  if (match.exact && release.byName[match.exact]) {
    const a = release.byName[match.exact]
    return { url: a.url, name: a.name }
  }
  if (match.pattern) {
    const hit = release.assets.find((a) => match.pattern!.test(a.name))
    if (hit) return { url: hit.url, name: hit.name }
  }
  return { url: release.htmlUrl, name: null }
}
