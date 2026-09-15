import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { git, gitSafe, gitOk, gitPipe, createLimiter } from './git.js'
import { buildHeadline, buildStatusLine, relTime, type HeadlineInput } from './headline.js'
import type {
  AttentionReason,
  BranchInfo,
  CommitDetail,
  CommitLite,
  RepoDetail,
  RepoSummary,
  StatusLevel,
  WorktreeInfo,
} from '../shared/types.js'

/** "按 hash 查" 接受的格式：4-64 位十六进制（覆盖 SHA-1 缩写到 SHA-256 全长）。拒绝其它一切，
 *  绝不把它原样传给 git 当作可能以 `-` 开头被解释成 flag 的参数。 */
export const COMMIT_HASH_RE = /^[0-9a-f]{4,64}$/i

const IDLE_DAYS = 30
const ACTIVE_HOURS = 72
const TRUNK_CANDIDATES = ['main', 'master', 'trunk', 'develop']

// 高亮严重度（design §12.4，越小越该关注）。behind 不参与。
const SEVERITY: Record<AttentionReason['kind'], number> = {
  detached: 1,
  dirty: 2,
  unmerged: 3,
  unpushed: 4,
  'no-remote': 5,
}

export function repoId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

interface Trunk {
  name: string | null
  how: 'explicit' | 'guessed' | 'none'
}

async function inferTrunk(path: string): Promise<Trunk> {
  const head = await gitSafe(path, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (head?.trim()) {
    const n = head.trim().replace(/^origin\//, '')
    if (n) return { name: n, how: 'explicit' }
  }
  for (const c of TRUNK_CANDIDATES) {
    const ok = await gitSafe(path, ['rev-parse', '--verify', '--quiet', `refs/heads/${c}`])
    if (ok?.trim()) return { name: c, how: 'guessed' }
  }
  return { name: null, how: 'none' }
}

interface Worktree {
  path: string
  head: string
  branch: string | null
}

async function listWorktrees(path: string): Promise<Worktree[]> {
  const out = await gitSafe(path, ['worktree', 'list', '--porcelain'])
  if (!out) return [{ path, head: '', branch: null }]
  const wts: Worktree[] = []
  let cur: Partial<Worktree> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) wts.push({ path: cur.path, head: cur.head ?? '', branch: cur.branch ?? null })
      cur = { path: line.slice('worktree '.length), branch: null }
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '')
    } else if (line === 'detached') {
      cur.branch = null
    }
  }
  if (cur.path) wts.push({ path: cur.path, head: cur.head ?? '', branch: cur.branch ?? null })
  return wts
}

async function dirtyCount(wtPath: string): Promise<number> {
  const out = await gitSafe(wtPath, ['status', '--porcelain'])
  if (!out) return 0
  return out.split('\n').filter((l) => l.trim().length > 0).length
}

async function lastCommittedAt(wtPath: string): Promise<string> {
  const out = await gitSafe(wtPath, ['log', '-1', '--format=%cI'])
  return out?.trim() ?? ''
}

const LOG_SEP = '\x00'
// 字段用 \x00 分隔，记录用 \x1e 分隔（body 含换行，不能再靠 \n 分记录）。
const LOG_FORMAT = ['%H', '%h', '%s', '%cI', '%an', '%P', '%b'].join('%x00') + '%x1e' // %P=完整父 hash（非缩写）
const REVERT_RE = /This reverts commit ([0-9a-f]{7,40})/

/** 拉某个 revision range / ref 的提交（新→旧）。 */
async function logCommits(
  path: string,
  args: string[],
  n: number,
  tagMap?: Map<string, string[]>,
): Promise<CommitLite[]> {
  const out = await gitSafe(path, ['log', `-n`, String(n), `--format=${LOG_FORMAT}`, ...args])
  if (!out) return []
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((rec) => {
      const [hash, shortHash, subject, committedAt, author, parentStr, rawBody = ''] = rec.split(LOG_SEP)
      const parentHashes = parentStr ? parentStr.trim().split(/\s+/).filter(Boolean) : []
      const body = rawBody.trim()
      const m = body.match(REVERT_RE)
      const revertsHash = m ? m[1] : null
      return {
        hash,
        shortHash,
        subject,
        committedAt,
        relativeTime: relTime(committedAt),
        author,
        parents: parentHashes.length,
        parentHashes,
        tags: tagMap?.get(hash) ?? [],
        body,
        revertsHash,
      }
    })
}

/** commit hash → 指向它的 tag 列表（含 annotated tag 解引用）。 */
async function buildTagMap(path: string): Promise<Map<string, string[]>> {
  const out = await gitSafe(path, [
    'for-each-ref',
    '--format=%(objectname)%00%(*objectname)%00%(refname:short)',
    'refs/tags',
  ])
  const m = new Map<string, string[]>()
  for (const line of (out ?? '').split('\n')) {
    if (!line.trim()) continue
    const [obj, deref, name] = line.split('\x00')
    const commit = deref || obj
    if (!commit) continue
    const arr = m.get(commit) ?? []
    arr.push(name)
    m.set(commit, arr)
  }
  return m
}

/**
 * 按 hash 查任意 commit（design §7 / §11.3）。caller 必须先用 COMMIT_HASH_RE 校验 hash
 * 格式——这里不再二次校验，只负责查询；找不到返回 null（commit 不存在/不在这个 repo）。
 */
export async function lookupCommit(path: string, hash: string): Promise<CommitDetail | null> {
  const out = await gitSafe(path, ['show', '-s', `--format=${LOG_FORMAT}`, hash])
  if (!out) return null
  const rec = out.split('\x1e')[0]
  const [fullHash, shortHash, subject, committedAt, author, parentStr, rawBody = ''] = rec.split(LOG_SEP)
  if (!fullHash) return null

  const parentHashes = parentStr.trim().split(/\s+/).filter(Boolean)
  const body = rawBody.trim()
  const revertsHash = body.match(REVERT_RE)?.[1] ?? null

  const tagsRaw = await gitSafe(path, ['tag', '--points-at', fullHash])
  const tags = tagsRaw?.split('\n').filter((t) => t.trim()) ?? []

  const branchesRaw = await gitSafe(path, ['branch', '--contains', fullHash, '--format=%(refname:short)'])
  const containingBranches = branchesRaw?.split('\n').filter((l) => l.trim()) ?? []

  return {
    hash: fullHash,
    shortHash,
    subject,
    committedAt,
    relativeTime: relTime(committedAt),
    author,
    parents: parentHashes.length,
    tags,
    body,
    revertsHash,
    parentHashes,
    containingBranches,
  }
}

async function aheadBehind(path: string, trunk: string, branch: string): Promise<{ ahead: number; behind: number }> {
  const out = await gitSafe(path, ['rev-list', '--left-right', '--count', `${trunk}...${branch}`])
  if (!out) return { ahead: 0, behind: 0 }
  // left = trunk-only (behind), right = branch-only (ahead)
  const [behind, ahead] = out.trim().split(/\s+/).map((n) => Number(n) || 0)
  return { ahead: ahead ?? 0, behind: behind ?? 0 }
}

async function pushStateOf(path: string, branch: string): Promise<'pushed' | 'unpushed' | 'no-upstream'> {
  const up = await gitSafe(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
  if (!up?.trim()) return 'no-upstream'
  const cnt = await gitSafe(path, ['rev-list', '--count', `${up.trim()}..${branch}`])
  return cnt && Number(cnt.trim()) > 0 ? 'unpushed' : 'pushed'
}

interface Candidate {
  branch: string | null
  wtName: string
  isPrimary: boolean
  isTrunk: boolean
  dirty: number
  ahead: number
  behind: number
  merged: boolean
  push: 'pushed' | 'unpushed' | 'no-upstream'
}

function candidateReasons(c: Candidate): AttentionReason[] {
  const r: AttentionReason[] = []
  const wt = c.isPrimary ? undefined : c.wtName
  if (c.branch === null) r.push({ kind: 'detached', worktree: wt })
  if (c.dirty > 0) r.push({ kind: 'dirty', uncommittedCount: c.dirty, worktree: wt })
  if (c.branch && !c.isTrunk && c.ahead > 0 && !c.merged) {
    if (c.push === 'unpushed') r.push({ kind: 'unpushed', ahead: c.ahead, branch: c.branch })
    else r.push({ kind: 'unmerged', ahead: c.ahead, branch: c.branch }) // no-upstream / no-remote
  }
  return r
}

function topSeverity(c: Candidate): number {
  const rs = candidateReasons(c)
  if (!rs.length) return 99
  return Math.min(...rs.map((r) => SEVERITY[r.kind] ?? 50))
}

/** 扫描单个 repo → RepoSummary（第一屏所需）。 */
export async function scanRepo(path: string): Promise<RepoSummary> {
  const id = repoId(path)
  const name = basename(path)
  const scannedAt = new Date().toISOString()

  try {
    const remotes = (await gitSafe(path, ['remote']))?.trim() ?? ''
    const hasRemote = remotes.length > 0
    const trunk = await inferTrunk(path)
    const worktrees = await listWorktrees(path)

    const cands: Candidate[] = []
    let lastActivityAt = ''

    for (let i = 0; i < worktrees.length; i++) {
      const wt = worktrees[i]
      const isPrimary = i === 0
      const wtName = isPrimary ? 'main checkout' : basename(wt.path)
      const branch = wt.branch
      const isTrunk = !!(branch && trunk.name && branch === trunk.name)

      const dirty = await dirtyCount(wt.path)
      let ahead = 0
      let behind = 0
      let merged = false
      let push: Candidate['push'] = 'no-upstream'

      if (branch && trunk.name && !isTrunk) {
        const ab = await aheadBehind(path, trunk.name, branch)
        ahead = ab.ahead
        behind = ab.behind
        merged = await gitOk(path, ['merge-base', '--is-ancestor', branch, trunk.name])
      }
      if (branch) push = await pushStateOf(path, branch)

      const ts = await lastCommittedAt(wt.path)
      if (ts && ts > lastActivityAt) lastActivityAt = ts

      cands.push({ branch, wtName, isPrimary, isTrunk, dirty, ahead, behind, merged, push })
    }

    const reasons = cands.flatMap(candidateReasons)
    const empty = lastActivityAt === ''

    let status: StatusLevel
    if (reasons.length > 0) status = 'attention'
    else if (empty) status = 'idle'
    else {
      const ageDays = (Date.now() - Date.parse(lastActivityAt)) / 86_400_000
      status = ageDays > IDLE_DAYS ? 'idle' : 'synced'
    }

    // 高亮对象：命中最高严重度的 candidate；无原因则取主 checkout。
    let highlight = cands[0]
    let best = topSeverity(cands[0])
    for (const c of cands) {
      const s = topSeverity(c)
      if (s < best) {
        best = s
        highlight = c
      }
    }

    const hi: HeadlineInput = {
      branch: highlight.branch,
      isTrunk: highlight.isTrunk,
      ahead: highlight.ahead,
      behind: highlight.behind,
      merged: highlight.merged,
      squashLikely: false, // 范围限定在第二屏分支地图（design §5.3），第一屏不算
      push: highlight.push,
      dirty: highlight.dirty,
      trunk: trunk.name,
      trunkKnown: !!trunk.name,
      status,
      empty,
      hasRemote,
    }

    return {
      id,
      name,
      path,
      status,
      headline: buildHeadline(hi),
      currentBranch: cands[0]?.branch ?? null,
      highlightWorktree: highlight.isPrimary ? null : highlight.wtName,
      attentionReasons: reasons,
      hasRemote,
      lastActivityAt,
      lastActivityRelative: relTime(lastActivityAt),
      scannedAt,
    }
  } catch (e) {
    return {
      id,
      name,
      path,
      status: 'idle',
      headline: '读取失败。',
      currentBranch: null,
      attentionReasons: [],
      hasRemote: false,
      lastActivityAt: '',
      lastActivityRelative: '',
      readError: e instanceof Error ? e.message : String(e),
      scannedAt,
    }
  }
}

const STATUS_RANK: Record<StatusLevel, number> = { attention: 0, synced: 1, idle: 2 }

/** 已合入分支汇入主干的那个 commit（ancestry-path 上 tip 之后的第一个主干提交）。算不出返回 null。 */
async function mergeCommit(path: string, tip: string, trunk: string): Promise<string | null> {
  const out = await gitSafe(path, ['rev-list', '--ancestry-path', '--reverse', `${tip}..${trunk}`])
  if (!out) return null
  const first = out.split('\n').find((l) => l.trim())
  return first?.trim() || null
}

function branchPushState(upstream: string, track: string): 'pushed' | 'unpushed' | 'no-upstream' {
  if (!upstream || track.includes('gone')) return 'no-upstream'
  return track.includes('ahead') ? 'unpushed' : 'pushed'
}

const SQUASH_CHECK_CAP = 80 // 性能上限：只查最近 N 个非 merge 主干 commit（design §5.3）
const BRANCH_SCAN_CONCURRENCY = 12 // 分支级并发上限（design §14 性能项），避免分支极多时叠出几百并发子进程

function parsePatchId(out: string | null): string | null {
  if (!out) return null
  const first = out.split('\n').find((l) => l.trim())
  return first ? first.trim().split(/\s+/)[0] || null : null
}

/**
 * squash-merge 内容推断（design §5.3）：分支整体 diff 的 patch-id 是否等于主干上某个
 * 非 merge commit 的 patch-id。命中即认为"内容已合并"，但绝不升级 mergedIntoTrunk——
 * 宁可漏判，不可错判。
 */
async function checkSquashMergeLikely(
  path: string,
  forkPoint: string,
  branchTip: string,
  trunkName: string,
): Promise<{ likely: boolean; mergedAt: string | null }> {
  const branchPatch = parsePatchId(await gitPipe(path, ['diff', forkPoint, branchTip], ['patch-id', '--stable']))
  if (!branchPatch) return { likely: false, mergedAt: null }

  const revOut = await gitSafe(path, ['rev-list', '--no-merges', `${forkPoint}..${trunkName}`])
  if (!revOut) return { likely: false, mergedAt: null }
  const candidates = revOut
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, SQUASH_CHECK_CAP)

  // 真未合入的分支（多数情况）必须扫完全部候选才能下结论——这是最贵的路径。
  // 按小批并发查（仍按新→旧的原始顺序找第一个命中），把"顺序扫 80 次"
  // 压成"顺序扫 8 批、每批 10 个并发"，bound 住单分支的峰值并发数。
  const CHUNK = 10
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK)
    const patches = await Promise.all(
      chunk.map((commit) => gitPipe(path, ['show', commit], ['patch-id', '--stable']).then(parsePatchId)),
    )
    const hit = patches.findIndex((p) => p === branchPatch)
    if (hit !== -1) return { likely: true, mergedAt: chunk[hit] }
  }
  return { likely: false, mergedAt: null }
}

interface BranchLine {
  name: string
  hash: string
  short: string
  subject: string
  cdate: string
  author: string
  upstream: string
  track: string
}

interface BranchCtx {
  trunkName: string | null
  tagMap: Map<string, string[]>
  branchToWt: Map<string, { name: string; dirty: number }>
  hasRemote: boolean
  commitCap: number // 主干用更大的窗口（§13.3），其余分支封顶更小（§13.4）
}

/** 单条分支（或主干自身那一行）的完整判定，独立于其它分支——可安全并行跑。 */
async function buildBranchInfo(path: string, line: BranchLine, ctx: BranchCtx): Promise<BranchInfo> {
  const { name, hash, short, subject, cdate, author, upstream, track } = line
  const isTrunk = ctx.trunkName === name

  let ahead = 0
  let behind = 0
  let merged = false
  let forkPoint: string | null = null
  if (ctx.trunkName && !isTrunk) {
    const ab = await aheadBehind(path, ctx.trunkName, name)
    ahead = ab.ahead
    behind = ab.behind
    merged = await gitOk(path, ['merge-base', '--is-ancestor', name, ctx.trunkName])
    forkPoint = (await gitSafe(path, ['merge-base', name, ctx.trunkName]))?.trim() || null
  }
  let mergedAt = merged && ctx.trunkName ? await mergeCommit(path, name, ctx.trunkName) : null

  // squash-merge 内容推断（design §5.3）：ancestry 断裂时再用 patch-id 比对一次。
  // 只在 ahead>0（分支确实有独有改动）且 100% 确定未合入时才查，绝不覆盖确定态。
  let squashLikely = false
  if (ctx.trunkName && !isTrunk && !merged && ahead > 0 && forkPoint) {
    const r = await checkSquashMergeLikely(path, forkPoint, name, ctx.trunkName)
    squashLikely = r.likely
    if (r.likely) mergedAt = r.mergedAt
  }

  const push = branchPushState(upstream, track)
  const wt = ctx.branchToWt.get(name)
  const dirty = wt?.dirty ?? 0
  const tagsRaw = await gitSafe(path, ['tag', '--points-at', hash])
  const tags = tagsRaw?.split('\n').filter((t) => t.trim()) ?? []

  // 本分支自分叉点以来的提交（封顶 N，新→旧），地图按时间布点。
  let commits = forkPoint
    ? await logCommits(path, [`${forkPoint}..${name}`], ctx.commitCap, ctx.tagMap)
    : await logCommits(path, [name], ctx.commitCap, ctx.tagMap)
  if (commits.length === 0) commits = await logCommits(path, [name], 1, ctx.tagMap)
  const tip: CommitLite = commits[0] ?? {
    hash,
    shortHash: short,
    subject,
    committedAt: cdate,
    relativeTime: relTime(cdate),
    author,
    parents: 0,
    tags,
    body: '',
    revertsHash: null,
  }

  // squashLikely 不计入 attention 原因，也不算"还在进行中"（design §5.3）。
  const hasReason = dirty > 0 || (!isTrunk && ahead > 0 && !merged && !squashLikely)
  const status: StatusLevel = hasReason ? 'attention' : 'synced'
  const ageHours = (Date.now() - Date.parse(cdate)) / 3_600_000
  // 活跃 = 该关注的（design §4.2）。已合入（含 squashLikely）且干净的分支视为完成，
  // 归"全部"，即便最近动过——否则活跃视图会被一堆 done 分支淹没。
  const isActive = isTrunk || hasReason || push === 'unpushed' || (ageHours <= ACTIVE_HOURS && !merged && !squashLikely)

  const hi: HeadlineInput = {
    branch: name,
    isTrunk,
    ahead,
    behind,
    merged,
    squashLikely,
    push,
    dirty,
    trunk: ctx.trunkName,
    trunkKnown: !!ctx.trunkName,
    status,
    empty: false,
    hasRemote: ctx.hasRemote,
  }

  return {
    name,
    tip,
    upstream: upstream || null,
    pushState: push,
    aheadOfTrunk: ahead,
    behindOfTrunk: behind,
    mergedIntoTrunk: merged,
    squashMergeLikely: squashLikely,
    mergedAt,
    forkPoint,
    commits,
    worktree: wt?.name ?? null,
    isHead: !!wt,
    isActive,
    tags,
    status,
    statusLine: buildStatusLine(hi),
  }
}

/** 扫描单个 repo → RepoDetail（第二屏分支地图所需）。 */
export async function scanRepoDetail(path: string): Promise<RepoDetail> {
  const summary = await scanRepo(path) // 复用：headline/status/id/name 与第一屏一致
  const trunk = await inferTrunk(path)
  const worktrees = await listWorktrees(path)
  const tagMap = await buildTagMap(path)

  // worktree 的 dirty 检查互相独立，并行跑（design §14 性能项）。
  const wtInfos: WorktreeInfo[] = await Promise.all(
    worktrees.map(async (wt, i) => {
      const isPrimary = i === 0
      const dirty = await dirtyCount(wt.path)
      return {
        name: isPrimary ? 'main checkout' : basename(wt.path),
        path: wt.path,
        branch: wt.branch,
        head: wt.head,
        isPrimary,
        dirty: dirty > 0,
        uncommittedCount: dirty,
      }
    }),
  )
  const branchToWt = new Map<string, { name: string; dirty: number }>()
  for (const w of wtInfos) if (w.branch) branchToWt.set(w.branch, { name: w.name, dirty: w.uncommittedCount })

  const SEP = '\x00'
  const fields = [
    '%(refname:short)',
    '%(objectname)',
    '%(objectname:short)',
    '%(contents:subject)',
    '%(committerdate:iso-strict)',
    '%(authorname)',
    '%(upstream:short)',
    '%(upstream:track)',
  ].join('%00')
  const raw = (await gitSafe(path, ['for-each-ref', `--format=${fields}`, 'refs/heads'])) ?? ''

  const lines: BranchLine[] = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [name, hash, short, subject, cdate, author, upstream, track = ''] = line.split(SEP)
      return { name, hash, short, subject, cdate, author, upstream, track }
    })

  // 每条分支的判定互相独立（不同分支之间不共享中间状态）→ 并行跑，而不是逐条 await
  // （design §14 性能项：之前是顺序调 git，分支多的 repo 详情页明显变慢）。
  // 主干那一行单独给更大的 commit 窗口（12 而非 8），下面直接复用，不再重复查一次。
  // 用并发限流器收住外层扇出——分支很多（实测 90+）时，若每条分支内部的 squash
  // 检查（自身也有并发）叠加不设上限，会同时存活几百个 git 子进程、资源争抢更慢。
  const branchLimit = createLimiter(BRANCH_SCAN_CONCURRENCY)
  const branches = await Promise.all(
    lines.map((line) =>
      branchLimit(() =>
        buildBranchInfo(path, line, {
          trunkName: trunk.name,
          tagMap,
          branchToWt,
          hasRemote: summary.hasRemote,
          commitCap: line.name === trunk.name ? 12 : 8,
        }),
      ),
    ),
  )

  branches.sort((a, b) => {
    if (a.name === trunk.name) return -1
    if (b.name === trunk.name) return 1
    const ra = a.status === 'attention' ? 0 : 1
    const rb = b.status === 'attention' ? 0 : 1
    if (ra !== rb) return ra - rb
    return b.tip.committedAt.localeCompare(a.tip.committedAt)
  })

  const trunkBranch = trunk.name ? branches.find((b) => b.name === trunk.name) : undefined

  // 分叉点/合并点必须落在主干时间线覆盖的范围内，否则分叉/合并曲线会画到一个主干线
  // 根本没延伸到的位置，看起来"飘在空中、接不上主干"（真实 bug，已用实际仓库验证：
  // trunkBranch.commits 只缓存最近 12 个，但多数分支的分叉点比这早得多）。这里把所有
  // 分支引用到、但还不在缓存里的分叉点/合并点单独补抓，合进主干的提交列表——保证
  // 每一条要画的曲线，主干那头都有一个真实存在的落点。
  let trunkCommitsForMap = trunkBranch?.commits ?? []
  if (trunkBranch && trunk.name) {
    const known = new Set(trunkCommitsForMap.map((c) => c.hash))
    const missing = new Set<string>()
    for (const b of branches) {
      if (b.forkPoint && !known.has(b.forkPoint)) missing.add(b.forkPoint)
      if (b.mergedAt && !known.has(b.mergedAt)) missing.add(b.mergedAt)
    }
    if (missing.size > 0) {
      const extra = (await Promise.all([...missing].map((h) => logCommits(path, [h], 1, tagMap)))).flat()
      trunkCommitsForMap = [...trunkCommitsForMap, ...extra].sort((a, b) => b.committedAt.localeCompare(a.committedAt))
    }
  }

  return {
    id: summary.id,
    name: summary.name,
    path,
    status: summary.status,
    headline: summary.headline,
    trunk: trunk.name && trunkBranch ? { name: trunk.name, tip: trunkBranch.tip, commits: trunkCommitsForMap } : null,
    trunkInferred: trunk.how,
    hasRemote: summary.hasRemote,
    branches,
    worktrees: wtInfos,
    scannedAt: summary.scannedAt,
  }
}

/** 扫描全部 roots 下的 repo，按"该不该关注"排序（design §4.1）。 */
export async function scanAll(repoPaths: string[]): Promise<RepoSummary[]> {
  const repos = await Promise.all(repoPaths.map(scanRepo))
  repos.sort((a, b) => {
    const ra = a.readError ? 3 : STATUS_RANK[a.status]
    const rb = b.readError ? 3 : STATUS_RANK[b.status]
    if (ra !== rb) return ra - rb
    return b.lastActivityAt.localeCompare(a.lastActivityAt)
  })
  return repos
}
