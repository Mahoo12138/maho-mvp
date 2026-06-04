import fs from 'node:fs'
import path from 'node:path'
import { createMahoContext, type MFContext, type ResolvedMFConfig } from '@maho/core'
import { MahoError } from '../utils/errors'

export interface AppInfo {
  /** 来自 config.yml 的 name 字段，缺省取目录名 */
  name: string
  /** 绝对路径 */
  dir: string
  /** 是否存在 vite.config.* */
  hasViteConfig: boolean
}

export interface WorkspaceContext {
  /** 工作区根（含 config/config.yml 的最高层目录） */
  root: string
  /** 命令执行目录 */
  cwd: string
  /** 当前 cwd 在工作区中的角色 */
  role: 'host' | 'remote' | 'unknown'
  /** role === 'remote' 时填，对应的 app 名 */
  currentAppName?: string
  /** apps/* 下所有合法子包 */
  apps: AppInfo[]
  /** workspace root 的解析后配置 */
  hostConfig: ResolvedMFConfig
  /** workspace root 上构建出来的 Maho/Cordis 容器，供 dev / devtools 等子命令复用 */
  mahoCtx: MFContext
}

/**
 * 探测 CLI 所在的工作区结构。失败抛 MahoError。
 *
 * 加载 hostConfig 仅做最基本的 `createMahoContext`（mode 默认 dev），
 * 不挂任何用户插件 —— 我们这里只想要解析后的 base+current 合并视图。
 */
export async function resolveWorkspaceContext(
  cwd: string = process.cwd(),
  mode: string = 'dev',
): Promise<WorkspaceContext> {
  const root = findWorkspaceRoot(cwd)
  const apps = scanApps(root)
  const ctx = await createMahoContext({ projectRoot: root, mode })
  const hostConfig = ctx.config.resolved
  const { role, currentAppName } = detectRole(cwd, root, apps)
  return { root, cwd, role, currentAppName, apps, hostConfig, mahoCtx: ctx }
}

/**
 * 向上查找含 `config/config.yml` 的最高层目录。
 *
 * 「最高层」语义而非「最近层」：当 cwd 在 `apps/module-x` 内时，
 * 子目录自己也有 config.yml，但那是 remote 配置，工作区根在更外层。
 */
export function findWorkspaceRoot(cwd: string): string {
  let topMatch: string | null = null
  let dir = path.resolve(cwd)
  while (true) {
    if (fs.existsSync(path.join(dir, 'config', 'config.yml'))) {
      topMatch = dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (!topMatch) {
    throw new MahoError(
      'workspace-not-found',
      'No Maho workspace found. Make sure a "config/config.yml" exists in this project or run "maho init" to scaffold one.',
    )
  }
  return topMatch
}

/**
 * 扫描 `<root>/apps/*`。每个子目录满足
 *   - 存在 `config/config.yml`
 *   - 存在 `package.json`
 * 才计入。name 优先取 config.yml 的 name 字段。
 *
 * 注意：本函数走极简同步 YAML 读取（只为拿 name 字段），不走完整 ConfigService
 * —— 避免对每个 app 都启一个 cordis Context 的开销。
 */
export function scanApps(root: string): AppInfo[] {
  const appsDir = path.join(root, 'apps')
  if (!fs.existsSync(appsDir)) return []

  const result: AppInfo[] = []
  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(appsDir, entry.name)
    const configPath = path.join(dir, 'config', 'config.yml')
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(configPath) || !fs.existsSync(pkgPath)) continue

    result.push({
      name: readAppName(configPath) ?? entry.name,
      dir,
      hasViteConfig: detectViteConfig(dir),
    })
  }
  return result
}

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
]

function detectViteConfig(dir: string): boolean {
  return VITE_CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)))
}

/**
 * 极简 name 抽取：从 yaml 里抓 `^name:` 行，不调用 yaml parser。
 * 仅用于探测，错误时返回 null 让上层 fallback 到目录名。
 */
function readAppName(configPath: string): string | null {
  try {
    const text = fs.readFileSync(configPath, 'utf-8')
    const match = text.match(/^name:\s*['"]?([^\s'"#]+)['"]?\s*(#.*)?$/m)
    return match?.[1] ?? null
  }
  catch {
    return null
  }
}

/**
 * 判定 cwd 在工作区中的角色。
 * - cwd === root → host
 * - cwd 落在某个 apps/<name>(/...) 内 → remote
 * - 其他位置（如 root 下其他目录）→ unknown
 */
export function detectRole(
  cwd: string,
  root: string,
  apps: AppInfo[],
): { role: 'host' | 'remote' | 'unknown'; currentAppName?: string } {
  const normCwd = path.resolve(cwd)
  if (normCwd === root) return { role: 'host' }
  for (const app of apps) {
    if (normCwd === app.dir || normCwd.startsWith(app.dir + path.sep)) {
      return { role: 'remote', currentAppName: app.name }
    }
  }
  return { role: 'unknown' }
}
