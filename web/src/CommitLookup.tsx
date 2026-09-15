import { useState } from 'react'
import type { CommitDetail } from '../../shared/types'
import { fetchCommit } from './api'

export function CommitLookup({ repoId }: { repoId: string }) {
  const [open, setOpen] = useState(false)
  const [hash, setHash] = useState('')
  const [result, setResult] = useState<CommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const h = hash.trim()
    if (!h) return
    setBusy(true)
    setError(null)
    try {
      setResult(await fetchCommit(repoId, h))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hashlookup">
      <button type="button" className="hashlookup-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '收起' : '按 hash 查 commit'}
      </button>
      {open && (
        <div className="hashlookup-body">
          <form className="hashlookup-form" onSubmit={submit}>
            <input
              type="text"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              placeholder="完整或缩写 hash"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !hash.trim()}>
              查找
            </button>
          </form>

          {error && <div className="roots-error">{error}</div>}

          {result && (
            <div className="ndetail" style={{ marginTop: '0.6rem' }}>
              <div className="ndname">{result.subject || '（无提交信息）'}</div>
              {result.body && <div className="ndsubject">{result.body}</div>}
              <dl className="ndgrid">
                <dt>提交</dt>
                <dd className="ndmono">{result.hash.slice(0, 12)}</dd>
                <dt>作者</dt>
                <dd>{result.author ?? '—'}</dd>
                <dt>时间</dt>
                <dd>{result.relativeTime}</dd>
                <dt>父提交</dt>
                <dd className="ndmono">
                  {result.parentHashes.length ? result.parentHashes.map((h) => h.slice(0, 10)).join(', ') : '（无，初始提交）'}
                </dd>
                <dt>所在分支</dt>
                <dd>{result.containingBranches.length ? result.containingBranches.join(', ') : '不在任何本地分支上'}</dd>
                {result.tags.length > 0 && (
                  <>
                    <dt>tag</dt>
                    <dd>{result.tags.join(', ')}</dd>
                  </>
                )}
                {result.revertsHash && (
                  <>
                    <dt>撤销了</dt>
                    <dd className="ndmono">{result.revertsHash.slice(0, 12)}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
