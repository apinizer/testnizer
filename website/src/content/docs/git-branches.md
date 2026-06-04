---
title: Git integration
description: Branch collections per feature, review API changes in pull requests, and keep credentials out of git history.
order: 7
section: Guides
---

## Why git for API collections?

API collections change over time — endpoints get added, parameters shift, auth headers are updated. Without version control, those changes are invisible to the rest of the team until something breaks.

Git gives you a structured history of every change, along with the context of who made it and why.

Practical reasons to connect your collections to git:

- **Team visibility.** When a teammate adds a SOAP header to an endpoint, you see the change in the next pull. No Slack message required.
- **PR-based review.** Reviewers can see exactly which endpoint params changed, what the new request body looks like, and whether tests were updated alongside.
- **Pre-production testing.** Keep experimental collections on a feature branch. Merge to `main` only after the changes are validated.
- **Compliance and audit trail.** Every commit records who changed what and when. This matters in regulated environments — banking, insurance, public sector.

---

## Connecting a project to a git repository

1. Open the sidebar and click the project name.
2. Go to **Settings → Git**.
3. Click **Link to git repository**.
4. Either select a local directory or paste a `git clone` URL.

Testnizer uses the [`simple-git`](https://github.com/steveukx/git-js) npm package internally. All git operations run in the main process — you are not dropped into a terminal.

Remote hosts supported out of the box: GitHub, GitLab, Bitbucket, self-hosted Gitea, and any standard Git server over HTTPS or SSH.

---

## Branch per project

Each Testnizer project maps to a single git branch. This keeps collection history clean and makes branch-based workflows natural.

Example setup for a payments API project:

| Branch | Purpose |
|---|---|
| `main` | Production collection — stable, reviewed |
| `feature/payment-v2` | New endpoint experiments |
| `fix/auth-header` | Auth header correction under review |

Switch branches from the **branch selector** in the sidebar. No terminal required. Testnizer checks out the selected branch and loads the corresponding collection state automatically.

---

## Committing collection changes

Changes you make inside Testnizer — adding or removing endpoints, updating parameters, editing request bodies — are tracked automatically.

The **git badge** at the top of the sidebar shows the number of uncommitted changes. When you are ready to save:

1. Click the badge or open **Git → Commit**.
2. Review the diff summary.
3. Write a commit message (for example: `add invoice status endpoint`).
4. Click **Commit**.

The commit is created in the local repository. Push to the remote from the same panel when you are ready to share.

---

## Pull request workflow

When you open a pull request on GitHub, GitLab, or Bitbucket, the collection diff is part of the changeset — the same as any other file in the repo.

Reviewers can see:

- Which endpoints were added, modified, or removed.
- How the JSON request body changed between revisions.
- What new headers or query parameters were introduced.
- Whether pre-request scripts or test assertions were updated.

This makes API changes a first-class part of code review rather than something that lives only in someone's local Testnizer instance.

---

## Keeping secrets out of git

Credentials — API tokens, passwords, client secrets — are stored as **environment variables**, not inside the collection itself. Testnizer resolves `{{MY_TOKEN}}` at request time using the active environment.

Still, it is important to make sure sensitive files are excluded from git entirely. Add the following to your project's `.gitignore`:

```gitignore
# Testnizer — don't commit user data or secrets
data.db
secrets/
*.db-wal
*.db-shm
settings.json
```

`data.db` is the local SQLite database that stores your environment values, history, and cached responses. It should never be committed.

Only collection definition files — endpoints, schemas, components — belong in git.

---

## Merge conflicts

If two team members edit the same endpoint on different branches, a merge conflict will occur when those branches are combined.

Testnizer presents the conflict as a **JSON diff** inside the Workbench. You can see both versions side by side, choose which changes to keep, and edit the result directly. Once resolved, Testnizer saves the merged state and marks the conflict as resolved in git.

You do not need to leave the application to handle conflicts.
