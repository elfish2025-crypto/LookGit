# Changelog

## 1.0.1 — 2026-09-16

- Fix the missing refresh action on repository detail pages: rescan the current repository in place, show the last update time and preserve the selected view, filter and expanded commit descriptions.
- Keep the previous data visible if refresh fails, with a retryable error message; allow retry after an initial load failure.
- Detect incomplete project folders before installing dependencies and explain how to create a macOS desktop alias.

Source: local fixes on `main`, released directly without a merge. No API or configuration format changes; no migration required. Existing v1.0.0 scope limitations still apply.

Validation: reuse the implementation checks (typecheck, 18 tests, build and browser checks for new commits, dirty state, expanded rows and failure handling). Release packaging and GitHub CI are verified separately. No separate report.

## 1.0.0 — 2026-09-15

First public release of LookGit.

- Local repository overview with branch, worktree, dirty, upstream and merge status.
- Vertical commit timeline with stable branch colors, leftmost mainline, full legend, timestamps, gaps and inline details.
- Horizontal branch map with time zoom, pan and node details.
- Commit lookup, version tags and explicit squash/rebase inference labels.
- Dirty and detached worktree markers linked to their HEAD commits.
- Loopback-only server, Host/Origin checks, empty first-run configuration and optional-lock-free Git queries.
- MIT license, bilingual documentation, automated checks and a release archive with a prebuilt frontend.

MCP, agent notes and deleted-branch archives are not part of this release.
