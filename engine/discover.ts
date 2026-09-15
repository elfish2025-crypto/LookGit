import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

// 发现规则（design §5.2）：跳过这些目录，避免把 vendored 仓库当项目。
const SKIP = new Set([
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'target',
  '.venv',
  '__pycache__',
])

const DEFAULT_MAX_DEPTH = 6

/**
 * 递归发现 roots 下的 git 仓库根目录。命中一个 repo 后不再深入其子目录
 * （其 linked worktree 由引擎用 `git worktree list` 关联，不在这里重复发现）。
 */
export async function discoverRepos(roots: string[], maxDepth = DEFAULT_MAX_DEPTH): Promise<string[]> {
  const found = new Set<string>()

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // 无权限 / 不存在，跳过
    }

    // .git 目录或 worktree 的 .git 文件 → 这是一个 repo，不再往下钻
    if (entries.some((e) => e.name === '.git')) {
      found.add(dir)
      return
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (SKIP.has(e.name)) continue
      if (e.name.startsWith('.')) continue // v1: 不进 dotdir 找 repo
      await walk(join(dir, e.name), depth + 1)
    }
  }

  await Promise.all(roots.map((r) => walk(r, 0)))
  return [...found].sort()
}
