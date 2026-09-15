import type { RepoSummary, StatusLevel } from '../../shared/types'

function Row({ repo, onSelect }: { repo: RepoSummary; onSelect: (id: string) => void }) {
  const errored = !!repo.readError
  const dotClass = errored ? 'error' : repo.status
  return (
    <button className="row" type="button" onClick={() => onSelect(repo.id)}>
      <span className={`dot ${dotClass}`} aria-hidden="true" />
      <span className="row-main">
        <span className="row-head">
          <span className="repo-name">{repo.name}</span>
          {repo.currentBranch && <span className="pill">{repo.currentBranch}</span>}
          {repo.highlightWorktree && <span className="tag">worktree</span>}
        </span>
        <span className={`headline${errored ? ' error' : ''}`}>{repo.readError ?? repo.headline}</span>
      </span>
      {repo.lastActivityRelative && <span className="when">{repo.lastActivityRelative}</span>}
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

const GROUPS: { key: StatusLevel; label: string }[] = [
  { key: 'attention', label: '需要留意' },
  { key: 'synced', label: '已同步' },
  { key: 'idle', label: '空闲' },
]

export function RepoList({ repos, onSelect }: { repos: RepoSummary[]; onSelect: (id: string) => void }) {
  const errored = repos.filter((r) => r.readError)
  const ok = repos.filter((r) => !r.readError)

  return (
    <div>
      {GROUPS.map(({ key, label }) => {
        const items = ok.filter((r) => r.status === key)
        if (!items.length) return null
        return (
          <div key={key}>
            <div className="group">
              {label} · {items.length}
            </div>
            {items.map((r) => (
              <Row key={r.id} repo={r} onSelect={onSelect} />
            ))}
          </div>
        )
      })}
      {errored.length > 0 && (
        <div>
          <div className="group">读取失败 · {errored.length}</div>
          {errored.map((r) => (
            <Row key={r.id} repo={r} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}
