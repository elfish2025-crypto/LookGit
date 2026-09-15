import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { BranchInfo, RepoDetail, WorktreeInfo } from '../../shared/types'
import { branchColor, buildCommitTimeline, elapsedLabel, timeGap, type TimelineRow, type Track } from './timelineLayout'

const x = (lane: number) => 16 + lane * 24
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const clockLabel = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const isRevert = (c: TimelineRow['commit']) => !!c.revertsHash || /^Revert\b/.test(c.subject)

function Symbol({ kind, cx = 12, cy = 12, color = 'currentColor', head = false, hollow = false }: {
  kind: 'normal' | 'merge' | 'revert' | 'reverted' | 'dirty' | 'detached'; cx?: number; cy?: number; color?: string; head?: boolean; hollow?: boolean
}) {
  const ink = kind === 'revert' ? 'var(--attention)' : kind === 'reverted' ? 'var(--error)' : color
  return <>
    {head && <circle cx={cx} cy={cy} r="9" fill="var(--surface-0)" stroke={ink} strokeWidth="1.5" />}
    {kind === 'detached'
      ? <path d={`M ${cx} ${cy - 6} l 6 6 l -6 6 l -6 -6 Z`} fill="var(--surface-0)" stroke={ink} strokeWidth="1.5" />
      : <circle cx={cx} cy={cy} r="4.5" fill={kind === 'merge' || kind === 'dirty' || hollow ? 'var(--surface-0)' : ink} stroke={ink} strokeWidth="2" strokeDasharray={kind === 'dirty' ? '2 2' : undefined} />}
  </>
}
function LegendItem({ children, kind, head = false }: { children: ReactNode; kind: Parameters<typeof Symbol>[0]['kind']; head?: boolean }) {
  return <span><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><Symbol kind={kind} head={head}/></svg>{children}</span>
}
interface WorkLink { wt: WorktreeInfo; lane: number; color: string; target: number }

/** The upper SVG contains bends; the flex tail extends lines with expanded text. */
function GraphCell({ width, children, tail, node }: { width: number; children: ReactNode; tail: (Track & { dashed?: boolean })[]; node: { lane: number } & Parameters<typeof Symbol>[0] }) {
  return <div className="commit-graph" aria-hidden="true">
    <svg viewBox={`0 0 ${width} 64`} width="100%" height="64" preserveAspectRatio="none">{children}</svg>
    <svg className="commit-graph-tail" viewBox={`0 0 ${width} 1`} width="100%" preserveAspectRatio="none">
      {tail.map((t, i) => <line key={i} x1={x(t.lane)} x2={x(t.lane)} y1="0" y2="1" stroke={t.color} strokeWidth="1.7" strokeDasharray={t.dashed ? '4 4' : undefined} vectorEffect={t.dashed ? 'non-scaling-stroke' : undefined} />)}
    </svg>
    <svg className="commit-node" viewBox="0 0 24 24" width="24" height="24" style={{left: `${x(node.lane) / width * 100}%`}}><Symbol {...node}/></svg>
  </div>
}
function GraphRow({ row, width, reverted, workLinks, index }: { row: TimelineRow; width: number; reverted: boolean; workLinks: WorkLink[]; index: number }) {
  const { lane, passing, outgoing, incoming, commit } = row
  const activeWork = workLinks.filter(w => w.target >= index)
  const continuing = [...new Map([...passing, ...outgoing].map(t => [t.lane, t])).values()]
  return <GraphCell width={width} node={{lane, hollow: commit.parents >= 2, color: row.route.color, head: row.refs.some(b => b.isHead) || workLinks.some(w => w.target === index && w.wt.branch === null), kind: reverted ? 'reverted' : isRevert(commit) ? 'revert' : commit.parents >= 2 ? 'merge' : 'normal'}} tail={[...continuing, ...activeWork.filter(w => w.target > index).map(w => ({...w, dashed: true}))]}>
    {passing.map(t => <line key={`p${t.lane}`} x1={x(t.lane)} x2={x(t.lane)} y1="0" y2="64" stroke={t.color} strokeWidth="1.7" />)}
    {incoming.map(t => <path key={`i${t.lane}`} d={`M ${x(t.lane)} 0 C ${x(t.lane)} 14 ${x(lane)} 12 ${x(lane)} 28`} fill="none" stroke={t.color} strokeWidth="1.7" />)}
    {outgoing.map((t, i) => <path key={`o${i}`} d={`M ${x(lane)} 28 C ${x(lane)} 48 ${x(t.lane)} 44 ${x(t.lane)} 64`} fill="none" stroke={t.color} strokeWidth="1.7" />)}
    {row.missingParents > 0 && <line x1={x(lane)} x2={x(lane)} y1="36" y2="59" stroke={row.route.color} strokeWidth="1.5" strokeDasharray="2 3" />}
    {activeWork.map(w => <path key={w.wt.path} d={w.target === index ? `M ${x(w.lane)} 0 C ${x(w.lane)} 16 ${x(lane)} 12 ${x(lane)} 28` : `M ${x(w.lane)} 0 V 64`} fill="none" stroke={w.color} strokeWidth="1.5" strokeDasharray="4 4" />)}
  </GraphCell>
}

export function CommitTimeline({ detail, branches }: { detail: RepoDetail; branches: BranchInfo[] }) {
  const { rows, laneCount, routes } = useMemo(() => buildCommitTimeline(detail, branches), [detail, branches])
  const revertedHashes = rows.flatMap(({ commit }) => commit.revertsHash ? [commit.revertsHash] : [])
  const workLinks: WorkLink[] = detail.worktrees.filter(w => (w.dirty || w.branch === null) && (w.branch === null || branches.some(b => b.name === w.branch))).map((wt, i) => ({
    wt, lane: laneCount + i, color: wt.branch ? branchColor(wt.branch, detail.trunk?.name) : 'var(--text-secondary)', target: rows.findIndex(r => r.commit.hash === wt.head),
  }))
  const width = Math.max(64, (laneCount + workLinks.length) * 24 + 8)
  const dates = rows.map(r => Date.parse(r.commit.committedAt)).filter(Number.isFinite)
  const start = dates.length ? Math.min(...dates) : 0
  const end = dates.length ? Math.max(...dates) : 0
  const historical = routes.some(r => r.key.startsWith('history:'))
  // A branch sharing main's tip still needs its own color key, without a fake lane.
  const legendRoutes = [...routes, ...branches.filter(b => !routes.some(r => r.key === b.name)).map(b => ({
    key: b.name, name: b.name, color: branchColor(b.name, detail.trunk?.name), isTrunk: b.name === detail.trunk?.name,
  }))]

  return <section className="commit-section" aria-label="提交记录">
    <div className="timeline-legend" aria-label="图例">
      <div className="route-legend">
        <strong>分支颜色</strong>
        {legendRoutes.map(r => <span key={r.key} className="route-badge" style={{'--route-color':r.color} as CSSProperties}><i/>{r.name}{r.isTrunk ? ' · 主干（左侧）' : ''}</span>)}
      </div>
      <div className="symbol-legend">
        <LegendItem kind="normal">普通提交</LegendItem><LegendItem kind="merge">合并提交（≥2 个父）</LegendItem>
        <LegendItem kind="revert">revert / 撤销</LegendItem><LegendItem kind="reverted">被撤销</LegendItem>
        <LegendItem kind="normal" head>当前 HEAD</LegendItem><LegendItem kind="dirty">未提交改动</LegendItem><LegendItem kind="detached">游离 HEAD</LegendItem>
        <span><span className="tag commit-tag">tag</span>版本标签</span>
      </div>
      <p>分支标签标注当前指针，共享历史只画一次。tag 只在打过版本标签的提交旁显示。{historical ? '历史支线没有对应的现存分支名称。' : ''}</p>
    </div>
    <div className="section-heading timeline-range">
      <h2>提交记录 <span className="count">{rows.length} 条</span></h2>
      {dates.length > 0 && <span>当前显示 {dateLabel(new Date(start).toISOString())} — {dateLabel(new Date(end).toISOString())} · 跨度 {elapsedLabel(end - start)}</span>}
    </div>
    <div className="timeline-columns" style={{'--graph-width':`${width}px`} as CSSProperties}>
      <div className="timeline-column-head"><span>时间 ↓</span><span className="trunk-axis-label">{detail.trunk ? <>{detail.trunk.name}<small>主干 · 左侧</small></> : '分支关系'}</span><span>提交内容 · 点行展开说明</span></div>
      <ol className="commit-list">
        {workLinks.map((w, index) => {
          const prior = workLinks.slice(0, index).filter(p => p.target >= 0).map(p => ({...p,dashed:true}))
          const tail = w.target >= 0 ? [...prior,{...w,dashed:true}] : prior
          return <li key={w.wt.path} className="commit-row workspace-row">
            <div className="commit-time"><strong>当前状态</strong><small>{detail.scannedAt ? clockLabel(detail.scannedAt) : '本次扫描'}</small></div>
            <GraphCell width={width} tail={tail} node={{lane:w.lane, kind:w.wt.branch === null ? 'detached' : 'dirty', color:w.color}}>
              {prior.map(p => <line key={p.wt.path} x1={x(p.lane)} x2={x(p.lane)} y1="0" y2="64" stroke={p.color} strokeDasharray="4 4"/>)}
              {w.target >= 0 && <line x1={x(w.lane)} x2={x(w.lane)} y1="28" y2="64" stroke={w.color} strokeDasharray="4 4"/>}
            </GraphCell>
            <div className="workspace-summary"><strong>{w.wt.branch ?? '游离 HEAD'}{w.wt.dirty ? ` · ${w.wt.uncommittedCount} 个文件未提交` : ' · 工作区干净'}</strong>
              <p>{w.wt.name} · {w.wt.path}</p><span>关联 HEAD {w.target >= 0 ? <a href={`#commit-${w.wt.head}`}>{w.wt.head.slice(0,12)}</a> : <code>{w.wt.head.slice(0,12) || '尚无提交'}</code>}{w.target < 0 ? ' · 未包含在当前记录中' : ''} · 工作区状态，非提交事件</span>
            </div>
          </li>
        })}
        {rows.map((row, index) => {
          const c = row.commit
          const reverted = revertedHashes.some(hash => c.hash.startsWith(hash))
          const kind = isRevert(c) ? '撤销提交' : c.parents >= 2 ? '合并提交' : '普通提交'
          const previous = rows[index - 1]?.commit.committedAt
          const newDay = !previous || dateLabel(previous) !== dateLabel(c.committedAt)
          const gap = timeGap(previous,c.committedAt)
          const routeStyle = {'--route-color':row.route.color} as CSSProperties
          return <li key={c.hash} id={`commit-${c.hash}`} className={`commit-row ${newDay ? 'new-day' : ''}`}>
            <div className="commit-time"><time dateTime={c.committedAt} title={new Date(c.committedAt).toLocaleString('zh-CN')}><span className="time-date">{dateLabel(c.committedAt)}</span><strong>{clockLabel(c.committedAt)}</strong></time>{gap && <small className="time-gap">{gap}</small>}</div>
            <GraphRow row={row} width={width} reverted={reverted} workLinks={workLinks} index={index}/>
            <details className="commit-entry">
              <summary>
                <span className="commit-title">{c.subject || '（无提交信息）'}</span>
                <span className="commit-labels">
                  {!row.refs.some(b => b.name === row.route.key) && <span className="route-badge route-context" style={routeStyle}><i/>{row.route.name}{row.route.isTrunk ? ' · 主干' : ' · 路线'}</span>}
                  {row.refs.map(b => <span key={b.name} className="route-badge" style={{'--route-color':branchColor(b.name,detail.trunk?.name)} as CSSProperties}><i/>{b.name}{b.name === detail.trunk?.name ? ' · 主干' : ''}{b.isHead ? ' · HEAD' : ''}</span>)}
                  {c.tags.map(tag => <span className="tag commit-tag" key={tag}>tag · {tag}</span>)}
                  {kind !== '普通提交' && <span className={`tag ${isRevert(c) ? 'revert-tag' : ''}`}>{kind}</span>}
                  {reverted && <span className="tag reverted-tag">被撤销</span>}
                </span>
                <span className="commit-meta"><code>{c.shortHash}</code><span>{c.author || '作者未知'}</span><span>{c.relativeTime}</span><span className="commit-disclosure"><span className="when-closed">展开</span><span className="when-open">收起</span></span></span>
              </summary>
              <div className="commit-body"><p>{c.body || '这次提交没有补充说明。'}</p><dl className="ndgrid">
                <dt>完整 hash</dt><dd className="ndmono">{c.hash}</dd><dt>提交时间</dt><dd>{new Date(c.committedAt).toLocaleString('zh-CN')}</dd>
                <dt>类型</dt><dd>{kind}{reverted ? ' · 被撤销' : ''}</dd>
                {c.parentHashes && c.parentHashes.length > 0 && <><dt>父提交</dt><dd className="ndmono">{c.parentHashes.join('\n')}</dd></>}
                {c.revertsHash && <><dt>撤销了</dt><dd className="ndmono">{c.revertsHash}</dd></>}
              </dl></div>
            </details>
          </li>
        })}
      </ol>
    </div>
    {!rows.length && <div className="empty">当前范围内没有提交记录。</div>}
    <p className="timeline-note">时间按本机时区显示，间距经过压缩，不代表时长；间隔指相邻已显示记录的时间差。实线为父子关系，短虚线末端为未加载历史，长虚线关联工作区与 HEAD。分支路线按第一父链组织，不代表提交最初创建的分支；合入内容的推断不画成父子关系。此处为近期记录范围，更早的提交可按 hash 查询。</p>
  </section>
}
