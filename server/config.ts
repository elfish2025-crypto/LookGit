import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// v1：监视的文件夹存为 JSON（design §11.2 的 watched_roots 等迁到 SQLite 时替换此处）。
const DATA_DIR = process.env.LOOKGIT_DATA_DIR ? resolve(process.env.LOOKGIT_DATA_DIR) : join(homedir(), '.lookgit')
const CONFIG_PATH = join(DATA_DIR, 'config.json')

interface Config {
  roots: string[]
}

async function load(): Promise<Config> {
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Config
    if (!Array.isArray(cfg.roots) || !cfg.roots.every(root => typeof root === 'string')) throw new Error('Invalid LookGit configuration')
    return cfg
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // New installations start empty; only explicitly added folders are scanned.
    return { roots: [] }
  }
}

async function save(cfg: Config): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

export async function getRoots(): Promise<string[]> {
  return (await load()).roots
}

export async function addRoot(path: string): Promise<string[]> {
  const abs = resolve(path)
  if (!(await stat(abs)).isDirectory()) throw new Error('Not a directory')
  const cfg = await load()
  if (!cfg.roots.includes(abs)) {
    cfg.roots.push(abs)
    await save(cfg)
  }
  return cfg.roots
}

export async function removeRoot(path: string): Promise<string[]> {
  const abs = resolve(path)
  const cfg = await load()
  cfg.roots = cfg.roots.filter((r) => r !== abs)
  await save(cfg)
  return cfg.roots
}
