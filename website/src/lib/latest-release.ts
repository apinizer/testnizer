/**
 * Build-time fetch of the latest Testnizer release. Astro evaluates this at
 * build time, so the generated HTML embeds whatever the GitHub API returned at
 * deploy time.
 *
 * Repo consolidation: releases (including the re-hosted v1.4.x assets) now live
 * in the monorepo `apinizer/testnizer`. The legacy `apinizer/testnizer-releases`
 * repo has been retired, so it's no longer probed.
 *
 * Behaviour:
 * - Tries the unauthenticated API; if `GITHUB_TOKEN` is in env (CI) it uses it
 *   to dodge the 60/hr anonymous rate limit.
 * - On any failure (offline build, rate limit, schema drift) returns FALLBACK
 *   so the site still builds. The fallback values are pinned to a known-good
 *   release and updated in lockstep with package bumps.
 */

/** Probed in order — first repo with a usable release wins. */
const REPOS = ['apinizer/testnizer'] as const

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

/** Aggregate counters rendered as the homepage badges (self-hosted — no shields.io). */
export interface RepoStats {
  /** Total asset download count, summed across all releases of all repos. */
  downloads: number
  /** Stargazers, summed across the repos. */
  stars: number
}

const FALLBACK: LatestRelease = {
  tag: 'v1.4.30',
  version: '1.4.30',
  htmlUrl: 'https://github.com/apinizer/testnizer/releases/latest',
  publishedAt: null,
  assets: [],
  byName: {},
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'testnizer-website-build',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

let cached: LatestRelease | null = null

async function fetchReleaseFrom(repo: string): Promise<LatestRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: ghHeaders(),
  })
  if (!res.ok) {
    // 404 = no release published in this repo yet — a normal "fall through",
    // not an error worth logging loudly.
    if (res.status !== 404) {
      // eslint-disable-next-line no-console
      console.warn(`[latest-release] ${repo}: GitHub API ${res.status}`)
    }
    return null
  }
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

  return { tag, version, htmlUrl: data.html_url, publishedAt: data.published_at, assets, byName }
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  if (cached) return cached

  try {
    for (const repo of REPOS) {
      const rel = await fetchReleaseFrom(repo)
      // A monorepo "release" with zero downloadable assets isn't a real release
      // yet (e.g. a draft/notes-only tag) — keep probing the next repo.
      if (rel && rel.assets.length > 0) {
        cached = rel
        return cached
      }
    }
    throw new Error('no release with assets in any repo')
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

let cachedStats: RepoStats | null = null

/**
 * Self-hosted download + star counters. We fetch and sum these at build time
 * with our own GITHUB_TOKEN instead of leaning on shields.io, which throws a
 * transient "Unable to select next GitHub token from pool" under load. Loops
 * REPOS so it stays correct if more sources are ever added back.
 *
 * Returns null on any failure so the caller can drop the badges rather than
 * render a wrong number.
 */
export async function fetchRepoStats(): Promise<RepoStats | null> {
  if (cachedStats) return cachedStats
  try {
    let downloads = 0
    let stars = 0
    for (const repo of REPOS) {
      // Stars.
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders() })
      if (repoRes.ok) {
        const r = (await repoRes.json()) as { stargazers_count?: number }
        stars += r.stargazers_count ?? 0
      }
      // Download totals across every release's assets (paginated, 100/page).
      for (let page = 1; page <= 5; page++) {
        const relRes = await fetch(
          `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
          { headers: ghHeaders() },
        )
        if (!relRes.ok) break
        const rels = (await relRes.json()) as { assets?: { download_count?: number }[] }[]
        if (rels.length === 0) break
        for (const rel of rels)
          for (const a of rel.assets ?? []) downloads += a.download_count ?? 0
        if (rels.length < 100) break
      }
    }
    cachedStats = { downloads, stars }
    return cachedStats
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[latest-release] Stats unavailable — ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/** Compact human count: 942 → "942", 1234 → "1.2k", 1500000 → "1.5M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  const m = n / 1_000_000
  return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
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
