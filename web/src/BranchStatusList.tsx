import type { BranchInfo, RepoDetail } from '../../shared/types'
import type { CSSProperties } from 'react'
import { branchColor } from './timelineLayout'

const PUSH_LABEL = { pushed: '已推送', unpushed: '未推送', 'no-upstream': '无远程跟踪' }

export function BranchStatusList({ detail, branches }: { detail: RepoDetail; branches: BranchInfo[] }) {
  return (
    <section className="branch-section" aria-label="分支状态">
      <div className="section-heading"><h2>分支状态</h2><span className="count">{detail.worktrees.length} 个工作区</span></div>
      <div className="branch-status-list">
        {branches.map((b) => {
          const worktrees = detail.worktrees.filter((wt) => wt.branch === b.name)
          const dirty = worktrees.reduce((sum, wt) => sum + wt.uncommittedCount, 0)
          const isTrunk = b.name === detail.trunk?.name
          return (
            <details className="branch-status" key={b.name}>
              <summary>
                <span className="branch-name-row">
                  <strong className="route-badge" style={{ '--route-color': branchColor(b.name, detail.trunk?.name) } as CSSProperties}><i/>{b.name}</strong>
                  {isTrunk && <span className="tag">主干</span>}
                  {b.isHead && <span className="tag current-ref">{worktrees.some((wt) => wt.isPrimary) ? '当前分支' : '工作区在用'}</span>}
                  <span className="branch-expand"><span className="when-closed">详情</span><span className="when-open">收起</span></span>
                </span>
                <span className="branch-state-row">
                  <span>{b.statusLine}</span>
                  <span className={b.pushState === 'unpushed' ? 'needs-attention' : ''}>{PUSH_LABEL[b.pushState]}</span>
                  {dirty > 0 && <span className="needs-attention">{dirty} 个文件未提交</span>}
                </span>
              </summary>
              <dl className="ndgrid branch-facts">
                <dt>最近提交</dt><dd>{b.tip.subject} · <code>{b.tip.shortHash}</code></dd>
                {b.upstream && <><dt>远程跟踪</dt><dd>{b.upstream}</dd></>}
                {!isTrunk && detail.trunk && <><dt>相对主干</dt><dd>领先 {b.aheadOfTrunk} · 落后 {b.behindOfTrunk} · {b.mergedIntoTrunk ? '已合入' : b.squashMergeLikely ? '可能已合入（内容比对推断）' : '未合入'}</dd></>}
                {b.forkPoint && <><dt>分叉点</dt><dd className="ndmono">{b.forkPoint}</dd></>}
                {worktrees.map((wt) => <div className="branch-worktree" key={wt.path}><dt>{wt.isPrimary ? '主工作区' : wt.name}</dt><dd className="ndmono">{wt.path} · {wt.dirty ? `${wt.uncommittedCount} 个文件未提交` : '干净'}</dd></div>)}
              </dl>
            </details>
          )
        })}
        {detail.worktrees.filter((wt) => wt.branch === null).map((wt) => (
          <div className="detached-worktree" key={wt.path}>
            <div className="branch-name-row"><strong>{wt.name}</strong><span className="tag">游离 HEAD</span></div>
            <div className="branch-state-row"><code>{wt.head.slice(0, 12) || '尚无提交'}</code><span>{wt.dirty ? `${wt.uncommittedCount} 个文件未提交` : '工作区干净'}</span></div>
            <div className="path">{wt.path}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
