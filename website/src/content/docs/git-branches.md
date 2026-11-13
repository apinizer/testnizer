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

To start from an existing repository, choose **Clone from Git** when you create a project and fill in the repository URL, branch, username, personal access token (stored encrypted) and a local directory. A project that comes from outside this way runs no script until you allow it on this computer; see [Scripts](/docs/scripts#the-script-runtime).

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

## Branch menu: commit, pull, push, merge

The branch selector opens a menu with **Commit…**, **Pull**, **Push**, **Merge** and
**Discard all changes**, and shows how many commits your branch is **behind** and
**ahead** of the remote (as of the last fetch). A branch that is not on the remote yet
says so.

### Commit

**Commit…** opens the **Commit changes** panel. It lists everything that changed since
the last commit, grouped by kind (folders, endpoints, saved requests, examples,
environments, test suites, mock servers, certificates and so on), each marked **Added**,
**Modified** or **Deleted**.

1. Untick a change to leave it out of this commit; the rest stay in your project as
   uncommitted changes (switching branch or merging commits them automatically; Push asks
   first). A change that depends on another (a request in a new folder)
   brings it along, so a commit never points at something it lacks. The panel says what
   is committed together.
2. Write a commit message.
3. Choose **Commit** (local only) or **Commit and push**.

The remote is updated only when you push. **Discard all changes** returns the project to
the last commit after you confirm how many changes will be lost; this cannot be undone.
While a merge is in progress the panel asks you to resolve or abort it from the branch menu first.

### Push and pull

**Push** asks for a commit message first and tells you how many uncommitted changes it
would include. You can push existing commits only and leave the uncommitted changes where
they are. A push that the server briefly refuses with a 5xx error is retried
automatically; if it still fails, the message says nothing was lost, and pushing again
creates no second commit.

**Pull** brings the **whole project**, not only requests: project-level authentication,
pre-request and test scripts, timeout, SSL, redirect and TLS settings travel with it, so
requests that inherit the project's auth work on the teammate's machine too. A pull tells
you how many secret values are still empty on this computer.

Git error messages follow the interface language.

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

Secret values stay on your machine. Variables marked **secret**, mock server authentication, a Mock MCP bearer token, certificate passphrases and literal credentials in the project's Auth settings are written as **empty values** to every file that goes to Git (a commit, a push, a project file), and a pull never overwrites the value you have locally. Only `{{variable}}` references travel. A certificate whose files or passphrase are not on the computer that pulled it arrives disabled, so it cannot break every request to its host. If an older Testnizer already pushed secrets to a repository, they stay in its history: rotate them.

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

When a merge or pull conflicts in the project file, Testnizer first merges it row by row: additions from both sides are kept, a row only one side changed takes that change, a row both sides changed takes the newer change, and a row one side deleted and the other changed keeps the change. It then commits the merge. A file it cannot merge this way opens a dialog where you pick **Mine** or **Theirs** for that file, or abort the merge.

You do not need to leave the application to handle conflicts.
