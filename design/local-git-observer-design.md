# Local Git Observer — Design Document

> 状态：历史设计与后续规划；当前 v1.0.0 的已发布能力以 README 为准。
> v1.0.0 发布调整：首次启动为空，不自动扫描目录；服务仅监听 127.0.0.1。
> 关联：见 [idea/local-git-observer-idea.md](../idea/local-git-observer-idea.md)
> 工作名：Local Git Observer / LookGit

---

## 1. 定位

LookGit 是一个**本地、只读的 Git 观察控制台**，不是 Git 客户端。它的工作不是操作 Git，而是**让本地 Git 状态被看懂**。

核心策略：

- **引擎通用**：底层采集层中立、完整，能服务任何"想看懂本地 git 状态"的人。
- **第一屏押注场景**：产品的第一屏按"人类监督 AI coding agent 在本地干了什么"这个场景设计（排序、结论句、风险敞口优先）。

这个折中的意义：窄场景给设计提供锐度（知道第一屏说什么、怎么排序），但不收窄技术能力。若场景验证不对，换个第一屏即可转为通用工具，沉没成本极低。

### 为什么是这个场景

现有 Git 客户端（GitKraken / Tower / Fork / GitUp / GitHub Desktop）都假设 **操作者 == 理解者** 是同一个人。而在"人监督 agent 写代码"的场景里，操作者是 agent，理解者是人——这块没人专门做。这是 LookGit 真正的差异化 wedge。

---

## 2. 形态

**本地 Web 仪表盘**：起一个本地服务，浏览器里看可视化界面。

排除项：纯 CLI / 纯文本不足以服务"非 git 专家一眼看懂"的目标；菜单栏常驻可作为后续补充入口，但 v1 主体是 Web 仪表盘。

---

## 3. 产品调性（硬约束）

来自 idea 的 "calm, local, factual"，翻译成可执行约束：

- **一行结论优先，细节默认折叠**：每个对象先给一句白话，想看才点开。
- **颜色分两处用**：**第一屏总览**用两挡状态色（绿=干净/已同步、黄=需要留意、灰=空闲）做 triage，保持 calm；**分支地图**改用**每条分支一个身份色**（取自固定调色板）来区分泳道结构（见 §13.5），状态在地图上靠 statusLine 文字 + 幽灵节点 + attention 标记表达，不靠节点填充色。红色用于被撤销提交（被 revert 的那个提交，git 自动判定，见 §13.5），灰色留给主干。
- **不画全量 commit DAG**：拒绝"面条图"。只画主干 + 活跃分支 + 分叉附近的少量 commit。
- **白话由确定性模板生成**，不用 LLM 叙事（v1）。可预测、离线、零成本、永不胡说。
- **永不把用户推向危险动作**：只读；若展示命令建议，只能是可复制文本，不是一键危险操作。

"复杂往往不是来自功能多，而是来自一次性把所有 git 概念摊在脸上。" 保持简单的关键是敢砍。

---

## 4. 核心界面

v1 有两块界面，导航关系：**多 repo 总览 → 点任意一行 → 单 repo 分支地图**。两屏均已出 mock。

### 4.1 第一屏：多 repo 总览

- 顶部：标题 + "N 个 · M 个需要留意" + 「加文件夹」「刷新」；下方一行显示监视的文件夹与扫描时间。
- 列表按**"该不该关注"分组排序**：`需要留意`（黄）在上、`已同步`（绿）居中、`空闲`（灰）垫底。
- 每个 repo 一行：状态色点 + 仓库名 + 当前分支 pill + 一句白话结论 + 相对时间 + chevron。
- **每个 repo 一行**（不是每个 worktree 一行）：当某 repo 最值得关注的 checkout 是一个 worktree 时，该行展示那个 worktree 的分支 + `worktree` 标签（对应 `RepoSummary.highlightWorktree`），并能表达"本地独有、未合入主干"。完整的 worktree 列表在第二屏分支地图里展开。

### 4.2 第二屏：单 repo 分支地图

自上而下：

1. **顶部一句话结论**（彩色条）：不看图也已知道局面。
2. **节点详情区**：点击任意节点后在彩条下方展开（见 §13.6）。
3. **分支地图（泳道即 git 图）**：主干在上为横向时间线，每条分支是其下一条泳道；分叉扇出、合并回流、HEAD 大同心圆、未提交/游离用虚线幽灵节点；节点右侧只放短信息，完整信息进详情区，故不出现「…」。
4. **底部图例**：颜色含义 + HEAD 标记说明。

详细见 §13 分支地图视图规范。设计底线：一图只服务一个 repo，「活跃」默认封顶，不画全历史面条。

#### 活跃 / 全部 双模式

分支多时（如 8 个 agent worktree）图会变挤。解决方式是**两个预览模式**：

- **活跃（默认）**：只显示需要关注的分支。判定规则：**有未推送提交 OR 工作区脏 OR（最近 72 小时内有动静且未合入/未疑似合入）**；**已合入（含 squashMergeLikely）且干净的分支视为完成、归「全部」**，即便最近动过。这样"活跃"天然等于"你该关注的"。`isActive` 用 72 小时阈值（贴近"这两三天还在动的工作"），repo 级 `idle`（长期无动静）用 30 天阈值——两者尺度不同、刻意分开（已在 `engine/scan.ts` 实现，不再是待定项）。
- **全部**：显示所有分支（含早已干净合入、纯跟随 main 的旧分支）。
- 切换旁始终显示"共 N 个 · 显示 M 个活跃"，让用户知道有东西被收起、不会误以为漏看。

---

## 5. 数据采集与判定（引擎）

引擎对每个对象产出生成"那句白话"所需的状态。核心字段：

- 仓库列表（多文件夹递归发现 repo 与 worktree）
- 当前分支、HEAD commit
- clean / dirty 状态、未提交文件数
- 本地 worktree 列表及其归属分支
- 分支相对主干的 ahead / behind
- 最近 commit 历史、最近 commit message + 时间
- 指向当前 commit 的 tag
- 是否有 remote、是否已 push
- 按 hash 查 commit

### 5.1 已知难点与诚实处理

- **主干不一定叫 `main`**：需要"主干推断"逻辑（main / master / trunk / develop），不能写死。
- **"是否已 merged" 很难**：squash / rebase 合并后 hash 变了，`merge-base --is-ancestor` 找不到（fast-forward 不受影响——FF 后分支 tip 直接变成主干上的一个 commit，ancestry 仍成立）。
  - **确定态**：`merge-base --is-ancestor` 给出的 `mergedIntoTrunk`，100% 确定，永远保留、不降级。
  - **推断态（已实现，见 §5.3）**：针对 squash/rebase 导致 ancestry 断裂的分支，加一条**内容推断**信号 `squashMergeLikely`——必须在 UI 上明确标注"基于内容比对、非完全确定"，不得与确定态混淆展示。判断不准比不判断更伤信任，所以**宁可漏判（false negative）也不能错判（false positive）**：找不到内容匹配就老实说"未合入"，绝不主动声称"已合入"。
- **实时 vs 按需**：v1 只做**按需 + 手动刷新**（一个刷新按钮），不做 fs watch 常驻监听，省一整套复杂度。
- **`scanRepoDetail` 跨分支并行**：每条分支的判定互相独立，`buildBranchInfo` 用 `Promise.all`（受 `BRANCH_SCAN_CONCURRENCY=12` 限流，见 §13.7）并行跑，而不是逐条顺序 await；顺手消除了主干 commits 被查两次的重复调用（循环内 cap=8、循环外又查一次 cap=12，现在只查一次直接复用）。示例仓库（22 分支）实测 ~1.6s → ~1.2s，逐分支字段结果核对一致、无回归。**仍未做**：跨 repo 的扫描缓存（每次点开详情页都全新扫描），目前没有证据表明这是真实痛点。

### 5.2 发现规则（默认）

- 递归扫描每个 watched root，遇到 `.git`（目录，或 worktree 的 `.git` 文件）即认定为一个 repo / worktree。
- **跳过** `node_modules`、`vendor`、`.git` 内部等目录，避免把 vendored 仓库当成项目；命中一个 repo 后不再深入其子目录找嵌套 repo（其自身的 linked worktree 除外）。
- **submodule**：v1 不展开、不单独成行，视为所属 repo 的一部分。
- **深度上限**：默认限制递归深度（如 ≤ 6 层）防止在巨大目录树上卡死；v1 不做成可配项（保持 §7"唯一可配 = 文件夹"）。
- linked worktree 通过 `git worktree list` 关联到其主 repo，不重复成行。

### 5.3 squash-merge 内容推断（D）

针对 ancestry 断裂、`mergedIntoTrunk=false` 的分支，追加一次**内容比对**，给出 `squashMergeLikely` 信号：

- **方法**：用 `git patch-id --stable` 比较"补丁内容"而非 commit hash。
  1. 算分支自身的整体改动：`git diff <forkPoint> <branchTip>` → 喂给 `git patch-id --stable` 得到一个 patch-id。
  2. 取主干上 `forkPoint..trunk` 之间的**非 merge** commit（squash 产物本身是单父 commit，merge commit 不可能是 squash 结果，故跳过），逐个算 `git show <commit> | git patch-id --stable`。
  3. 任意一个主干 commit 的 patch-id 与分支的 patch-id**相同** → `squashMergeLikely = true`；否则 `false`。
  - 两条 git 命令通过 stdin 管道直接串联（Node `spawn` + pipe，不经过 shell），不是 shell 字符串拼接，避免命令注入风险。
- **性能上限**：主干侧 commit 数量很大时只检查最近 N 个非 merge commit（如 80 个），更早的历史不查；查不到不算"否定结论"，只是"没查到"，UI 上仍诚实展示为"未合入"。
- **真未合入的分支反而最贵**：早退出的顺序扫描对"确实是 squash 合并"的分支很快（一两次命中即停），但对多数"确实没合并"的分支必须扫完全部候选——这才是常见路径。处理方式：按 10 个一批并发扫（仍按新→旧顺序找第一个命中，命中即停批次），把"顺序起 80 次子进程"压成"顺序起 8 批、每批 10 个并发"，在收益和单分支峰值并发数之间取一个折中，不无限制地一次性铺开。
- **绝不假阳性**：patch-id 内容相同在实践中几乎不可能误判为"已合入"；唯一的代价方向是漏判（旧的、超出检查窗口的 squash 合并查不到），这是刻意接受的——宁可少判几个真已合入的，不能给出一个假的"已合入"。
- **不升级 `mergedIntoTrunk`**：这个布尔值永远只代表 ancestry 确定结论，不被 `squashMergeLikely` 污染。两者并列存在、UI 上视觉区分（见 §13.4 虚线合并曲线 / §13.6 详情区"可能"措辞）。
- **不再算"需要留意"**：`squashMergeLikely=true` 的分支不计入 `unmerged` attention 原因，也不进入"活跃"集合（视为大概率已完成，归"全部"），但仍要在文案上标注不确定性，不能等同于确定已合入的沉默处理。
- **范围限定在单 repo 分支地图（第二屏）**：每条候选分支要付出"1 次 diff+patch-id ＋ 最多 80 次 show+patch-id"的代价，对第一屏"多 repo 总览"（按需刷新时一次扫所有 repo 的所有分支）太贵。v1 故意只在用户点开某个 repo 看分支地图时才算；第一屏列表与高亮分支的 headline 仍只用 §5.1 的确定态判断。这是有意的范围边界，不是遗漏——以后若要扩到第一屏，需要先有按需/懒加载或缓存机制。

### 5.4 错误与异常态

- **逐 repo 隔离**：任一 repo 读取失败（损坏 / 无权限 / 超时）只标记该 repo，绝不让整次扫描挂掉或令其静默消失。
- 失败的 repo 在第一屏以**独立错误态**展示（`RepoSummary.readError` 非空），用中性的"读取失败"样式 + 原因提示，**不混入绿/黄/灰三色**。
- **前置检查**：启动时检测 `git` 是否可用；不可用则全局提示一次，而非每个 repo 各报一次错。

---

## 6. Agent 与 LookGit 的关系（安全边界）

LookGit 不只是人类的工具，也可作为**开发该项目的 Agent 的 map**。但这引入一个根本性的利益冲突，必须用边界设计化解。

### 6.1 两个方向，价值与风险不同

- **方向一：Agent 读 LookGit（把它当 map）** —— 低风险、价值清楚。Agent 跨多 worktree / 多 repo 干活也会迷路；复用已算好的结构化状态，开只读接口即可。规划在 **v1.1**。
- **方向二：Agent 写 LookGit（给人类贴解释/建议）** —— 有价值但风险高，**推迟到 v1 之后**。

### 6.2 核心原则：被监督者不得撰写监督面板

LookGit 存在的一半理由是让人类**独立判断** agent 干了什么再决定批不批。若同一 agent 能往面板写有说服力的 prose（"这分支很安全，可以合"），就会把人推向"批准"，违背"永不推向危险动作"。

因此安全的核心不是"让不让写"，而是：**永远保留一层 agent 动不了、人类可随时回退的地面真相。**

### 6.3 概念切分：状态 vs 意图

- **状态（State）= git 知道的事**：由 LookGit 确定性计算，**任何 agent 都改不了**。这是可信地面真相。
- **意图（Intent）= git 不知道的事**："这是高风险重构，测试过再合"。只有 agent / 人知道，是 agent 真正能增值处。

Agent 永远不能碰状态，只能往意图层贡献，且必须清楚标注、可被状态反驳。

### 6.4 硬不变量（任何阶段都不破）

1. **项目 git 永远只读；LookGit 绝不能成为 agent 写 git 的通道。** Agent 用自己的 git 工具操作仓库；LookGit 对 agent 只暴露：读状态 + 往笔记层追加。否则破坏只读承诺并制造 confused-deputy 漏洞。
2. **"只读项目" ≠ "整个系统只读"。** Agent 笔记写进 **LookGit 自己的数据目录**（独立 sidecar，如 app data 里的 SQLite），**绝不写进项目仓库**——污染不了代码、不会被误 commit。git 工作区零字节改动。
3. **出处可溯**：每条笔记带"谁写的 + 基于哪个 commit hash"。事实与 agent 的话在视觉与结构上分得清，agent prose 绝不伪装成 git 真相。
4. **绑定 commit、防过期**：笔记钉在 commit hash 上。两种过期态要分开：①"针对已非 HEAD 的某提交"（commit 还在、只是 HEAD 移动了）；②**"pinned commit 已被重写/不可达"**——被 squash/reset/rebase 甩掉后，那个 hash 直接不存在了（不只是不是 HEAD）。后者要显式提示"该提交已被压缩或重写"，并提供改钉到现有提交的入口。
5. **接口收窄 + 沙箱**：给 agent 的 MCP/API 只有"查状态 + 追加笔记"，无 shell，不能写数据目录以外的文件。
6. **git 文本当数据不当指令**：commit message / 分支名是外部可控文本，是 prompt-injection 入口；若将来用 LLM 叙述，必须当数据处理。（亦是 v1 用确定性模板的理由之一。）

### 6.5 数据模型留缝

v1 虽不开 agent 接口，但**现在就把状态层与笔记层分开存**：

- **状态层**：计算得出、无状态、可随时重算。
- **笔记层**：独立可写 sidecar，与状态层解耦。

这样以后加方向一/方向二都不动核心。

---

## 7. v1 范围

### 做

1. **扫**：给几个文件夹，递归发现里面的 repo 与 worktree。
2. **判**：对每个算出白话所需状态（分支、dirty、ahead/behind、push 状态等）。
3. **说**：一行白话 + 颜色点；点开看分支地图。
4. 两块界面：多 repo 总览、单 repo 分支地图（含活跃/全部双模式）。
5. 按 hash 查 commit。
6. squash-merge 内容推断（§5.3），分级标注不确定性，不与确定态混淆。

### 不做（v1 砍掉）

- 实时监听（只做手动刷新）
- LLM 叙事（用确定性模板）
- 全量 commit / 分支 DAG 可视化（面条图）
- 设置面板（v1 唯一可配项：加哪几个文件夹）
- 代码托管集成 / PR 管理 / 协作 / 任何写操作

---

## 8. 非目标

LookGit 不试图成为：完整 Git 客户端、GitHub Desktop 替代、PR 工具、CI 仪表盘、项目管理系统、code review 工具、部署工具。价值更窄：**让本地 Git 状态与历史可被理解。**

---

## 9. 路线图

- **v1（已完成，已打 tag `v1.0.0`）**：纯人类面向、项目只读。把"人看懂"做扎实。数据模型预留状态/笔记分层。
- **v1.1**：方向一——给 agent 开**只读**状态接口（MCP/API），LookGit 成为 agent 的 map。同一批基础设施（SQLite 笔记层）落地时，**一并做**下面的"已删除分支历史痕迹"——它不是 agent 功能，但用同一个 sidecar，分开建两次没有意义。
- **已删除分支历史痕迹**（待做，绑定笔记层一起建，见 §11.2）：用户在 LookGit 之外自己删了一个分支（比如 fast-forward 合并后清理），LookGit **被动**在下次扫描时发现"上次见过、这次没了"，把上次扫描记下的状态（tip / ahead-behind / fork 点 / merge 状态）写进笔记层存成一条历史记录。**LookGit 绝不主动执行删除**，也不提供"标记清理"这类操作按钮——纯粹是扫描时的被动比对，保持"observer not actor"。UI 上用明显淡化/虚化的样式呈现，绝不能看起来像活的 git ref（呼应 §6.3 状态 vs 意图的区分）：例如"`{分支名}`（已删除，历史痕迹）· 记录于 {时间} · git 本身已无法验证"。背景动机：fast-forward 合并不会在 git 对象图里留下"这曾是一条分支"的记录，删除 ref 后这个事实永久无法恢复（已验证，见 §13.5 fast-forward 行"事后看不出曾是分支"）；这是 LookGit 在 git 机制本身的盲区上，用自己的笔记层补一层记忆。
- **更后**：方向二——agent 写"意图"笔记，严格执行 §6 的 provenance + 状态优先 + 沙箱。
- **候选增强**：菜单栏常驻入口、实时监听、自然语言提问。

---

## 10. 技术选型（已定）

整体路线：**TypeScript 全栈（Stack A）**。前后端一种语言，迭代最快；MCP 官方 SDK 为 TS-first，§9 路线图里"给 agent 开接口"几乎零摩擦；今天 mock 的 HTML/CSS 可直接转 React 组件，不浪费。

### 选定组合

| 维度 | 选定 | 说明 |
|---|---|---|
| 调 git 方式 | **直接 shell out `git`** | 复现 git 自己的理解最准；只读 + 按需刷新，进程开销无所谓；零原生依赖、安装最简；用机读格式避免解析脆弱。 |
| Runtime | **Bun**（保守可换 Node） | TS 原生、内置打包、将来可 compile 单二进制。换 Node 时其余不变。 |
| HTTP 框架 | **Hono** | 极轻；可同时承载后续 MCP/API。 |
| 前端 | **Vite + React** | mock 已是 web，直接落地；生态最大。 |
| 笔记层存储 | **SQLite**（bun:sqlite / better-sqlite3） | 放在 LookGit 自己的数据目录，绝不进项目仓库（见 §6.4）。 |
| v1.1 Agent 接口 | **官方 MCP SDK（TS）** | 一等公民。 |

### 调 git 的命令骨架（机读格式）

```
git worktree list --porcelain                  # worktree 及归属分支
git status --porcelain=v2 --branch -z          # dirty / 文件数 + 相对 upstream 的 ahead/behind
git for-each-ref --format='...' refs/heads     # 分支名 / HEAD / 最近 message / 相对时间 / short hash / upstream，一次拿全
git rev-list --left-right --count main...HEAD  # 相对主干 ahead/behind
git merge-base --is-ancestor <commit> main     # 100% 确定的"已合入"判断
git tag --points-at <commit>                   # 指向某 commit 的 tag
```

### 已记录的备选方案

**Stack B：Go 后端 + Web 前端**，单一自包含二进制、零运行时依赖，分发故事最干净。**触发切换的条件**：近期就要"非开发者零依赖、双击即用的单文件分发"。当前决定：**先用顺手，分发问题以后再考虑**，故暂不切。

排除：Rust+Tauri（开发成本最高，v1 过重）、Python（分发给非开发者痛苦、进程 spawn 不顺手）。

---

## 11. 数据模型与内部接口

落实 §6 的"状态 vs 意图"分层：

- **状态层**：由 git 命令计算得出，**无持久化、可随时重算**，每次扫描缓存在内存。下面的 TS 类型即其形状。
- **笔记层**：独立 SQLite，存在 LookGit 自己的数据目录，**绝不进项目仓库**。
- 二者只在 API 出口处"对账"（笔记按 commit hash 计算是否过期），数据上完全解耦。

### 11.1 状态层（TypeScript 类型）

```ts
type StatusLevel = 'attention' | 'synced' | 'idle'   // 黄 / 绿 / 灰

// 结构化的"需要留意"原因 —— 同时驱动列表排序与白话句子生成
type AttentionReason =
  | { kind: 'dirty';        uncommittedCount: number; worktree?: string }
  | { kind: 'unpushed';     ahead: number; branch: string }
  | { kind: 'unmerged';     ahead: number; branch: string }  // 本地独有、领先主干、未合入
  | { kind: 'detached';     worktree?: string }
  | { kind: 'no-remote';    unpushedCommits: number }        // 有本地提交却无远程可备份；纯空闲的无远程仓库不算（归 idle）
// 注：behind（落后主干）不算 attention，仅作中性信息，由 BranchInfo.behindOfTrunk 表达

interface CommitLite {
  hash: string          // 完整 hash
  shortHash: string
  subject: string       // commit message 首行
  committedAt: string   // ISO，绝对时间（分支地图按它做时间轴布点）
  relativeTime: string  // "2 小时前"，由服务端统一计算，保证一致
  author?: string
  parents: number       // 父提交数（≥2 = 合并提交，画空心环）
  parentHashes?: string[] // 竖向列表使用真实父提交连线；缺省时不猜测关系
}

// ---- 第一屏：多 repo 总览（每个 repo 一行）----
interface RepoSummary {
  id: string                  // 稳定 id = 规范化 repo 根路径的 hash
  name: string
  path: string                // repo 根的规范化绝对路径
  status: StatusLevel
  headline: string            // 那句白话结论（由模板生成，见 §12 白话模板）
  currentBranch: string | null  // 主 checkout 的分支；detached 时为 null
  highlightWorktree?: string | null  // 若 headline 来自某 worktree，记其名（对应 mock 的 worktree 标签）
  attentionReasons: AttentionReason[] // 空数组 = 无需留意
  hasRemote: boolean
  lastActivityAt: string         // repo 内最近一次 commit 的 ISO 时间，用于排序
  lastActivityRelative: string   // "2 小时前"，服务端统一计算，口径与 CommitLite.relativeTime 一致
  readError?: string | null      // 非空 = 该 repo 读取失败，按错误态展示（见 §5.4），不计入三色
  scannedAt: string
}

// ---- 第二屏：单 repo 分支地图 ----
interface RepoDetail {
  id: string
  name: string
  path: string
  status: StatusLevel
  headline: string
  trunk: { name: string; tip: CommitLite; commits: CommitLite[] } | null // commits: 近期主干提交，新→旧（时间轴）
  trunkInferred: 'explicit' | 'guessed' | 'none'  // 主干推断的可信度（见 §5.1 / §12 降级）
  hasRemote: boolean
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  scannedAt: string
}

interface BranchInfo {
  name: string
  tip: CommitLite
  upstream: string | null
  pushState: 'pushed' | 'unpushed' | 'no-upstream' // unpushed=领先 upstream；no-upstream=无跟踪
  aheadOfTrunk: number
  behindOfTrunk: number
  mergedIntoTrunk: boolean   // 仅 merge-base --is-ancestor 的 100% 确定结论（见 §5.1），永不被推断态污染
  squashMergeLikely: boolean // 内容推断：patch-id 与某主干 commit 相同（见 §5.3）。仅在 mergedIntoTrunk=false 时有意义
  mergedAt: string | null    // 合并回流曲线的目标 commit hash（确定态来自 ancestry-path，推断态来自 patch-id 匹配，见 §13.4）；查不到为 null
  forkPoint: string | null   // 与主干的 merge-base（真实分叉点，见 §13.4）
  commits: CommitLite[]      // 自分叉点以来的本分支提交（forkPoint..tip，封顶 N，新→旧），地图按时间布点
  worktree: string | null    // 被哪个 worktree checkout（无则 null）
  isHead: boolean            // 是否为某 worktree 的当前 HEAD（mock 里圈出的点）
  isActive: boolean          // 活跃/全部 过滤依据：未推送 OR 脏 OR 近 N 天有动静
  tags: string[]             // 指向 tip 的 tag
  status: StatusLevel
  statusLine: string         // "领先 2 · 未推送 · 有改动"，模板生成
}

interface WorktreeInfo {
  name: string               // 目录名；主 checkout 记为 'main checkout'
  path: string
  branch: string | null      // detached 时为 null
  head: string               // commit hash
  isPrimary: boolean         // 是否主工作树
  dirty: boolean
  uncommittedCount: number
}

// 按 hash 查 commit（CommitLite 已含 parents: number / tags / body，此处只追加专属字段，
// 不重定义同名字段——避免与 CommitLite.parents:number 类型冲突）
interface CommitDetail extends CommitLite {
  parentHashes: string[]        // 父 commit 完整 hash 列表
  containingBranches: string[]  // git branch --contains
}
```

排序与状态色由 `attentionReasons` 派生：非空 → `attention`（按原因严重度排序）；空且有动静 → `synced`；长期无动静/空仓 → `idle`。

### 11.2 笔记层（SQLite）

```sql
CREATE TABLE notes (
  id            TEXT PRIMARY KEY,   -- uuid
  repo_id       TEXT NOT NULL,      -- 对应 RepoSummary.id
  target_kind   TEXT NOT NULL,      -- 'commit' | 'branch' | 'repo'
  target_ref    TEXT NOT NULL,      -- commit hash | 分支名 | repo id
  pinned_commit TEXT,               -- 撰写时所针对的 commit hash（用于判过期）
  body          TEXT NOT NULL,      -- 意图/解释文本
  author_kind   TEXT NOT NULL,      -- 'agent' | 'human'
  author_id     TEXT,               -- agent 标识，可空
  created_at    TEXT NOT NULL,      -- ISO
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_notes_repo   ON notes(repo_id);
CREATE INDEX idx_notes_target ON notes(repo_id, target_kind, target_ref);

CREATE TABLE watched_roots (     -- 设计形态；v1 实际未建此表，见下方落地说明
  path     TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);
```

**落地说明（与设计的有意divergence）**：v1 实际把 `watched_roots` 落在 `~/.lookgit/config.json`（纯 JSON，见 `server/config.ts`），**不是** SQLite——配置项极少、零查询需求，JSON 已经够用，没必要为此引入数据库依赖。`notes` 表本身连同 SQLite 整体**完全未实现**（v1 不开 agent 写接口，没有消费者）。SQLite 仍是 v1.1 笔记层落地时的选型，但 `watched_roots` 不必跟着搬过去——除非以后笔记层和配置真的需要同一份事务/查询能力。

- **过期不落库、按需计算**：取笔记时比对 `pinned_commit` 与当前 target 的 tip，不同则在 API 输出里标 `stale: true`（§6.4 第 4 条）。
- **出处随取随出**：`author_kind` / `author_id` 永远跟着笔记返回，前端据此把"agent 的话"与"git 事实"在视觉上分开（§6.3 / §6.4 第 3 条）。
- **待补：已删除分支历史痕迹**（见 §9）。大致用 `target_kind='branch'` 这条路，但单纯一个 `body: TEXT` 装不下"删除时的 ahead/behind、fork 点、merge 状态"这类结构化字段——真正建表时需要决定是塞进 `body`（存 JSON）还是给这一类记录单独加几列。这里先记下问题，不在此预先定具体列名，等实现时一并定。诚实分类标记也要一起定：这类记录的 `author_kind` 既不是 `'agent'` 也不是真正意义上的 `'human' 撰写的解释`，而是"LookGit 自己被动观察生成的"——现有二选一的 `author_kind` 枚举可能不够用，需要扩展（如加一个 `'system'`）。

### 11.3 前端 API（Hono，只读 JSON）

| 方法 | 路径 | 返回 | 说明 |
|---|---|---|---|
| GET | `/api/repos` | `RepoSummary[]` | 第一屏；已按留意度排序。`?refresh=1` 强制重扫。 |
| GET | `/api/repos/:id` | `RepoDetail` | 第二屏分支地图。返回**全部**分支并带 `isActive`，活跃/全部由前端切换，省往返。 |
| GET | `/api/repos/:id/commits/:hash` | `CommitDetail` | 按 hash 查任意 commit（不限于当前分支地图显示窗口内的）。`hash` 校验为 4-64 位十六进制，格式不对 400、查无此 commit 404——绝不把原始输入传给 git（防 flag 注入）。前端入口：`RepoDetailView` 里一个默认收起的「按 hash 查 commit」小开关（`CommitLookup` 组件），跟 §13.6 点击图上节点看详情是两条独立路径，互不影响。 |
| POST | `/api/refresh` | `{ scannedAt }` | 重扫所有 root（对应"刷新"按钮）。 |
| GET | `/api/roots` | `string[]` | 监视的文件夹。 |
| POST | `/api/roots` | `string[]` | body `{ path }`，加文件夹并触发发现。 |
| DELETE | `/api/roots` | `string[]` | body `{ path }`，移除。 |

笔记相关端点（`GET/POST /api/repos/:id/notes`）**v1.1+ 再开**；v1 先把表建好、不暴露写入。

### 11.4 Agent 接口映射（v1.1，MCP）

MCP 工具与上面**一一对应**，强制落实 §6.4 第 1 条"只读状态 + 只能追加笔记，绝不写 git"：

- `list_repos` → `GET /api/repos`
- `get_repo` → `GET /api/repos/:id`
- `lookup_commit` → `GET /api/repos/:id/commits/:hash`
- `add_note` → 仅写 `notes` 表（`author_kind='agent'`），无任何 git 写通道。

---

## 12. 白话模板（确定性，无 LLM）

目标：给定状态数据必出同一句话，可预测、离线、永不胡说（§3）。所有文案直接消费 §11 的 `BranchInfo` / `AttentionReason`，不引入新判断。

两个寄存器：

- **`statusLine`（紧凑）**：分支尾巴用，`·` 连接的短片段。例：`领先 2 · 未推送 · 有改动`。
- **`headline`（成句）**：列表行与分支地图彩条用，完整的平静句子。例：`feature/login 领先主干 2 个提交、还没推送，工作区里有未提交的改动。`

### 12.1 原子片段表

| 数据条件 | 紧凑片段 | 成句片段 |
|---|---|---|
| 是主干本身 | `主干` | （作主语时省略，不narrate关系） |
| `!trunkKnown`（主干推断彻底失败） | `主干未知` | `无法确定主干，没法比对` —— 优先级高于 ahead/behind 等关系片段（此时它们强制为 0，不代表真的同步），且**不参与 synced 折叠** |
| `aheadOfTrunk>0, behindTrunk=0` | `领先 {a}` | `领先主干 {a} 个提交` |
| `behindOfTrunk>0, aheadOfTrunk=0` | `落后 {b}` | `落后主干 {b} 个提交` |
| `aheadOfTrunk>0 且 behindOfTrunk>0` | `分叉 +{a}/-{b}` | `与主干分叉（领先 {a}、落后 {b} 个提交）` |
| `mergedIntoTrunk 且 ahead=0` | `已合入` | `已合入主干` |
| `squashMergeLikely`（且 `!mergedIntoTrunk`） | `可能已合并` | `内容疑似已合并到主干（基于比对，非完全确定）` |
| `pushState='unpushed'` | `未推送` | `还没推送` |
| `pushState='pushed'` | `已推送` | `已推送`（仅在无其它要点时出现） |
| `pushState='no-upstream' 且 hasRemote` | `无跟踪` | `没有远程跟踪` |
| 仓库 `!hasRemote` | `无远程` | `没有远程仓库` |
| `unmerged`（ahead>0 且未合入且未推送/无跟踪） | `本地独有` | `本地独有，还没合入 {trunk}` |
| `dirty` | `有改动` | `工作区里有未提交的改动`；当它是 headline 主因且在主干上 → `有 {n} 个文件还没提交` |
| `clean` | `干净` | `工作区干净` |
| `detached` | `游离 HEAD` | `处于游离 HEAD（不在任何分支上）` |
| `tags` 非空 | `tag {t}` | `并打了标签 {t}` |

### 12.2 `statusLine` 组合规则

顺序固定：`[关系] · [推送/合入] · [工作区]`，不适用的片段直接略过。

- **synced 折叠**：当 `status='synced'`（无任何 attention 原因）且不落后 → 整条折叠为 `已同步`；若该分支是主干，写 `主干 · 已同步`。避免把"没事"也铺成三段。（落后但其余正常的分支不折叠，仍显示 `落后 N · …`。`squashMergeLikely=true` 或 `trunkKnown=false` 也都不折叠——不确定 / 没法比对，不能被"已同步"吞掉。）
- **同语义去重**：`unmerged` 与 `unpushed` 可能同时成立，statusLine 只显示严重度更高的一个（取 `本地独有`），不并列。`squashMergeLikely=true` 时优先于 `unmerged`/`unpushed` 显示（不再说"本地独有"，改说"可能已合并"），且不计入 attention 原因（见 §5.3）。
- 例：`领先 2 · 未推送 · 有改动`；`领先 1 · 已推送 · 干净`；`主干 · 已同步`；`落后 3 · 已推送 · 干净`。

### 12.3 `headline` 组合规则

`headline` 叙述该对象**最值得关注的那个分支/worktree**（"高亮对象"，见 §12.4）。

成句结构：`{主语} {分支态组}，{工作区态组}。`

- **分支态组** = 关系片段 +（推送/合入/本地独有片段），组内用 `、` 连接。
- **工作区态组** = 工作区片段（dirty / 干净）。
- 两组之间用 `，`；句末 `。`。任一组为空则连同其分隔符一并省略。
- **主语**：高亮对象不是主干时，前置分支名（`feature/login …`）；是主干（repo-on-main 场景）时省略主语，直接从工作区态说起。

示例（对应 mock）：

- ahead2 + unpushed + dirty，分支 feature/login → `feature/login 领先主干 2 个提交、还没推送，工作区里有未提交的改动。`
- 主干 main 上 dirty 5 个文件 → `有 5 个文件还没提交。`
- worktree 上 ahead4 + 本地独有 + 未合入 → `agent 分支领先主干 4 个提交、本地独有，还没合入 main。`

### 12.4 高亮对象与严重度排序

`headline` 选取与列表排序共用一套**严重度顺序**（越靠前越该关注）：

1. `detached` 游离 HEAD
2. `dirty` 有未提交改动（最易丢）
3. `unmerged` 本地独有、未合入（agent 产出未集成）
4. `unpushed` 领先 upstream 未推送
5. `no-remote` 有本地提交却无远程可备份

（`behind` 落后主干不参与——属中性信息，不升 attention、不抢高亮。）

repo 的高亮对象 = 命中最高严重度原因的分支/worktree；无任何原因则取主干，`headline` 走兜底。

### 12.5 兜底与特例

- **完全 synced**：主干且无任何要点 → `一切已同步。`；非主干但已推送且干净 → `已推送，工作区干净。`
- **idle / 空闲**：长期无动静 → `空闲。`；无远程且干净 → `空闲，没有远程仓库。`
- **空仓库**：无 commit → `空仓库。`
- **主干推断失败**（`trunkInferred='none'`，见 §5.1 / §13）：略去全部"主干"关系片段，`headline` 降级为 `无法确定主干，已列出各分支。`，分支态只保留推送/工作区。
- **good news 追加**：`tags` 片段、`已合入主干` 仅在句尾以追加形式出现，不与 attention 片段抢位。

---

## 13. 分支地图视图规范

### 13.0 默认竖向列表（2026-09-15 更新）

仓库详情默认采用「竖向列表」，原有横向时间轴保留为「横向地图」切换项。下文 13.1–13.7 的时间轴、紧凑泳道和固定详情卡片规则仅适用于横向地图。

- 列表上方常驻分支名称、状态、当前工作区标记、推送状态与未提交文件数；展开分支可查看路径、分叉点和相对主干状态。游离工作区单列，不伪装成提交。
- 一个真实 commit hash 只占一行，共享该 tip 的分支标签放在同一行。提交标题、标签、作者、短 hash 和相对时间默认可见；完整正文与父提交在本行展开，允许同时展开多行，支持键盘操作。
- 左侧连线使用 Git 返回的 `parentHashes`。子提交排在父提交上方，可并行的提交按时间从近到远排列。行距按内容高度分配；滚轮滚动页面，不承担缩放。
- 三列布局为「时间 / 分支关系 / 提交内容」。左侧常驻本机时区的日期和时分，跨日加分隔；相邻已显示提交相差至少 24 小时显示间隔，顶部标明当前记录的日期范围和跨度。行距经过压缩，不表示实际时长，也不宣称覆盖完整开发周期。时间倒置时优先保留拓扑关系并提示。
- 主干第一父链固定在最左侧，使用主题中的主干色；其他现存分支按名称确定稳定颜色，过滤与排序不改变颜色。分支状态、节点旁名称、图例和对应路线同色。共享历史只画一次，多个指针可共用一个节点；路线用于组织第一父链，不能据此判定提交最初创建的分支。
- 图例常驻：普通实点、合并空心、revert 琥珀色、被撤销红色、HEAD 外环、未提交虚点、游离菱形和 tag 标签；状态色与分支身份分别表达。被撤销不等于已证明有缺陷，因此不再使用「被撤销提交」作为自动判定。tag 只出现在实际有标签的提交旁，不改变节点形状。
- 未提交与游离工作区单独显示为当前扫描状态，长虚线关联真实 HEAD，并提供定位链接；不将扫描时刻伪装成提交时刻。列标题随列表滚动保持可见；窄屏只压缩连线间距，节点保持圆形或菱形。
- squash 内容相似仅保留为分支状态中的推断，不画成真实父子关系。父提交不在扫描窗口中时用虚线末端表示边界，不跨越缺失记录臆造连线。
- 保留已有「活跃 / 全部」范围和近期扫描窗口；页面注明更早的提交可按 hash 查询。此视图仍为只读。

以下为保留的横向地图规范：

参考范式：**泳道即 git 图，且横轴 = 时间**。借鉴参考图的语言：多分支 lane、commit 按时间布点、分叉/合并连线、合并提交空心环、tag 徽章、每分支身份色。采用**方案 B：每条分支显示多个 commit**。

### 13.1 总体布局与可缩放时间轴

- **主干在上、分支朝下**。**X 轴 = 真实时间轴，且可缩放/平移**：滚轮缩放（以光标处时间为锚点放长/缩短），拖动平移。commit 按真实提交时间布点。
- **X 轴宽度响应容器实际宽度**（`ResizeObserver`），不是固定逻辑宽度被等比拉伸——宽屏下时间轴真的摊开更多内容（commit 间天然更松散，少依赖 zoom 才能分开），不是文字/节点一起变大。分支地图所在的详情页容器本身也比列表页更宽（`max-width: min(1600px, 80vw)`，列表页维持窄列更易扫读，两者诉求不同，分别处理）。
- **Y 轴 = 泳道分类**，每条分支一条，**高度压缩到仅容纳线条+节点**（不再按"必须容纳两行常驻文字"撑高度，见 §13.2）；主干是顶部 lane。**排序规则与第一屏列表同一套心智**（不是自由排列）：主干永远最顶；其余按"该不该关注"分组（attention 在前）；组内按最近提交时间降序。语义相关的分支（如同一 agent 批量产出、状态相近、时间相近）会因此自然聚在一起，不需要按命名规则猜测分类——后者在 agent 生成的分支名（如 `codex/xxx`）上不可靠。
- **重叠是允许的**：时间近的 commit 会堆叠——这没关系，**放长 X 轴（zoom in）即可把它们释放、看清**。不再为避免重叠而牺牲时间真实性（上一版"均匀分槽"放弃了时间真实性，本版改回真实时间 + 缩放）。
- 一图只服务一个 repo；「活跃」默认（少 lane），「全部」纵向滚动。**实测**（合成 91 分支仓库，§13.7）：泳道压缩后 22 分支 ≈ 556px 高（多数笔记本屏幕一屏装完，不用滚动），91 分支 ≈ 1936px（仍需滚动，但比压缩前的 ~5200px 好得多）——压缩不能让任意数量都做到零滚动，但大幅提高了实际不用滚动的分支数量门槛。

### 13.2 泳道标签（图上不显示文字，详情进固定卡片）

- **默认只有色块 + 线条**，不常驻任何文字——这是与早期版本（左侧常驻两行文字）的关键差异：常驻文字逼着每条泳道留出能放两行字的高度，是"多分支必须很高"的根因。拿掉常驻文字后泳道高度只由线条/节点决定，能压缩到约原来的 1/2.5。
- **唯一例外是主干**：只有一条、固定在顶部，给它留一个小的常驻短标签（`{trunk 名} · 主干` + statusLine），因为它不参与"分支数越多越高"的问题，常驻没有代价。
- **完整名字 + 状态不进图，进图外的固定卡片**（§13.6）：图本身只负责"点了哪条/哪个点"，不在画布上叠加任何文字浮层。这是吸取了一版真实教训后的修正——早期方案在图上用一个跟着泳道 y 坐标走的浮层显示名字，**实测会定位错乱、飘到不该在的位置**；而且承载浮层的那层点击命中区覆盖了整条泳道的全宽，把背后负责拖拽的背景层完全挡住，**拖拽功能直接失效**。两个问题的根因都是同一个：图上的命中区/浮层管得太宽。现在的命中区只贴着可见的线/点本身（见下），不再有 hover 态，图永远是纯净的可视化层。
- **点击是唯一交互（覆盖触屏）**：命中区是线条/节点本身外扩的一条不可见描边（`LINE_HIT_W=13`，明显小于泳道高度 `LANE_H=20`），不是整条泳道的全宽——这样泳道之间、线条上下都留有空白，背景层仍能正常接收拖拽手势。点选中的分支自身线条会稍微加粗作为"当前选中"的轻量提示，但不浮现文字。
- statusLine（领先/落后/推送/改动）字段仍由模板生成，但不再贴在画布上——它和完整分支名一起进 §13.6 的固定卡片。

### 13.3 主干时间线与版本（tag）

- 顶部一行，主干 commit 按时间布点。
- **版本可见**：指向主干 commit 的 tag 作**徽章**贴在该 commit 旁（v1.0 / v2.0 …，参考图 1 的版本标注）。引擎需给出每个主干 commit 的 tag，不只 tip。
- **合并提交（父数 ≥ 2）画空心环**；普通提交实心点。

### 13.4 分支：多 commit + 分叉 / 合并（必须连到具体主干版本）

- 每条 lane 显示其**自分叉点以来的若干 commit**（`forkPoint..tip`，封顶 N，按时间布点），用 lane 身份色连成线。
- **分叉连线**：从主干上**那个具体的分叉 commit**（`forkPoint`）连线下落到该 lane 最早的 commit——一眼看出"从哪个主干版本开出来的"。多分支共享同一分叉 commit 时共用扇出。
- **合并连线**：已合入的 lane，从其最后一个 commit 画曲线**上行汇入主干上那个具体的合并 commit**（`mergedAt`）——一眼看出"合回了哪个主干版本"。只显示"已合入"文字而不连线是不够的（参考图 1）。算不出 `mergedAt` 时降级淡化、**不画错**。
- **推断态合并连线**（`squashMergeLikely=true`）：同样画曲线汇入匹配到的那个主干 commit，但用**虚线 + 更低透明度**与确定态（实线）区分——视觉上一眼能分清"确定合入"和"疑似合入"，不能让用户误把推断当确定（见 §5.3）。
- **硬约束（真实 bug，已修复）**：主干时间线显示的 commit 窗口必须覆盖**当前要画的每一条曲线的真实落点**，不能只看"最近 N 个"。曾发现：`trunk.commits` 只缓存最近 12 个（~27 小时），但活跃仓库里多数分支的 `forkPoint`/`mergedAt` 比这早得多——本该因为"主干缓存里找不到"而不画的曲线，却因为**碰巧在另一条分支自己的 commits 数组里找到了同一个 hash**（前端有一个全局共享的 hash→时间对照表），所以曲线被画出来了，且时间位置是对的，但主干那条线根本没延伸到那么早，看起来像"飘在空中接不上主干"。**修法**：扫完全部分支后，把它们引用到、但还不在主干缓存里的 `forkPoint`/`mergedAt` 单独补抓（各一次 `git log -1`，并行，数量有限，对 示例仓库 这种 22 分支仓库实测加了 ~25 个补抓、整体耗时无明显变化），合并进 `trunk.commits` 再排序——保证主干时间线**始终是所有曲线真实落点的并集**，不止是"最近若干个"。已用真实仓库验证：修复前 21/22 条分支的分叉点落在缓存窗口外，修复后 0 条缺失，曲线起点/终点几何坐标全部落在主干线实际跨度内。

身份色 = 区分分支（无固定语义，节点填充用）；**形状与连线才是语义**。连线分两类：**前进**（只新增历史、安全、git 自动可见）与**回退**（抹除或改写已有历史、破坏性、多需 reflog）——这条轴同时区分了"安全 vs 危险"和"可见 vs 需翻 reflog"。revert 按**机制**归前进（前进式撤销）。可观察性三档：**git 自动** / **内容推断·不确定** / **需 reflog 或意图层(§6)**。定稿图例见 [assets/branch-legend.svg](assets/branch-legend.svg)。

**节点类型**

| 节点 | 画法 | 可观察性 |
|---|---|---|
| 普通提交 | 实心点 | git 自动 |
| 合并提交 | 空心环（父数 ≥ 2；一节点两父，内容不塌缩） | git 自动 |
| 当前 HEAD | 大同心圆 | git 自动 |
| 版本（tag） | 徽章贴于对应 commit | git 自动 |
| 未提交 / WIP | 虚线幽灵节点 | git 自动 |
| 游离 HEAD | 浮空虚线节点（单独 lane） | git 自动 |
| revert 提交 | 棕色点（message 可认） | git 自动 |
| 被撤销提交 | 红色点（被 revert 的那个） | git 自动·需 body |
| 废弃 / 丢弃 | 淡化虚线 + 斜杠（被甩掉的旧提交） | 需 reflog / 意图层 |

**连线 · 前进**（只新增历史 · 安全 · git 自动）

| 连线 | 含义 | 可观察性 |
|---|---|---|
| 开分支（fork） | 从主干某 commit 岔出 | git 自动 |
| 分支推进 | 分支自己的提交序列 | git 自动 |
| 合并 · merge commit（分支→主干） | 留 merge 节点、ancestry 完整 | git·判得准 |
| 合并 · fast-forward（分支→主干） | 指针前移、无 merge 节点 | 难判·推断 |
| 合并 · squash（多个提交 → 主干一个提交） | 分支 N 个提交合成主干上一个新 hash，ancestry 断裂（原提交仍在分支） | 内容推断·不确定 |
| revert（前进式撤销 / 退版本） | 追加反做 commit 撤销某提交；R→C 链接（含 main 退版本，安全留历史） | git·需 body |

**连线 · 回退**（抹除或改写已有历史 · 破坏性 · 多需 reflog）

| 类型 | 含义 | 可观察性 |
|---|---|---|
| squash 压缩（分支内 N→1） | 把自己分支多个提交压成更少，原提交废弃（改写自己历史）。**≠ squash-merge，≠ 合并提交** | 原提交需 reflog |
| rebase 改写 | 把分支提交重放到新基底，原提交废弃（新 hash） | 需 reflog |
| main reset（破坏式退版本 · 指针后移） | main 指针退回旧 commit，后续提交丢弃（需 force-push） | 需 reflog |

**节点填充色**用身份色区分分支；状态（dirty/未推送/落后）改由 statusLine 文字 + 幽灵节点表达（§3）。

### 13.6 详情区：两块固定卡片（分支信息 / 节点信息）

- **图下方两块固定区域，常驻不隐藏**（不是点击才出现的浮层/弹窗）：**分支信息**在上、**节点信息**在下。页面自上而下的顺序是**分支地图 → 图例 + 缩放提示 → 分支信息 → 节点信息**——图例紧跟在图后面（"怎么读这张图"的说明就该挨着图），选中详情放在最后（更像"当前选中项的检视面板"）。没有任何选中时，两块都只显示标题占位（"未选择分支" / "未选择节点"）——卡片本身永远在，内容随选中状态变化。高度都随内容自然撑开（占位态矮、有内容态高），不固定死。
- **分支信息**：选中分支线条、或选中某个 commit 节点、或选中 detached worktree 节点时都会填充——**选中 commit 时反查它属于哪条分支**（在 `detail.branches` 里找 `commits` 包含该 hash 的那条；trunk 本身也是 `branches` 里的一条，天然覆盖），显示那条分支的完整详情（完整名、领先 / 落后、推送、合入、worktree、tag、分叉点）。"合入"字段三态：`已合入`（确定）/ `可能已合并（基于内容比对，非完全确定）`（推断）/ `未合入`。
- **节点信息**：只在选中**具体 commit 节点**时填充（subject / 完整 body / hash / 作者 / 时间 / 父数 / revert 关系）——这些字段已随 `BranchInfo.commits` / `trunk.commits` 一次性带回，直接读，**不需要**单独的 commits 端点（§11.3 那个按 hash 查任意 commit 的端点是另一回事，见 §14）。选中的是分支线条或 worktree（不是具体节点）时，节点信息保持占位。
- 两块卡片没有"关闭"按钮——点击图上空白处（背景层）会取消选中，两块卡片随之回到占位态；这是已有的取消选择手势，不需要额外的 ✕。

### 13.7 缩放交互与降级

- **X 轴缩放/平移**是控制密度的主手段：滚轮 zoom（锚定光标时间）、拖动 pan；切换 repo / 模式时自动 fit 到数据范围。
- 重叠由 zoom 解决，不靠均匀分槽；节点命中区足够大，保证缩放态下仍可点。
- 「活跃」默认少 lane；「全部」纵向滚动。
- 主干推断失败：无时间线，分支以 lane 列出 + 提示"无法确定主干"。
- **极多分支时的验证**（合成仓库实测，91 分支：30 已 merge、61 未合并）：SVG 高度随 lane 数线性增长（泳道压缩后实测：22 lane ≈ 556px，91 lane ≈ 1936px，见 §13.1/§13.2），原生滚动下各 lane 几何位置、颜色、连线均正确——**不需要虚拟化**，结构上撑得住。真正瓶颈在数据而非渲染：详情扫描 ~4s，主要花在"确实未合并"的分支必须扫完 §5.3 那 80 个候选才能下结论（已合并分支走 ancestry 快速路径，不受影响）。已加分支级并发限流（`createLimiter`，`BRANCH_SCAN_CONCURRENCY=12`）防止分支极多时叠出几百个同时存活的 git 子进程。**留给以后的选项（未实现）**：分支数超过某阈值时整体跳过 squash 推断，用速度换内容洞察。

---

## 14. 待定决策（Open Questions）

当前为空——上一轮列出的待定项均已处理并验证，结论已归档到对应章节：§5.1（跨分支并行）、§12.1/§12.2（`trunkKnown` 措辞与 synced 折叠排除）、§13.7（极多分支的实测验证）、§4.1（加文件夹，已是实现状态）。后续若有新的待定点，再追加到本节。
