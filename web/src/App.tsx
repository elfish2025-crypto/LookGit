import { useCallback, useEffect, useState } from 'react'
import type { RepoSummary } from '../../shared/types'
import { fetchRepos, refreshRepos } from './api'
import { RepoList } from './RepoList'
import { RepoDetailView } from './RepoDetailView'
import { RootsPanel } from './RootsPanel'

export function App() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null)
  const [scannedAt, setScannedAt] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showRoots, setShowRoots] = useState(false)

  const load = useCallback(async () => {
    try {
      const { repos, scannedAt } = await fetchRepos()
      setRepos(repos)
      setScannedAt(scannedAt)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setBusy(true)
    try {
      await refreshRepos()
      await load()
    } finally {
      setBusy(false)
    }
  }, [load])

  const attentionCount = repos?.filter((r) => r.status === 'attention' && !r.readError).length ?? 0
  const scannedRel = scannedAt ? new Date(scannedAt).toLocaleTimeString('zh-CN') : ''

  if (selectedId) {
    return (
      <div className="wrap-wide">
        <RepoDetailView id={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    )
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="title">
          <h1>本地仓库</h1>
          {repos && (
            <span className="count">
              {repos.length} 个{attentionCount > 0 ? ` · ${attentionCount} 个需要留意` : ''}
            </span>
          )}
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setShowRoots((s) => !s)}>
            {showRoots ? '完成' : '加文件夹'}
          </button>
          <button className="btn" type="button" onClick={onRefresh} disabled={busy}>
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>
      <div className="subbar">LookGit v1.0.1 · {scannedRel ? `${scannedRel} 扫描` : ''}</div>

      {showRoots && <RootsPanel onChange={load} />}

      {error && <div className="empty">出错了：{error}</div>}
      {!repos && !error && <div className="loading">扫描中…</div>}
      {repos && repos.length === 0 && !showRoots && (
        <div className="empty">还没有监视任何文件夹。点上面的「加文件夹」添加一个。</div>
      )}
      {repos && repos.length > 0 && <RepoList repos={repos} onSelect={setSelectedId} />}
    </div>
  )
}
