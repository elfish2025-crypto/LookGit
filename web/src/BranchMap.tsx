import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BranchInfo, CommitLite, RepoDetail } from '../../shared/types'

// 身份色调色板：刻意排除 REVERT_COLOR(#BA7517) 与 BAD_COLOR(#E24B4A)，避免与 revert/坏提交语义色混淆。
const PALETTE = ['#1D9E75', '#7F77DD', '#D85A30', '#378ADD', '#D4537E', '#639922', '#5DCAA5', '#26215C']
const TRUNK_COLOR = '#888780'
const REVERT_COLOR = '#BA7517' // 棕：revert 提交
const BAD_COLOR = '#E24B4A' // 红：坏提交（被 revert）

const isRevertCommit = (c: CommitLite) => !!c.revertsHash || /^Revert\b/.test(c.subject)

// 布局：W 由容器实际宽度驱动（见下方 ResizeObserver），不再是固定值——宽屏下真正
// 摊开时间轴内容，不是整张图被等比拉大。GUTTER_W 只给主干那一行的常驻短标签用；
// 其余分支不在图上显示文字——完整名字/状态在 RepoDetailView 的固定卡片里（分支信息/
// 节点信息），不放在图里，图只负责"点击选中"，不再有 hover、不再有跟着泳道走的浮层
// （浮层曾经定位错乱、且挡住了拖拽，见用户反馈）。
const MIN_W = 420
const GUTTER_W = 84
const RIGHT_MARGIN = 16
const PLOT_X0 = GUTTER_W + 8
const LANE_H = 20
const TOP = 112
const AXIS_LINE_Y = 30
const AXIS_LABEL_Y = 16
const TAG_ROW_H = 12
const MAX_TAG_ROWS = 6
const DOT_R = 4
const HEAD_R = 6
const SEL_R = 7
const HIT_R = 9 // 命中圈半径，必须 < LANE_H/2，否则相邻泳道的点击区会叠在一起
const LINE_HIT_W = 13 // 线的不可见加宽点击描边，必须 < LANE_H，留出行间空白给拖拽
const SEL_LINE_W = 3 // 选中分支自身线条加粗，作轻量"当前选中"提示
const GHOST_R = 4
const GHOST_OFFSET = 12
const MIN_SCALE = 1e-11 // px per ms（极度缩小）
const MAX_SCALE = 5e-3 // px per ms（极度放大）
const DAY = 86_400_000

interface View {
  origin: number // x=PLOT_X0 处对应的时间（ms）
  scale: number // px per ms
}

interface Row {
  key: string
  label: string
  color: string
  statusLine: string
  isHead: boolean
  dirty: boolean
  commits: CommitLite[]
  forkPoint: string | null
  mergedAt: string | null
  mergeConfirmed: boolean // true=ancestry 确定（实线），false=squashMergeLikely 内容推断（虚线，design §13.4）
  floating: boolean
}

const t = (iso: string) => Date.parse(iso)

const HOUR = 3_600_000
const MIN = 60_000
// 刻度粒度随可见时间跨度自适应：跨度越小、时间越细（年→月日→时分→秒）。
const fmtTick = (ms: number, spanMs: number) => {
  const d = new Date(ms)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  if (spanMs > 730 * DAY) return `${d.getFullYear()}`
  if (spanMs > 60 * DAY) return `${d.getFullYear()}/${M}`
  if (spanMs > 2 * DAY) return `${M}/${D}`
  if (spanMs > 3 * HOUR) return `${M}/${D} ${h}:${mi}`
  if (spanMs > 5 * MIN) return `${h}:${mi}`
  return `${h}:${mi}:${s}`
}

export function BranchMap({
  detail,
  branches,
  selectedKey,
  onSelect,
}: {
  detail: RepoDetail
  branches: BranchInfo[]
  selectedKey: string | null
  onSelect: (key: string | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [containerWidth, setContainerWidth] = useState(900)

  // 容器实际宽度驱动 viewBox 逻辑宽度——宽屏下时间轴摊开更多内容，而不是整张图被等比放大。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setContainerWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = Math.max(MIN_W, containerWidth)
  const PLOT_X1 = W - RIGHT_MARGIN

  const trunkName = detail.trunk?.name ?? null
  const trunkBranch = branches.find((b) => b.name === trunkName)
  const trunkCommits = detail.trunk?.commits ?? []
  const laneBranches = branches.filter((b) => b.name !== trunkName)
  const detached = detail.worktrees.filter((w) => w.branch === null)

  const hashTime = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of trunkCommits) m.set(c.hash, t(c.committedAt))
    for (const b of laneBranches) for (const c of b.commits) m.set(c.hash, t(c.committedAt))
    return m
  }, [detail, branches])

  const [tMin, tMax] = useMemo(() => {
    const times = [...hashTime.values()]
    if (!times.length) return [Date.now() - DAY, Date.now()]
    return [Math.min(...times), Math.max(...times)]
  }, [hashTime])

  const fitView = useCallback((): View => {
    const span = Math.max(tMax - tMin, DAY)
    const pad = span * 0.08
    return { origin: tMin - pad, scale: (PLOT_X1 - PLOT_X0) / (span + 2 * pad) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tMin, tMax, PLOT_X1])

  const [view, setView] = useState<View>(fitView)
  const fitKey = detail.id + '|' + branches.map((b) => b.name).join(',')
  useLayoutEffect(() => {
    setView(fitView())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, containerWidth])

  const xOf = (ms: number) => PLOT_X0 + (ms - view.origin) * view.scale
  const xOfHash = (h: string | null | undefined): number | null => {
    const tm = h ? hashTime.get(h) : undefined
    return tm == null ? null : xOf(tm)
  }
  const clientToVb = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return 0
    return ((clientX - r.left) / r.width) * W
  }

  // 滚轮缩放（锚定光标处时间），非 passive 以便 preventDefault。
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const vbX = ((e.clientX - r.left) / r.width) * W
      setView((v) => {
        const tAt = v.origin + (vbX - PLOT_X0) / v.scale
        const factor = Math.exp(-e.deltaY * 0.0012)
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
        return { scale, origin: tAt - (vbX - PLOT_X0) / scale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [W])

  const startPan = (e: React.MouseEvent) => {
    const sx = clientToVb(e.clientX)
    let moved = false
    const so = view.origin
    const ss = view.scale
    const move = (ev: MouseEvent) => {
      const vb = clientToVb(ev.clientX)
      if (Math.abs(vb - sx) > 3) moved = true
      setView((v) => ({ ...v, origin: so - (vb - sx) / ss }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (!moved) onSelect(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const rows: Row[] = laneBranches.map((b, i) => ({
    key: `branch:${b.name}`,
    label: b.name,
    color: PALETTE[i % PALETTE.length],
    statusLine: b.statusLine,
    isHead: b.isHead,
    dirty: b.statusLine.includes('有改动'),
    commits: b.commits,
    forkPoint: b.forkPoint,
    mergedAt: b.mergedIntoTrunk || b.squashMergeLikely ? b.mergedAt : null,
    mergeConfirmed: b.mergedIntoTrunk,
    floating: false,
  }))
  const detachedRows: Row[] = detached.map((w) => ({
    key: `wt:${w.path}`,
    label: w.name,
    color: TRUNK_COLOR,
    statusLine: `游离 HEAD${w.dirty ? ' · 有改动' : ''}`,
    isHead: true,
    dirty: w.dirty,
    commits: [],
    forkPoint: null,
    mergedAt: null,
    mergeConfirmed: false,
    floating: true,
  }))
  const lanes = [...rows, ...detachedRows]
  const height = TOP + lanes.length * LANE_H + 24
  const plotH = height

  // revert / 坏提交 上色 + R→C 链接（词表"连线·前进"）
  const allShown = [...trunkCommits, ...laneBranches.flatMap((b) => b.commits)]
  const revertedSet = new Set(allShown.map((c) => c.revertsHash).filter((h): h is string => !!h))
  const isBad = (c: CommitLite) => {
    for (const r of revertedSet) if (c.hash.startsWith(r) || r.startsWith(c.shortHash)) return true
    return false
  }
  const colorOf = (c: CommitLite, identity: string) =>
    isBad(c) ? BAD_COLOR : isRevertCommit(c) ? REVERT_COLOR : identity

  const posByHash = new Map<string, { x: number; y: number }>()
  if (detail.trunk) for (const c of trunkCommits) posByHash.set(c.hash, { x: xOf(t(c.committedAt)), y: TOP })
  lanes.forEach((row, i) => {
    if (row.floating) return
    const y = TOP + (i + 1) * LANE_H
    for (const c of row.commits) posByHash.set(c.hash, { x: xOf(t(c.committedAt)), y })
  })
  const revertLinks: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const c of allShown) {
    if (!c.revertsHash) continue
    const from = posByHash.get(c.hash)
    if (!from) continue
    let to: { x: number; y: number } | undefined
    for (const [h, p] of posByHash) if (h.startsWith(c.revertsHash)) { to = p; break }
    if (to) revertLinks.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }

  // 主干版本 tag 防重叠：按 x 贪心分配到最多 6 行（§13.7 — zoom 仍是主手段，这里只做静态防撞）。
  const tagPlacements = useMemo(() => {
    const items = trunkCommits
      .filter((c) => c.tags.length > 0)
      .map((c) => {
        const label = c.tags.join(' ')
        const x = xOf(t(c.committedAt))
        return { hash: c.hash, x, width: label.length * 6 + 8, label }
      })
      .sort((a, b) => a.x - b.x)
    const rowEnds: number[] = []
    const placed = new Map<string, { row: number; label: string; x: number }>()
    for (const it of items) {
      const left = it.x - it.width / 2
      const right = it.x + it.width / 2
      let row = rowEnds.findIndex((end) => left > end + 4)
      if (row === -1) row = rowEnds.length < MAX_TAG_ROWS ? rowEnds.length : MAX_TAG_ROWS - 1
      rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, right)
      placed.set(it.hash, { row, label: it.label, x: it.x })
    }
    return placed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trunkCommits, view.origin, view.scale])

  const ticks = useMemo(() => {
    const spanMs = (PLOT_X1 - PLOT_X0) / view.scale
    const out: { x: number; label: string }[] = []
    for (let i = 0; i <= 5; i++) {
      const px = PLOT_X0 + ((PLOT_X1 - PLOT_X0) * i) / 5
      const ms = view.origin + (px - PLOT_X0) / view.scale
      out.push({ x: px, label: fmtTick(ms, spanMs) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, PLOT_X1])

  function laneTipX(row: Row): number {
    if (row.floating) return PLOT_X1 - 30
    const xs = row.commits.map((c) => xOf(t(c.committedAt)))
    return xs.length ? Math.max(...xs) : PLOT_X1 - 30
  }

  function Dot({ c, x, y, color, head, tip }: { c: CommitLite; x: number; y: number; color: string; head: boolean; tip: boolean }) {
    const k = `commit:${c.hash}`
    const sel = selectedKey === k
    const merge = c.parents >= 2
    return (
      <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : k) }}>
        <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
        {sel && <circle cx={x} cy={y} r={SEL_R} fill="none" stroke="var(--text-primary)" strokeWidth={1} />}
        {head && tip && <circle cx={x} cy={y} r={HEAD_R} fill="none" stroke={color} strokeWidth={1.5} />}
        {merge ? (
          <circle cx={x} cy={y} r={DOT_R} fill="var(--surface-0)" stroke={color} strokeWidth={2} />
        ) : (
          <circle cx={x} cy={y} r={DOT_R} fill={color} />
        )}
      </g>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${height}`} role="img" style={{ display: 'block', touchAction: 'none' }}>
        <title>分支地图</title>
        <desc>可缩放时间轴；主干在上，分支从分叉 commit 岔出、合并曲线回流到具体主干 commit。滚轮缩放、拖动平移；点击线条或节点在下方固定卡片里查看分支/节点详情。</desc>
        <defs>
          <clipPath id="plotclip">
            <rect x={PLOT_X0 - 2} y={0} width={W - PLOT_X0 + 2} height={plotH} />
          </clipPath>
          <clipPath id="gutterclip">
            <rect x={0} y={0} width={GUTTER_W} height={height} />
          </clipPath>
          <marker id="revarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {/* 平移/取消选择的背景命中区 */}
        <rect x={PLOT_X0 - 2} y={0} width={W - PLOT_X0 + 2} height={plotH} fill="transparent" style={{ cursor: 'grab' }} onMouseDown={startPan} />

        <g clipPath="url(#plotclip)">
          {/* 主干线：可见线 + 不可见加宽点击描边（不挡拖拽——只在线条本身宽度内拦截点击，
              行与行之间、线条上下的空白仍留给背景层处理拖拽）。 */}
          {detail.trunk && trunkCommits.length > 0 && (
            <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(selectedKey === `branch:${trunkName}` ? null : `branch:${trunkName}`) }}>
              <line
                x1={xOf(Math.min(...trunkCommits.map((c) => t(c.committedAt))))}
                y1={TOP}
                x2={xOf(Math.max(...trunkCommits.map((c) => t(c.committedAt))))}
                y2={TOP}
                stroke="transparent"
                strokeWidth={LINE_HIT_W}
              />
              <line
                x1={xOf(Math.min(...trunkCommits.map((c) => t(c.committedAt))))}
                y1={TOP}
                x2={xOf(Math.max(...trunkCommits.map((c) => t(c.committedAt))))}
                y2={TOP}
                stroke={TRUNK_COLOR}
                strokeWidth={selectedKey === `branch:${trunkName}` ? SEL_LINE_W : 2}
              />
            </g>
          )}
          {/* 分支连线：分叉 + lane 线 + 合并回流 */}
          {lanes.map((row, i) => {
            const y = TOP + (i + 1) * LANE_H
            const midY = (TOP + y) / 2
            if (row.floating || row.commits.length === 0) return null
            const xs = row.commits.map((c) => xOf(t(c.committedAt)))
            const oldestX = Math.min(...xs)
            const tipX = Math.max(...xs)
            const forkX = xOfHash(row.forkPoint)
            const mergedX = row.mergedAt ? xOfHash(row.mergedAt) : null
            const sel = selectedKey === row.key
            return (
              <g key={`c-${row.key}`}>
                {forkX != null && (
                  <path d={`M ${forkX} ${TOP} C ${forkX} ${midY} ${oldestX} ${midY} ${oldestX} ${y}`} fill="none" stroke={row.color} strokeWidth={1.5} opacity={0.75} />
                )}
                <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : row.key) }}>
                  <line x1={oldestX} y1={y} x2={tipX} y2={y} stroke="transparent" strokeWidth={LINE_HIT_W} />
                  <line x1={oldestX} y1={y} x2={tipX} y2={y} stroke={row.color} strokeWidth={sel ? SEL_LINE_W : 2} />
                </g>
                {mergedX != null && (
                  // 确定态（ancestry）实线；推断态（squashMergeLikely，内容比对）虚线 + 更淡——
                  // 视觉上必须能分清"确定合入"与"疑似合入"，不能让推断看起来像确定（design §13.4）。
                  <path
                    d={`M ${tipX} ${y} C ${tipX} ${midY} ${mergedX} ${midY} ${mergedX} ${TOP}`}
                    fill="none"
                    stroke={row.color}
                    strokeWidth={1.5}
                    opacity={row.mergeConfirmed ? 0.55 : 0.4}
                    strokeDasharray={row.mergeConfirmed ? undefined : '4 3'}
                  />
                )}
                {row.dirty && <circle cx={tipX + GHOST_OFFSET} cy={y} r={GHOST_R} fill="none" stroke={row.color} strokeWidth={1.5} strokeDasharray="2 2" />}
              </g>
            )
          })}

          {/* revert 链接：R → 被撤销的 C */}
          {revertLinks.map((l, i) => {
            const midY = (l.y1 + l.y2) / 2
            return (
              <path
                key={`rev-${i}`}
                d={`M ${l.x1} ${l.y1} C ${l.x1} ${midY} ${l.x2} ${midY} ${l.x2} ${l.y2}`}
                fill="none"
                stroke={REVERT_COLOR}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                opacity={0.7}
                markerEnd="url(#revarrow)"
              />
            )
          })}

          {/* 主干 commit + 版本徽章（多行错位防重叠） */}
          {detail.trunk &&
            trunkCommits.map((c) => {
              const x = xOf(t(c.committedAt))
              const tag = tagPlacements.get(c.hash)
              return (
                <g key={c.hash}>
                  {tag && (
                    <text
                      x={tag.x}
                      y={TOP - 10 - tag.row * TAG_ROW_H}
                      textAnchor="middle"
                      style={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    >
                      {tag.label}
                    </text>
                  )}
                  <Dot c={c} x={x} y={TOP} color={colorOf(c, TRUNK_COLOR)} head={!!trunkBranch?.isHead} tip={c.hash === detail.trunk!.tip.hash} />
                </g>
              )
            })}

          {/* 分支 commit / 浮空节点 */}
          {lanes.map((row, i) => {
            const y = TOP + (i + 1) * LANE_H
            if (row.floating) {
              const x = laneTipX(row)
              const sel = selectedKey === row.key
              return (
                <g key={`n-${row.key}`} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : row.key) }}>
                  <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                  {sel && <circle cx={x} cy={y} r={SEL_R} fill="none" stroke="var(--text-primary)" strokeWidth={1} />}
                  <circle cx={x} cy={y} r={HEAD_R} fill="none" stroke={row.color} strokeWidth={1.5} />
                  <circle cx={x} cy={y} r={DOT_R} fill="none" stroke={row.color} strokeWidth={2} strokeDasharray="2 2" />
                </g>
              )
            }
            const tipHash = row.commits.length
              ? row.commits.reduce((a, b) => (t(a.committedAt) >= t(b.committedAt) ? a : b)).hash
              : null
            return (
              <g key={`n-${row.key}`}>
                {row.commits.map((c) => (
                  <Dot key={c.hash} c={c} x={xOf(t(c.committedAt))} y={y} color={colorOf(c, row.color)} head={row.isHead} tip={c.hash === tipHash} />
                ))}
              </g>
            )
          })}
        </g>

        {/* 主干常驻短标签（唯一常驻文字；其余分支默认无文字，见上方整行命中区 + 下方浮层） */}
        <g clipPath="url(#gutterclip)" style={{ pointerEvents: 'none' }}>
          {detail.trunk && (
            <g>
              <text x={8} y={TOP - 2} style={{ fontSize: 13, fontWeight: 500, fill: TRUNK_COLOR }}>{detail.trunk.name} · 主干</text>
              <text x={8} y={TOP + 13} style={{ fontSize: 11, fill: 'var(--text-secondary)' }}>{trunkBranch?.statusLine ?? '主干'}</text>
            </g>
          )}
        </g>

        {/* 时间轴（顶部） */}
        <line x1={PLOT_X0} y1={AXIS_LINE_Y} x2={PLOT_X1} y2={AXIS_LINE_Y} stroke="var(--border)" strokeWidth={1} />
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={tk.x} y1={AXIS_LINE_Y - 3} x2={tk.x} y2={AXIS_LINE_Y + 3} stroke="var(--border-strong)" strokeWidth={1} />
            <text x={tk.x} y={AXIS_LABEL_Y} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--text-muted)' }}>{tk.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
