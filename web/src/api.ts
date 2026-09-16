import type { CommitDetail, RepoDetail, RepoSummary } from '../../shared/types'

export interface ReposResponse {
  scannedAt: string
  repos: RepoSummary[]
}

export async function fetchRepoDetail(id: string, signal?: AbortSignal): Promise<RepoDetail> {
  const res = await fetch(`/api/repos/${id}`, { signal })
  if (!res.ok) throw new Error(`GET /api/repos/${id} → ${res.status}`)
  return res.json()
}

export async function fetchRepos(refresh = false): Promise<ReposResponse> {
  const res = await fetch(`/api/repos${refresh ? '?refresh=1' : ''}`)
  if (!res.ok) throw new Error(`GET /api/repos → ${res.status}`)
  return res.json()
}

export async function refreshRepos(): Promise<void> {
  const res = await fetch('/api/refresh', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/refresh → ${res.status}`)
}

export async function fetchCommit(repoId: string, hash: string): Promise<CommitDetail> {
  const res = await fetch(`/api/repos/${repoId}/commits/${encodeURIComponent(hash.trim())}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `GET /api/repos/${repoId}/commits/${hash} → ${res.status}`)
  }
  return res.json()
}

export async function fetchRoots(): Promise<string[]> {
  const res = await fetch('/api/roots')
  if (!res.ok) throw new Error(`GET /api/roots → ${res.status}`)
  return res.json()
}

export async function addRoot(path: string): Promise<string[]> {
  const res = await fetch('/api/roots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error(`POST /api/roots → ${res.status}`)
  return res.json()
}

export async function removeRoot(path: string): Promise<string[]> {
  const res = await fetch('/api/roots', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error(`DELETE /api/roots → ${res.status}`)
  return res.json()
}
