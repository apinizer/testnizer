---
name: release-issue-flow
description: End-to-end loop for working the Testnizer release issue tracker — pull open issues from apinizer/testnizer-releases, fix them on a branch here, open a PR, let the issue-sync CI advance the labels, ship a release, and auto-close the issues. Use whenever the user wants to "go through / process / fix the issues", "do an issue sweep", asks about the testnizer-releases issues, the cross-repo PR→merge→release flow, or how issues get closed on release. Do NOT use for a single unrelated code change (just edit + test) or for launching the app (that's launch-testnizer).
---

# Testnizer Release Issue Flow

Testnizer spans **three repos** and the issue tracker is NOT where the code lives:

| Repo | Holds |
|---|---|
| `apinizer/testnizer` | **code + PRs + tags** (this repo) |
| `apinizer/testnizer-releases` | **issues** + published release artifacts (no code) |
| `apinizer/testnizer-website` | Astro site (www.testnizer.com), changelog, download links |

Because issues are cross-repo, GitHub's native `Fixes #N` can't reach them. The
`issue-sync.yml` workflow in this repo bridges it via `RELEASE_TOKEN`. The whole
point of this skill: **don't re-derive the loop each time.**

## Issue lifecycle (labels in testnizer-releases)

`status:triage` → `status:in-progress` → `status:in-review` (PR open) →
`status:needs-verification` (merged to main) → `status:released` (shipped, then closed).
The CI moves the last three automatically; you set triage/in-progress.

## Invocation forms

- `/release-issue-flow` — full loop: triage → fix → PR.
- `/release-issue-flow triage-only` — just list + group the open issues, no fixes.
- `/release-issue-flow release <tag>` — cut a release for already-merged fixes (Step 4).

---

## Step 1 — Triage (GitHub → here)

```bash
gh issue list --repo apinizer/testnizer-releases --state open --limit 100 \
  --json number,title,labels --jq 'sort_by(.number)|.[]|"\(.number)\t\(.title)"'
# Pull full bodies when working a batch:
for n in <nums>; do gh issue view "$n" --repo apinizer/testnizer-releases --json number,title,body,comments; done
```

Group issues by **subsystem** (request/engine, SOAP, mock, import/export, branch,
nav/header, env, packaging/update), not by issue number — related issues usually
share a root cause and a file. Fan out read-only `Explore`/`general-purpose`
subagents per group to map `root cause + file:line + minimal fix` before editing.

## Step 2 — Fix on a branch (here → GitHub)

1. Branch off `main`: `git checkout -b fix/<sweep-or-issue>`.
2. Per subsystem group: read → root-cause → **minimal** fix → typecheck → targeted test → commit.
3. **Native ABI gotcha:** `npm run test:unit` flips better-sqlite3 to node ABI via its
   pretest hook. If you call `npx vitest` directly it skips that — run
   `node scripts/ensure-native-abi.js node` first, or just use `npm run test:unit`.
4. Add an automated test for every **logic-level** fix (engine/store/handler/pure fn).
   UI-only behavior (cursor, menus, modals, caret, toasts) is verified manually/E2E —
   don't fake a unit test for it. New DB columns must be mirrored in
   `tests/main/handlers/helpers.ts` `createTestDb()` (ALTERs don't run there).
5. **Commit/PR ref convention (critical):** reference release issues as
   `apinizer/testnizer-releases#N` (NOT bare `#N` — that means an issue in THIS repo).
   The release auto-close scans commit/PR text for this exact form.
6. Commit messages: end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
   **Don't put backticks in `git commit -m`** — the zsh shell evaluates them
   (`command not found`); use plain text or a heredoc body.
7. Comment the fix on each issue as you finish a group (commit autonomy is standing
   for testnizer/website — see memory). Leave issues OPEN; they close on release.

## Step 3 — PR + the issue-sync CI

```bash
git push -u origin <branch>
gh pr create --repo apinizer/testnizer --base main --head <branch> \
  --title "..." --body-file <body>   # body MUST list every apinizer/testnizer-releases#N
```

`.github/workflows/issue-sync.yml` then runs automatically:
- **PR opened/edited** → comments each referenced issue + label `status:in-review`.
- **PR merged to main** → comments "merged (sha), pending release" + `status:needs-verification`.

> First-PR caveat: `pull_request` jobs use the workflow from `main`, so until
> issue-sync.yml is on main it won't fire for that PR — set the labels manually:
> `for n in <nums>; do gh issue edit "$n" --repo apinizer/testnizer-releases --add-label status:in-review; done`

## Step 4 — Release (`/release-issue-flow release <tag>`)

Order matters (see the release-notes memory rule):
1. **Website changelog first** — add the `## vX.Y.Z` block to
   `apinizer/testnizer-website` `src/content/docs/changelog.md` (+ TR mirror) and bump
   the `FALLBACK` in `src/lib/latest-release.ts` to the new tag. Merge it BEFORE tagging.
2. Bump `package.json` version; commit.
3. Tag + push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `build.yml` (6-platform matrix) builds + `--publish always` to testnizer-releases,
   pulls the changelog block into the release body, and dispatches a website rebuild.
5. `issue-sync.yml` `released` job: scans commits since the previous tag for
   `apinizer/testnizer-releases#N`, comments "🚀 Released in vX.Y.Z", labels
   `status:released`, and **closes** them.
6. Re-run failed matrix jobs with `gh run rerun <id> --failed` (the electron-builder
   publish race + GitHub-billing gotchas are documented in CLAUDE.md / memory).

Manual fallback if the auto-close is wrong: `gh workflow run issue-sync.yml --repo apinizer/testnizer -f tag=vX.Y.Z`.

## Step 5 — Verify

Re-test the shipped build against the issues (especially core-system / env-dependent
ones: multi-project tabs, branch isolation, Windows installer, macOS auto-update,
git clone). Reopen any that regressed.

## Reference

- Labels: `status:{triage,in-progress,in-review,needs-verification,released}` (testnizer-releases).
- CI: `.github/workflows/issue-sync.yml` (this skill's automation), `build.yml` (release).
- Token: `RELEASE_TOKEN` (cross-repo, needs `issues:write` on testnizer-releases).
- macOS auto-update can't self-update an ad-hoc/unsigned build (#34 class) — proper
  fix needs Apple signing+notarize; otherwise surface a manual-download link.
