import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BranchInfo, CommitLite, RepoDetail } from '../shared/types'
import { branchColor, buildCommitTimeline, timeGap, elapsedLabel } from '../web/src/timelineLayout'
import { scanRepoDetail } from '../engine/scan'

const commit = (hash: string, parentHashes: string[] = [], date = '2026-09-14T12:00:00Z'): CommitLite => ({
  hash, shortHash: hash, subject: hash, committedAt: date, relativeTime: '刚刚',
  parents: parentHashes.length, parentHashes, tags: [], body: '', revertsHash: null,
})
const branch = (name: string, commits: CommitLite[]): BranchInfo => ({
  name, commits, tip: commits[0], upstream: null, pushState: 'no-upstream', aheadOfTrunk: 0,
  behindOfTrunk: 0, mergedIntoTrunk: false, squashMergeLikely: false, mergedAt: null,
  forkPoint: null, worktree: null, isHead: true, isActive: true, tags: [], status: 'synced', statusLine: '',
})
const detail = (branches: BranchInfo[]): RepoDetail => ({
  id: 'test', name: 'test', path: '/test', status: 'synced', headline: '', hasRemote: false,
  branches, trunk: branches[0] ? { name: branches[0].name, tip: branches[0].tip, commits: branches[0].commits } : null,
  trunkInferred: branches.length ? 'explicit' : 'none', worktrees: [], scannedAt: '',
})

test('shared commits appear once, with every branch ref at the shared tip', () => {
  const root = commit('root')
  const tip = commit('tip', ['root'])
  const branches = [branch('main', [tip, root]), branch('feature', [tip])]
  const { rows, laneCount } = buildCommitTimeline(detail(branches), branches)
  assert.equal(laneCount, 1, 'shared refs must not create a fake branch lane')
  assert.deepEqual(rows.map((r) => r.commit.hash), ['tip', 'root'])
  assert.deepEqual(rows[0].refs.map((b) => b.name), ['main', 'feature'])
})

test('children stay above their parents despite equal or inverted timestamps', () => {
  const root = commit('root', [], '2026-09-15T00:00:00Z')
  const left = commit('left', ['root'])
  const right = commit('right', ['root'])
  const merge = commit('merge', ['left', 'right'], '2026-09-13T00:00:00Z')
  const branches = [branch('main', [merge, root, right, left])]
  const { rows, laneCount } = buildCommitTimeline(detail(branches), branches)
  assert.equal(rows[0].commit.hash, 'merge')
  assert.equal(rows.at(-1)?.commit.hash, 'root')
  assert.equal(rows[0].outgoing.length, 2)
  assert.equal(laneCount, 3)
  assert.equal(rows.at(-1)?.outgoing.length, 0)
  for (const row of rows) {
    for (const parent of row.commit.parentHashes!) {
      assert.ok(rows.indexOf(row) < rows.findIndex((r) => r.commit.hash === parent))
    }
  }
})

test('truncated history ends in a boundary, never a fabricated edge', () => {
  const branches = [branch('main', [commit('tip', ['not-loaded'])])]
  const { rows } = buildCommitTimeline(detail(branches), branches)
  assert.equal(rows[0].missingParents, 1)
  assert.deepEqual(rows[0].outgoing, [])
})

test('squash inference does not invent a parent relationship', () => {
  const branches = [branch('main', [commit('main')]), branch('feature', [commit('feature')])]
  branches[1].squashMergeLikely = true
  branches[1].mergedAt = 'main'
  const { rows } = buildCommitTimeline(detail(branches), branches)
  assert.ok(rows.every((r) => r.incoming.length === 0 && r.outgoing.length === 0))
})

test('empty repository and repository without an inferred trunk remain readable', () => {
  assert.deepEqual(buildCommitTimeline(detail([]), []).rows, [])
  const branches = [branch('topic', [commit('tip')])]
  const d = detail(branches)
  d.trunk = null
  const { rows } = buildCommitTimeline(d, branches)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].refs[0].name, 'topic')
})

test('old server data without parent hashes produces no guessed lines', () => {
  const c = commit('tip', ['root'])
  delete c.parentHashes
  const branches = [branch('main', [c, commit('root')])]
  const { rows } = buildCommitTimeline(detail(branches), branches)
  assert.ok(rows.every((r) => r.outgoing.length === 0))
})

test('real Git scan supplies the exact merge parents and deduplicates merged history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookgit-timeline-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'LookGit Test')
    git('config', 'user.email', 'lookgit-test@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'base.txt'), 'base')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'feature')
    writeFileSync(join(dir, 'feature.txt'), 'feature')
    git('add', '.')
    git('commit', '-m', 'feature')
    const feature = git('rev-parse', 'HEAD')
    git('checkout', 'main')
    writeFileSync(join(dir, 'main.txt'), 'main')
    git('add', '.')
    git('commit', '-m', 'main change')
    const main = git('rev-parse', 'HEAD')
    git('merge', '--no-ff', 'feature', '-m', 'merge feature')
    const d = await scanRepoDetail(dir)
    assert.deepEqual(d.trunk?.tip.parentHashes, [main, feature])
    const { rows } = buildCommitTimeline(d, d.branches)
    assert.equal(rows.length, 4)
    assert.equal(rows[0].commit.subject, 'merge feature')
    assert.equal(rows[0].outgoing.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('main stays on the left even when feature activity is newest', () => {
  const root = commit('root')
  const main = commit('main-tip', ['root'])
  const feature = commit('feature-tip', ['root'], '2026-09-15T12:00:00Z')
  const branches = [branch('main', [main, root]), branch('feature', [feature])]
  const {rows} = buildCommitTimeline(detail(branches), branches)
  assert.equal(rows[0].commit.hash, 'feature-tip')
  assert.equal(rows[0].route.key, 'feature')
  assert.ok(rows[0].lane > 0)
  for (const r of rows.filter(r => r.route.isTrunk)) assert.equal(r.lane, 0)
  assert.equal(rows.at(-1)?.incoming.length, 2)
})

test('branch identity colors survive filtering and reordering', () => {
  const root = commit('root')
  const branches = [branch('main',[root]),branch('zzz',[commit('z',['root'])]),branch('aaa',[commit('a',['root'])])]
  const d = detail(branches)
  const all = buildCommitTimeline(d, branches)
  const active = buildCommitTimeline(d, [branches[2], branches[0]])
  assert.equal(all.rows.find(r=>r.commit.hash==='a')?.route.color, active.rows.find(r=>r.commit.hash==='a')?.route.color)
  assert.equal(active.rows.find(r=>r.commit.hash==='a')?.route.color, branchColor('aaa'))
  assert.notEqual(branchColor('aaa'), branchColor('main','main'))
})

test('main first-parent chain does not absorb the second-parent history', () => {
  const root = commit('root'), left = commit('left',['root']), right = commit('right',['root'])
  const merge = commit('merge',['left','right'])
  const branches = [branch('main',[merge,left,right,root]),branch('feature',[right])]
  const {rows} = buildCommitTimeline(detail(branches), branches)
  assert.equal(rows.find(r=>r.commit.hash==='right')?.route.key,'feature')
  assert.equal(rows.find(r=>r.commit.hash==='left')?.lane,0)
  assert.equal(rows.find(r=>r.commit.hash==='root')?.lane,0)
})

test('time gaps describe displayed records and flag clock inversion', () => {
  assert.equal(timeGap(undefined,'2026-09-14T12:00:00Z'),null)
  assert.equal(timeGap('2026-09-14T12:00:00Z','2026-09-14T11:00:00Z'),null)
  assert.equal(timeGap('2026-09-14T12:00:00Z','2026-09-12T10:00:00Z'),'与上一条相隔 2 天 2 小时')
  assert.equal(timeGap('2026-09-14T12:00:00Z','2026-09-15T12:00:00Z'),'时间倒置 · 保留提交关系')
  assert.equal(elapsedLabel(0),'不足 1 分钟')
})
