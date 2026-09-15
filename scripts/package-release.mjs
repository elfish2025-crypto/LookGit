import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable semver version')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
if (git('status', '--porcelain', '--untracked-files=no').trim()) throw new Error('Commit tracked changes before packaging')
if (!existsSync(join(root, 'web/dist/index.html'))) throw new Error('Build the frontend first')
const name = `LookGit-v${version}`
const out = join(root, 'release')
const temp = mkdtempSync(join(tmpdir(), 'lookgit-release-'))
try {
  const folder = join(temp, name)
  mkdirSync(folder)
  for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
    mkdirSync(dirname(join(folder, file)), { recursive: true })
    cpSync(join(root, file), join(folder, file))
  }
  cpSync(join(root, 'web/dist'), join(folder, 'web/dist'), { recursive: true })
  writeFileSync(join(folder, 'RELEASE.json'), JSON.stringify({ version, commit: git('rev-parse', 'HEAD').trim() }, null, 2) + '\n')
  mkdirSync(out, { recursive: true })
  const archive = join(out, `${name}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', temp, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex')
  writeFileSync(join(out, 'SHA256SUMS.txt'), `${hash}  ${name}.tar.gz\n`)
  console.log(archive)
  console.log(hash)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
