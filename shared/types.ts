// Shared data model — see design §11. Imported by both server (engine) and web.

export type StatusLevel = 'attention' | 'synced' | 'idle' // 黄 / 绿 / 灰

// 结构化的"需要留意"原因 —— 同时驱动列表排序与白话句子生成。
// 注：behind（落后主干）不算 attention，仅作中性信息，由 BranchInfo.behindOfTrunk 表达。
export type AttentionReason =
  | { kind: 'dirty'; uncommittedCount: number; worktree?: string }
  | { kind: 'unpushed'; ahead: number; branch: string }
  | { kind: 'unmerged'; ahead: number; branch: string } // 本地独有、领先主干、未合入
  | { kind: 'detached'; worktree?: string }
  | { kind: 'no-remote'; unpushedCommits: number } // 有本地提交却无远程可备份；纯空闲的无远程仓库不算（归 idle）

export interface CommitLite {
  hash: string // 完整 hash
  shortHash: string
  subject: string // commit message 首行
  committedAt: string // ISO，绝对时间（分支地图按它做时间轴布点）
  relativeTime: string // "2 小时前"，服务端统一计算
  author?: string
  parents: number // 父提交数（≥2 = 合并提交，画空心环）
  parentHashes?: string[] // 真实父提交；旧服务或读取失败时缺省，不据时间顺序推测连线
  tags: string[] // 指向该 commit 的 tag（主干版本徽章用）
  body: string // 完整提交信息正文（详情区显示 + revert 解析）
  revertsHash: string | null // 若是 revert：被撤销的 commit hash（来自 "This reverts commit X"）
}

// ---- 第一屏：多 repo 总览（每个 repo 一行）----
export interface RepoSummary {
  id: string // 稳定 id = 规范化 repo 根路径的 hash
  name: string
  path: string // repo 根的规范化绝对路径
  status: StatusLevel
  headline: string // 那句白话结论（由模板生成，见 §12）
  currentBranch: string | null // 主 checkout 的分支；detached 时为 null
  highlightWorktree?: string | null // 若 headline 来自某 worktree，记其名
  attentionReasons: AttentionReason[] // 空数组 = 无需留意
  hasRemote: boolean
  lastActivityAt: string // repo 内最近一次 commit 的 ISO 时间，用于排序
  lastActivityRelative: string // "2 小时前"，服务端统一计算
  readError?: string | null // 非空 = 该 repo 读取失败，按错误态展示（见 §5.4）
  scannedAt: string
}

// ---- 第二屏：单 repo 分支地图 ----
export interface RepoDetail {
  id: string
  name: string
  path: string
  status: StatusLevel
  headline: string
  trunk: { name: string; tip: CommitLite; commits: CommitLite[] } | null // commits: 近期主干提交，新→旧
  trunkInferred: 'explicit' | 'guessed' | 'none'
  hasRemote: boolean
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  scannedAt: string
}

export interface BranchInfo {
  name: string
  tip: CommitLite
  upstream: string | null
  pushState: 'pushed' | 'unpushed' | 'no-upstream'
  aheadOfTrunk: number
  behindOfTrunk: number
  mergedIntoTrunk: boolean // 仅 merge-base --is-ancestor 的 100% 确定结论，永不被推断态污染
  squashMergeLikely: boolean // 内容推断：patch-id 与某主干 commit 相同（§5.3）。仅在 mergedIntoTrunk=false 时有意义
  mergedAt: string | null // 合并回流曲线的目标 commit hash（确定态来自 ancestry-path，推断态来自 patch-id 匹配）；查不到为 null
  forkPoint: string | null // 与主干的 merge-base 提交 hash（分支地图据此从真实分叉点岔出）
  commits: CommitLite[] // 自分叉点以来的本分支提交（forkPoint..tip，封顶 N，新→旧），按时间布点
  worktree: string | null // 被哪个 worktree checkout（无则 null）
  isHead: boolean // 是否为某 worktree 的当前 HEAD
  isActive: boolean // 活跃/全部 过滤依据
  tags: string[]
  status: StatusLevel
  statusLine: string // "领先 2 · 未推送 · 有改动"，模板生成
}

export interface WorktreeInfo {
  name: string // 目录名；主 checkout 记为 'main checkout'
  path: string
  branch: string | null
  head: string
  isPrimary: boolean
  dirty: boolean
  uncommittedCount: number
}

// 按 hash 查任意 commit（design §7 / §11.3）。CommitLite 已含 parents:number/tags/body，
// 这里只追加专属字段，不重定义同名字段（避免类型冲突）。
export interface CommitDetail extends CommitLite {
  parentHashes: string[] // 父 commit 完整 hash 列表
  containingBranches: string[] // git branch --contains，该 commit 所在的本地分支
}

export interface ApiError {
  error: string
}
