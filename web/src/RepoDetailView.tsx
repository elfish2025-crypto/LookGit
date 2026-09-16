import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchInfo, RepoDetail } from '../../shared/types'
import { fetchRepoDetail } from './api'
import { BranchMap } from './BranchMap'
import { CommitLookup } from './CommitLookup'
import { CommitTimeline } from './CommitTimeline'
import { BranchStatusList } from './BranchStatusList'

const BAR_COLOR = {
  attention: 'var(--attention)',
  synced: 'var(--synced)',
  idle: 'var(--idle)',
} as const

const PUSH_LABEL = {
  pushed: '已推送',
  unpushed: '未推送',
  'no-upstream': '无远程跟踪',
} as const

/** 哪个分支的 commits 里含有这个 hash（trunk 自身也是 detail.branches 里的一条，天然覆盖）。 */
function findOwningBranch(detail: RepoDetail, hash: string): BranchInfo | undefined {
  return detail.branches.find((b) => b.commits.some((c) => c.hash === hash))
}

/**
 * 分支信息：固定区域，不隐藏。没有选中分支/commit/worktree 时只显示标题占位；
 * 选中 commit 时反查它属于哪条分支，显示那条分支的信息（而不是留空）。
 */
function BranchInfoCard({ detail, selectedKey }: { detail: RepoDetail; selectedKey: string | null }) {
  const branch: BranchInfo | undefined = selectedKey?.startsWith('branch:')
    ? detail.branches.find((b) => b.name === selectedKey.slice('branch:'.length))
    : selectedKey?.startsWith('commit:')
      ? findOwningBranch(detail, selectedKey.slice('commit:'.length))
      : undefined
  const wt = selectedKey?.startsWith('wt:') ? detail.worktrees.find((w) => `wt:${w.path}` === selectedKey) : undefined

  return (
    <div className="ndetail">
      <div className="info-title">分支信息</div>
      {branch ? (
        <>
          <div className="ndname">{branch.name}</div>
          <div className="ndsubject">{branch.tip.subject || '（无提交信息）'}</div>
          <dl className="ndgrid">
            <dt>状态</dt>
            <dd>{branch.statusLine}</dd>
            <dt>提交</dt>
            <dd>
              {branch.tip.shortHash} · {branch.tip.author ?? '—'} · {branch.tip.relativeTime}
            </dd>
            <dt>相对主干</dt>
            <dd>
              领先 {branch.aheadOfTrunk} · 落后 {branch.behindOfTrunk} ·{' '}
              {branch.mergedIntoTrunk
                ? '已合入'
                : branch.squashMergeLikely
                  ? '可能已合并（基于内容比对，非完全确定）'
                  : '未合入'}
            </dd>
            <dt>推送</dt>
            <dd>
              {PUSH_LABEL[branch.pushState]}
              {branch.upstream ? ` (${branch.upstream})` : ''}
            </dd>
            {branch.worktree && (
              <>
                <dt>worktree</dt>
                <dd>{branch.worktree}</dd>
              </>
            )}
            {branch.tags.length > 0 && (
              <>
                <dt>tag</dt>
                <dd>{branch.tags.join(', ')}</dd>
              </>
            )}
            {branch.forkPoint && (
              <>
                <dt>分叉点</dt>
                <dd className="ndmono">{branch.forkPoint.slice(0, 10)}</dd>
              </>
            )}
          </dl>
        </>
      ) : wt ? (
        <>
          <div className="ndname">{wt.name}</div>
          <div className="ndsubject">处于游离 HEAD —— 不在任何分支上。</div>
          <dl className="ndgrid">
            <dt>HEAD</dt>
            <dd className="ndmono">{wt.head.slice(0, 10)}</dd>
            <dt>工作区</dt>
            <dd>{wt.dirty ? `有 ${wt.uncommittedCount} 处未提交改动` : '干净'}</dd>
            <dt>路径</dt>
            <dd className="ndmono">{wt.path}</dd>
          </dl>
        </>
      ) : (
        <div className="info-placeholder">未选择分支</div>
      )}
    </div>
  )
}

/** 节点信息：固定区域，不隐藏。只在选中具体 commit 节点时显示详情，否则只显示标题占位。 */
function NodeInfoCard({ detail, selectedKey }: { detail: RepoDetail; selectedKey: string | null }) {
  const commit = useMemo(() => {
    if (!selectedKey?.startsWith('commit:')) return undefined
    const hash = selectedKey.slice('commit:'.length)
    for (const b of detail.branches) {
      const found = b.commits.find((c) => c.hash === hash)
      if (found) return found
    }
    return undefined
  }, [detail, selectedKey])

  const revertedSet = useMemo(
    () => new Set(detail.branches.flatMap((b) => b.commits).map((c) => c.revertsHash).filter(Boolean) as string[]),
    [detail],
  )
  const isRevert = !!commit && (!!commit.revertsHash || /^Revert\b/.test(commit.subject))
  const isBad = !!commit && [...revertedSet].some((r) => commit.hash.startsWith(r))
  const commitType = commit
    ? commit.parents >= 2
      ? `合并提交（${commit.parents} 个父）`
      : isRevert
        ? 'revert 提交（撤销）'
        : isBad
          ? '被撤销的提交（被 revert）'
          : '普通提交'
    : ''

  return (
    <div className="ndetail">
      <div className="info-title">节点信息</div>
      {commit ? (
        <>
          <div className="ndname">{commit.subject || '（无提交信息）'}</div>
          {commit.body && <div className="ndsubject">{commit.body}</div>}
          <dl className="ndgrid">
            <dt>提交</dt>
            <dd className="ndmono">{commit.hash.slice(0, 12)}</dd>
            <dt>作者</dt>
            <dd>{commit.author ?? '—'}</dd>
            <dt>时间</dt>
            <dd>{commit.relativeTime}</dd>
            <dt>类型</dt>
            <dd>{commitType}</dd>
            {commit.revertsHash && (
              <>
                <dt>撤销了</dt>
                <dd className="ndmono">{commit.revertsHash.slice(0, 12)}</dd>
              </>
            )}
            {commit.tags.length > 0 && (
              <>
                <dt>tag</dt>
                <dd>{commit.tags.join(', ')}</dd>
              </>
            )}
          </dl>
        </>
      ) : (
        <div className="info-placeholder">未选择节点</div>
      )}
    </div>
  )
}

export function RepoDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RepoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'active' | 'all'>('active')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [layout, setLayout] = useState<'vertical' | 'horizontal'>('vertical')

  const [refreshing, setRefreshing] = useState(true)
  const request = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setRefreshing(true)
    setError(null)
    try {
      const next = await fetchRepoDetail(id, controller.signal)
      if (!controller.signal.aborted) setDetail(next)
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    setDetail(null)
    setSelectedKey(null)
    void reload()
    return () => request.current?.abort()
  }, [reload])

  const shown = useMemo(() => {
    if (!detail) return []
    return mode === 'all' ? detail.branches : detail.branches.filter((b) => b.isActive)
  }, [detail, mode])

  if (!detail) return (
    <div className="repo-detail">
      <button className="back" type="button" onClick={onBack}>‹ 全部仓库</button>
      {error ? <div className="detail-refresh-error" role="alert">读取失败：{error}</div> : <div className="loading" role="status">读取中…</div>}
      {error && <button className="btn" type="button" onClick={() => void reload()} disabled={refreshing}>重试</button>}
    </div>
  )

  const activeCount = detail.branches.filter((b) => b.isActive).length

  return (
    <div className={`repo-detail repo-detail-${layout}`}>
      <button className="back" type="button" onClick={onBack}>
        ‹ 全部仓库
      </button>

      <div className="topbar">
        <div className="title">
          <h1>{detail.name}</h1>
          <span className="path">{detail.path}</span>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void reload()} disabled={refreshing} title="重新扫描当前仓库的本地 Git 状态">
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>
      <div className="subbar detail-refresh-status" role="status" aria-live="polite">
        {refreshing ? '正在重新扫描当前仓库…' : '上次更新：'}
        {!refreshing && <time dateTime={detail.scannedAt}>{new Date(detail.scannedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>}
      </div>
      {error && <div className="detail-refresh-error" role="alert">刷新失败：{error}。已保留上次数据，请重试。</div>}

      <div className="bar" style={{ borderLeftColor: BAR_COLOR[detail.status] }}>
        {detail.headline}
      </div>

      {detail.trunkInferred === 'none' && <div className="subbar">无法确定主干，已列出各分支。</div>}

      <CommitLookup repoId={detail.id} />

      <div className="modebar">
        <div className="view-controls">
          <div className="toggle" role="group" aria-label="视图方向">
            <button type="button" aria-pressed={layout === 'vertical'} className={layout === 'vertical' ? 'on' : ''} onClick={() => setLayout('vertical')}>竖向列表</button>
            <button type="button" aria-pressed={layout === 'horizontal'} className={layout === 'horizontal' ? 'on' : ''} onClick={() => setLayout('horizontal')}>横向地图</button>
          </div>
          <div className="toggle" role="group" aria-label="分支范围">
            <button type="button" aria-pressed={mode === 'active'} className={mode === 'active' ? 'on' : ''} onClick={() => { setMode('active'); setSelectedKey(null) }}>
              活跃
            </button>
            <button type="button" aria-pressed={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => { setMode('all'); setSelectedKey(null) }}>
              全部
            </button>
          </div>
        </div>
        <span className="count">
          共 {detail.branches.length} 个 · 显示 {mode === 'active' ? `${activeCount} 个活跃` : '全部'}
        </span>
      </div>

      {layout === 'vertical' ? (
        <>
          <BranchStatusList detail={detail} branches={shown} />
          <CommitTimeline key={`${id}:${mode}`} detail={detail} branches={shown} />
        </>
      ) : (
        <>
          <BranchMap detail={detail} branches={shown} selectedKey={selectedKey} onSelect={setSelectedKey} />

          <div className="legend">
            <span>颜色 = 区分不同分支</span>
            <span>
              <span className="ldot" style={{ background: 'var(--text-secondary)' }} /> 普通提交
            </span>
            <span>
              <span className="lhollow" /> 合并提交（2 个以上父提交）
            </span>
            <span>
              <span className="ldot" style={{ background: '#BA7517' }} /> revert
            </span>
            <span>
              <span className="ldot" style={{ background: '#E24B4A' }} /> 被撤销
            </span>
            <span>
              <span className="lring" style={{ borderColor: 'var(--text-secondary)' }} /> 当前 HEAD
            </span>
            <span>
              <span className="lghost" style={{ borderColor: 'var(--text-secondary)' }} /> 未提交 / 游离
            </span>
          </div>
          <div className="subbar">节点上方的文字 = tag（版本标签），只有打过 tag 的提交才会显示，和上面几类节点形状无关</div>
          <div className="subbar">滚轮缩放时间轴 · 拖动平移 · 点线条或节点看详情</div>

          <BranchInfoCard detail={detail} selectedKey={selectedKey} />
          <NodeInfoCard detail={detail} selectedKey={selectedKey} />
        </>
      )}
    </div>
  )
}
