# Security

LookGit v1.0.x is a local development tool. It runs with your OS account's file access, executes read-only Git commands, and stores watched folders in its own configuration directory.

The server binds to `127.0.0.1`, checks the Host and browser Origin, rejects cross-site requests and does not enable CORS. This reduces exposure to remote websites and DNS rebinding. It is not an authentication boundary against other software running on your computer. Only inspect repositories you trust; Git configuration and extensions remain part of your local environment.

Do not expose LookGit through a public server, reverse proxy, tunnel or port forwarding. Repository paths, commit messages, author details and local state are sensitive. Avoid sharing screenshots or API responses containing private project data.

LookGit does not fetch or push. Dependencies are locked in `package-lock.json`; install with `npm ci`. Release checks include `npm audit`, but a clean report is not a guarantee that no vulnerabilities exist.

## Reporting

Use the repository's private vulnerability reporting entry under **Security → Report a vulnerability**, when available. Do not post secrets or a sensitive proof of concept in a public issue. For nonsensitive bugs, use Issues with a minimal fictional repository.
