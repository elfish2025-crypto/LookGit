import type { BranchInfo, CommitLite, RepoDetail } from '../../shared/types'

export const TRUNK_COLOR = 'var(--trunk-color)'
// Hue families exclude amber/red, reserved for revert and reverted commits.
const HUES = [158, 182, 205, 232, 258, 285]
export function branchColor(name: string, trunkName?: string | null) {
  if (name === trunkName) return TRUNK_COLOR
  let hash = 2166136261
  for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return `hsl(${HUES[hash % HUES.length]} ${52 + (hash >>> 8) % 16}% ${47 + (hash >>> 16) % 8}%)`
}
export interface Route { key: string; name: string; color: string; isTrunk: boolean; lane: number }
export interface Track { lane: number; color: string }
export interface TimelineRow {
  commit: CommitLite
  refs: BranchInfo[]
  route: Route
  lane: number
  incoming: Track[]
  passing: Track[]
  outgoing: Track[]
  missingParents: number
}

function orderCommits(commits: Map<string, CommitLite>) {
  const children = new Map([...commits.keys()].map((hash) => [hash, 0]))
  for (const c of commits.values()) for (const p of new Set(c.parentHashes ?? [])) {
    if (commits.has(p)) children.set(p, children.get(p)! + 1)
  }
  const ready = [...commits.values()].filter(c => children.get(c.hash) === 0)
  const ordered: CommitLite[] = []
  while (ready.length) {
    ready.sort((a, b) => b.committedAt.localeCompare(a.committedAt) || a.hash.localeCompare(b.hash))
    const c = ready.shift()!
    ordered.push(c)
    for (const p of new Set(c.parentHashes ?? [])) {
      if (!commits.has(p)) continue
      const n = children.get(p)! - 1
      children.set(p, n)
      if (n === 0) ready.push(commits.get(p)!)
    }
  }
  return ordered
}

/** Layout follows first-parent routes, not a claim about a commit's original branch.
 * Main's first-parent chain owns the left rail; other named routes are stable across filters.
 * Side parents with no surviving branch ref get explicitly anonymous historical routes.
 */
export function buildCommitTimeline(detail: RepoDetail, branches: BranchInfo[]) {
  const all = new Map<string, CommitLite>()
  for (const c of detail.trunk?.commits ?? []) all.set(c.hash, c)
  for (const b of detail.branches) {
    for (const c of b.commits) all.set(c.hash, c)
    if (!all.has(b.tip.hash)) all.set(b.tip.hash, b.tip)
  }
  const owners = new Map<string, string>()
  const routes = new Map<string, Omit<Route, 'lane'>>()
  const claim = (hash: string, key: string, name: string, isTrunk = false) => {
    routes.set(key, { key, name, isTrunk, color: isTrunk ? TRUNK_COLOR : branchColor(key) })
    while (all.has(hash) && !owners.has(hash)) {
      owners.set(hash, key)
      hash = all.get(hash)!.parentHashes?.[0] ?? ''
    }
  }
  if (detail.trunk) claim(detail.trunk.tip.hash, detail.trunk.name, detail.trunk.name, true)
  for (const b of [...detail.branches].sort((a, b) => a.name.localeCompare(b.name))) {
    if (b.name !== detail.trunk?.name) claim(b.tip.hash, b.name, b.name)
  }
  for (const c of orderCommits(all)) if (!owners.has(c.hash)) {
    claim(c.hash, `history:${c.hash}`, `历史支线 ${c.shortHash}`)
  }

  const shown = new Set(detail.trunk?.commits.map(c => c.hash) ?? [])
  for (const b of branches) {
    shown.add(b.tip.hash)
    for (const c of b.commits) shown.add(c.hash)
  }
  const ordered = orderCommits(new Map([...all].filter(([hash]) => shown.has(hash))))
  const used = new Set(ordered.map(c => owners.get(c.hash)!))
  if (detail.trunk) used.add(detail.trunk.name)
  const visibleRoutes: Route[] = [...routes.values()].filter(r => used.has(r.key))
    .sort((a, b) => Number(b.isTrunk) - Number(a.isTrunk) || a.key.localeCompare(b.key))
    .map((r, lane) => ({ ...r, lane }))
  const routeMap = new Map(visibleRoutes.map(r => [r.key, r]))
  // Named rails are reserved for their own first-parent chain. Merge inputs wait on
  // auxiliary rails, then join the owning rail at the real parent node.
  const reserved = visibleRoutes.length
  const tracks: ({ hash: string; color: string } | null)[] = Array(reserved).fill(null)
  let laneCount = Math.max(1, reserved)
  const rows: TimelineRow[] = ordered.map(commit => {
    const route = routeMap.get(owners.get(commit.hash)!)!
    const lane = route.lane
    const incoming: Track[] = []
    const passing: Track[] = []
    tracks.forEach((track, i) => {
      if (!track) return
      if (track.hash === commit.hash) { incoming.push({ lane: i, color: track.color }); tracks[i] = null }
      else passing.push({ lane: i, color: track.color })
    })
    const parents = [...new Set(commit.parentHashes ?? [])].filter(hash => shown.has(hash))
    const outgoing = parents.map((hash) => {
      let target: number
      if (hash === commit.parentHashes?.[0] && !tracks[lane]) target = lane
      else {
        const existing = tracks.findIndex(t => t?.hash === hash)
        if (existing >= 0) target = existing
        else {
          const free = tracks.findIndex((t, j) => j >= reserved && t === null)
          target = free >= 0 ? free : tracks.length
        }
      }
      const edgeColor = hash === commit.parentHashes?.[0] ? route.color : routeMap.get(owners.get(hash)!)!.color
      if (!tracks[target]) tracks[target] = { hash, color: edgeColor }
      return { lane: target, color: tracks[target]!.color }
    })
    laneCount = Math.max(laneCount, tracks.length)
    while (tracks.length > reserved && tracks.at(-1) === null) tracks.pop()
    return { commit, route, lane, incoming, passing, outgoing,
      refs: branches.filter(b => b.tip.hash === commit.hash),
      missingParents: Math.max(0, commit.parents - parents.length) }
  })
  return { rows, laneCount, routes: visibleRoutes }
}

export function elapsedLabel(ms: number) {
  const minutes = Math.floor(Math.abs(ms) / 60000)
  if (!minutes) return '不足 1 分钟'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  return days ? `${days} 天${hours ? ` ${hours} 小时` : ''}` : hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`
}
export function timeGap(previous: string | undefined, current: string) {
  if (!previous) return null
  const ms = Date.parse(previous) - Date.parse(current)
  if (!Number.isFinite(ms)) return null
  if (ms < 0) return '时间倒置 · 保留提交关系'
  return ms >= 86400000 ? `与上一条相隔 ${elapsedLabel(ms)}` : null
}
