import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = await mkdtemp(join(tmpdir(), 'lookgit-server-test-'))
process.env.LOOKGIT_DATA_DIR = join(sandbox, 'config')
process.env.PORT = '5179'
const { app } = await import('../server/app.js')
const { getRoots } = await import('../server/config.js')
const request = (path: string, init: RequestInit = {}) => app.request(`http://localhost:5179${path}`, init)
after(() => rm(sandbox, { recursive: true, force: true }))

test('first run watches nothing and health confirms Git availability', async () => {
  assert.deepEqual(await (await request('/api/roots')).json(), [])
  assert.deepEqual(await (await request('/api/health')).json(), { ok: true, git: true })
})

test('reject remote hosts, foreign origins, opaque origins and cross-site browser requests', async () => {
  const cases = [
    { host: 'attacker.example:5179' },
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'http://localhost:9999' },
  ]
  for (const headers of cases) {
    assert.equal((await request('/api/roots', { headers: headers as Record<string, string> })).status, 403)
  }
})

test('allow same-app and Vite dev origins, with uncached API responses', async () => {
  for (const origin of ['http://localhost:5179', 'http://127.0.0.1:5179', 'http://localhost:5178']) {
    const response = await request('/api/roots', { headers: { origin } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  }
})

test('reject malformed folder inputs without changing configuration', async () => {
  for (const body of ['{', '{}', '{"path":3}', '{"path":" "}', JSON.stringify({ path: join(sandbox, 'missing') })]) {
    assert.equal((await request('/api/roots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400)
  }
  assert.deepEqual(await getRoots(), [])
})

test('adding and removing a watched folder only changes isolated config', async () => {
  const path = join(sandbox, 'project')
  await mkdir(path)
  await writeFile(join(path, 'sentinel.txt'), 'unchanged')
  for (const method of ['POST', 'POST', 'DELETE']) {
    const response = await request('/api/roots', { method, headers: { origin: 'http://localhost:5179', 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), method === 'DELETE' ? [] : [path])
  }
  assert.equal(await readFile(join(path, 'sentinel.txt'), 'utf8'), 'unchanged')
})

test('reject option-like commit input before invoking Git', async () => {
  assert.equal((await request('/api/repos/unknown/commits/--help')).status, 400)
})

test('do not silently overwrite damaged configuration', async () => {
  const path = join(process.env.LOOKGIT_DATA_DIR!, 'config.json')
  await writeFile(path, '{broken')
  await assert.rejects(getRoots())
  assert.equal(await readFile(path, 'utf8'), '{broken')
})
