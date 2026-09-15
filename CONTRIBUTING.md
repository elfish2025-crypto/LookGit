# Contributing to LookGit

Bug reports and focused pull requests are welcome. Include your OS, Node.js and Git versions, reproduction steps, and expected versus observed behavior. Use a temporary repository to reproduce issues when possible; redact paths, remotes, commit messages and screenshots from private projects.

## Local development

1. Install Node.js 22.11+ and Git.
2. Run `npm ci`, then `npm run dev`.
3. Open `http://localhost:5178`.
4. Run `npm run check` before submitting a pull request.

Keep changes focused. Add meaningful tests for Git interpretation, graph relationships, configuration and access boundaries. Describe visual changes with screenshots using fictional data.

## Product constraints

- Observe repositories without changing their files, refs or index.
- Never turn a content-based inference into a confirmed merge.
- Keep the app local; no telemetry or network Git commands.
- A branch pointer is not proof of a commit's original branch.
- Keep Chinese UI copy concise and factual.

The historical design document includes unimplemented roadmap items. README describes the shipped version. Please discuss larger features in an issue first.

Contributions are provided under the project's MIT license.
