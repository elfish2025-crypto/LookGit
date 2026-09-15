# LookGit

**Understand local Git activity at a glance.** A local, read-only dashboard for people managing multiple repositories, using worktrees, or watching AI coding agents work.

[中文](README.md) · [Releases](https://github.com/elfish2025-crypto/LookGit/releases) · [MIT License](LICENSE)

![Vertical timeline with stable branch colors, timestamps, tags and worktree state](docs/images/timeline.jpg)

*The screenshot uses a fictional demo repository. The current UI is in Chinese.*

## Features

- Repository overview grouped by attention, synchronized and idle states.
- Branches, worktrees, uncommitted file counts, ahead/behind and upstream status.
- Vertical commit history with a fixed leftmost mainline, stable branch colors, timestamps, gap labels and inline details.
- Commit, merge, revert, reverted, HEAD, tag, dirty and detached markers.
- An alternative horizontal branch map with zoom and pan.
- Commit lookup by hash beyond the recent display window.

LookGit does not commit, switch branches, merge, reset, push or delete branches. It only writes its own watched-folder configuration. Git queries disable optional locks to avoid incidental index refreshes.

## Run locally

Install **Node.js 22.11+**, npm and Git. macOS is the primary platform used for interactive validation; Linux can run the terminal workflow. This is not a standalone native application.

```sh
git clone https://github.com/elfish2025-crypto/LookGit.git
cd LookGit
npm ci
npm run build
npm start
```

Open <http://localhost:5179>. Click **加文件夹** (Add folder) and enter an absolute repository path or a parent directory. New installations start with no watched folders. Press `Ctrl+C` to stop.

On macOS, `start-lookgit.command` installs dependencies on first use, builds and opens the app. The `LookGit-v1.0.0.tar.gz` release asset includes the built UI; after extracting it, use `npm ci` and `npm start`. GitHub's automatic source archives require a build. Both require Node.js and Git.

Use `PORT` to choose another local port and `LOOKGIT_DATA_DIR` to isolate configuration (default: `~/.lookgit/config.json`). The server binds only to `127.0.0.1` and validates Host/Origin. It has no authentication and must not be publicly exposed or forwarded. See [SECURITY.md](SECURITY.md).

## Data boundaries

Remote tracking refs are local snapshots: LookGit never runs `fetch`. Merge ancestry and content-based squash/rebase inference are labeled separately. The graph shows a recent window, uses compressed spacing and organizes branches by first-parent chains; it does not assert where a commit was originally created. Reverted commits are not automatically defective commits.

No cloud upload, telemetry or AI service is included. Dependency installation needs a network connection; observation runs locally. MCP, agent notes and deleted-branch archives are roadmap items, not v1.0.0 features.

## Development

```sh
npm ci
npm run dev       # API :5179; frontend :5178
npm run check     # Type checking, tests, build
```

`engine/` collects Git state, `server/` exposes the local API, `shared/` defines types, and `web/src/` renders the UI. Tests use temporary repositories and isolated configuration.

After committing release files, `npm run package:release` creates an archive and SHA-256 checksum in `release/`. It includes tracked project files and the built UI, not personal configuration. The checksum verifies integrity; it is not a signature.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE) © 2026 elfish2025-crypto
