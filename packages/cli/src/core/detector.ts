import fs from 'node:fs'
import path from 'node:path'

export type PackageManager = 'pnpm' | 'yarn' | 'npm'

/**
 * 检测工作区使用的包管理器。
 *
 * 优先级：
 *   1. lockfile（最可靠）
 *   2. npm_config_user_agent 环境变量（npm/pnpm/yarn 执行时自动设置）
 *   3. 默认 npm
 */
export function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm'

  const agent = process.env.npm_config_user_agent ?? ''
  if (agent.startsWith('pnpm')) return 'pnpm'
  if (agent.startsWith('yarn')) return 'yarn'

  return 'npm'
}
