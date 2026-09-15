# Local Git Observer Idea

## One-Line Idea

Local Git Observer is a read-only local tool for watching Git repositories, branches, worktrees, commits, tags, and uncommitted changes in plain language.

## Why This Exists

Developers and coding agents can operate Git safely with command-line tools, but observers often need a clearer picture of what is happening.

Existing Git clients are built for people who actively operate Git. They expose many controls such as commit, checkout, merge, reset, push, discard, and publish. That makes them powerful, but also noisy and risky when the user only wants to understand the state of local development.

This idea is for a tool whose main job is not Git operation, but Git comprehension.

## Core Positioning

Local Git Observer is an observer console, not a Git client.

It watches local repositories and explains their state:

- where `main` is;
- where feature branches are;
- which worktree owns which branch;
- which commits are not yet merged;
- whether a worktree is clean or dirty;
- whether a commit has a tag;
- whether a repository has a remote;
- whether local work has been pushed, merged, tagged, or left local-only.

The developer or coding agent still uses normal Git commands. Local Git Observer only makes the result visible.

## Primary User

The primary user is an observer of development work.

Examples:

- a product owner watching an AI coding agent;
- a solo builder managing several local projects;
- a non-Git-expert who wants confidence before approving merge or release actions;
- a developer who uses worktrees heavily and wants a clear map of local state.

## Key Principle

Read-only by default.

The tool should not create commits, switch branches, merge, rebase, reset, discard files, push, publish, or delete branches.

If command suggestions are ever shown, they should be copyable text, not dangerous one-click actions.

## What It Should Make Obvious

The tool should answer questions like:

- Where did this commit go?
- Is this commit already in `main`?
- Which branch contains this commit?
- Which worktree is using this branch?
- Is this branch ahead of or behind `main`?
- Is this branch clean enough to merge?
- Did this work get tagged?
- Did this repository get pushed anywhere?
- Is the root checkout dirty while the feature worktree is clean?
- Which local repositories changed recently?

## Example Situation

Instead of making the user infer this from a generic Git UI:

```text
main: 3b5ea63
feature branch: b97c54b
relation: feature is 1 commit ahead of main
worktree: clean
status: not merged, not tagged, not pushed
```

The observer should say it directly:

> This branch is clean and local-only. It is one commit ahead of `main`. It has not been merged, tagged, or pushed.

## Multi-Repository Scope

The tool should not be tied to one project.

It should support multiple local repositories, such as:

- active product repos;
- experimental projects;
- AI-generated worktrees;
- GitHub clones;
- local-only repositories with no remote.

The user should be able to add a folder and have the tool discover Git repositories and worktrees inside it.

## Ideal First Version

The first version only needs to observe and explain:

- repository list;
- current branch;
- HEAD commit;
- clean or dirty state;
- uncommitted file count;
- local worktrees;
- branch ahead/behind relationship with `main`;
- recent commit history;
- tags pointing at current commits;
- remote presence or absence;
- commit lookup by hash.

The first version does not need code hosting integration, pull request management, collaboration features, or write operations.

## What Makes It Different

Local Git Observer should optimize for clarity, not Git power.

GitHub Desktop, GitKraken, Tower, Fork, and GitUp are Git clients. They are built around operation and history exploration.

Local Git Observer is built around status explanation:

- "What changed?"
- "Where is the work?"
- "Has it reached main?"
- "Is it safe to approve the next step?"
- "What should I be aware of before Codex continues?"

## Non-Goals

Local Git Observer should not try to be:

- a full Git client;
- a GitHub Desktop replacement;
- a pull request tool;
- a CI dashboard;
- a project management system;
- a code review tool;
- a deployment tool.

Its value is narrower: make local Git state and history understandable.

## Success Criteria

The idea succeeds if a user can open the tool and immediately understand:

- which repositories are active;
- which branches are ahead of `main`;
- which worktrees are dirty;
- which commits are local-only;
- whether the next likely action is commit, merge, tag, push, or stop;
- what the coding agent has changed without needing to inspect raw Git output.

## Product Tone

The tool should feel calm, local, and factual.

It should avoid noisy Git jargon unless needed. When jargon is shown, it should be paired with a plain-language explanation.

The observer should never feel pushed toward a dangerous action.

## Short Name Options

- Local Git Observer
- Git Watchtower
- Branch Map
- Repo Observer
- Worktree Lens

The clearest working name is:

**Local Git Observer**

