import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { discoverRepos } from '../engine/discover.js'
import { scanAll, scanRepoDetail, lookupCommit, COMMIT_HASH_RE } from '../engine/scan.js'
import { gitAvailable } from '../engine/git.js'
import { getRoots, addRoot, removeRoot } from './config.js'
import type { RepoSummary } from '../shared/types.js'
import { localAccess } from './local-access.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = join(__dirname, '..', 'web', 'dist')

// 简单的内存缓存（design §5：按需 + 手动刷新）。
let cache: { at: string; repos: RepoSummary[] } | null = null

async function computeRepos(): Promise<{ at: string; repos: RepoSummary[] }> {
  const roots = await getRoots()
  const paths = await discoverRepos(roots)
  const repos = await scanAll(paths)
  return { at: new Date().toISOString(), repos }
}

async function getRepos(force: boolean) {
  if (!cache || force) cache = await computeRepos()
  return cache
}

export const app = new Hono()
app.use('*', localAccess(Number(process.env.PORT ?? 5179)))

app.get('/api/health', async (c) => c.json({ ok: true, git: await gitAvailable() }))

app.get('/api/repos', async (c) => {
  const force = c.req.query('refresh') === '1'
  const { at, repos } = await getRepos(force)
  return c.json({ scannedAt: at, repos })
})

app.post('/api/refresh', async (c) => {
  cache = await computeRepos()
  return c.json({ scannedAt: cache.at })
})

app.get('/api/roots', async (c) => c.json(await getRoots()))

app.post('/api/roots', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.path !== 'string' || !body.path.trim()) return c.json({ error: 'path required' }, 400)
  const path = body.path.trim()
  let roots: string[]
  try { roots = await addRoot(path) } catch { return c.json({ error: 'Directory does not exist or configuration could not be saved' }, 400) }
  cache = null // 配置变了，下次重扫
  return c.json(roots)
})

app.delete('/api/roots', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.path !== 'string' || !body.path.trim()) return c.json({ error: 'path required' }, 400)
  const path = body.path.trim()
  const roots = await removeRoot(path)
  cache = null
  return c.json(roots)
})

// 单 repo 分支地图（design §11.3 GET /api/repos/:id）。
app.get('/api/repos/:id', async (c) => {
  const id = c.req.param('id')
  const { repos } = await getRepos(false)
  const found = repos.find((r) => r.id === id)
  if (!found) return c.json({ error: 'not found' }, 404)
  return c.json(await scanRepoDetail(found.path))
})

// 按 hash 查任意 commit（design §7 / §11.3）。
app.get('/api/repos/:id/commits/:hash', async (c) => {
  const id = c.req.param('id')
  const hash = c.req.param('hash')
  if (!COMMIT_HASH_RE.test(hash)) return c.json({ error: 'invalid hash format' }, 400)
  const { repos } = await getRepos(false)
  const found = repos.find((r) => r.id === id)
  if (!found) return c.json({ error: 'repo not found' }, 404)
  const commit = await lookupCommit(found.path, hash)
  if (!commit) return c.json({ error: 'commit not found' }, 404)
  return c.json(commit)
})

// 生产环境提供构建好的前端（dev 时由 Vite 提供）。
if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: WEB_DIST }))
  app.get('/*', serveStatic({ path: join(WEB_DIST, 'index.html') }))
}

