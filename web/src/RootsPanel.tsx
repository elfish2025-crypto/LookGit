import { useEffect, useState } from 'react'
import { addRoot, fetchRoots, removeRoot } from './api'

export function RootsPanel({ onChange }: { onChange: () => void }) {
  const [roots, setRoots] = useState<string[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRoots()
      .then(setRoots)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const path = input.trim()
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      setRoots(await addRoot(path))
      setInput('')
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (path: string) => {
    setBusy(true)
    setError(null)
    try {
      setRoots(await removeRoot(path))
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="roots-panel">
      {roots && roots.length > 0 && (
        <ul className="roots-list">
          {roots.map((r) => (
            <li key={r}>
              <span className="roots-path">{r}</span>
              <button type="button" className="roots-remove" onClick={() => remove(r)} disabled={busy} aria-label={`移除 ${r}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {roots && roots.length === 0 && <div className="roots-empty">还没有监视任何文件夹。</div>}

      <form className="roots-add" onSubmit={submit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="/Users/you/projects"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          添加
        </button>
      </form>
      {error && <div className="roots-error">出错了：{error}</div>}
    </div>
  )
}
