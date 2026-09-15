import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)

const DEFAULT_TIMEOUT = 10_000
const MAX_BUFFER = 16 * 1024 * 1024

/** Run git in `cwd`. Throws on non-zero exit. */
export async function git(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT): Promise<string> {
  const { stdout } = await pexec('git', ['--no-optional-locks', '-C', cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })
  return stdout
}

/** Run git, returning null instead of throwing (for optional/best-effort queries). */
export async function gitSafe(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT): Promise<string | null> {
  try {
    return await git(cwd, args, timeoutMs)
  } catch {
    return null
  }
}

/** git --is-ancestor style command: true if exit 0, false if exit 1. */
export async function gitOk(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT): Promise<boolean> {
  try {
    await git(cwd, args, timeoutMs)
    return true
  } catch {
    return false
  }
}

/**
 * 通用并发限流器（design §14 性能项）：多分支并行扫描时，若每条分支内部还有自己的
 * 并发扇出（如 squash 检查的分块并发），不加上限会在分支很多（如 90+）时叠成几百个
 * 同时存活的 git 子进程，资源争抢反而更慢。用法：`const limit = createLimiter(12)`，
 * 然后 `limit(() => doWork())` 排队执行，同时最多 N 个在跑。
 */
export function createLimiter(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= concurrency || queue.length === 0) return
    active++
    queue.shift()!()
  }
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}

/**
 * Run `git <args1>` piped into `git <args2>` (e.g. `git diff A B | git patch-id`),
 * via Node spawn + stream pipe — no shell involved, so no injection risk even
 * though args are programmatically constructed (commit hashes / refs).
 */
export async function gitPipe(
  cwd: string,
  args1: string[],
  args2: string[],
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<string | null> {
  return new Promise((resolve) => {
    const p1 = spawn('git', ['--no-optional-locks', '-C', cwd, ...args1], { windowsHide: true })
    const p2 = spawn('git', ['--no-optional-locks', '-C', cwd, ...args2], { windowsHide: true })
    let out = ''
    let settled = false
    const finish = (v: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      p1.kill()
      p2.kill()
      finish(null)
    }, timeoutMs)

    p1.stdout.pipe(p2.stdin)
    p1.on('error', () => finish(null))
    p2.on('error', () => finish(null))
    p2.stdout.on('data', (d) => (out += d))
    p2.on('close', (code) => finish(code === 0 ? out : null))
  })
}

/** Is the `git` binary available at all? Checked once at startup. */
export async function gitAvailable(): Promise<boolean> {
  try {
    await pexec('git', ['--version'], { timeout: 5_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}
