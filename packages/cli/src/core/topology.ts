import { MahoError } from '../utils/errors'
import { logger } from '../utils/logger'
import type { AppInfo, WorkspaceContext } from './workspace'

export interface BuildPlan {
  remotes: AppInfo[]
  host: boolean
}

/**
 * 把 CLI filter 参数解析成具体「构建哪些 remote + 是否构建 host」。
 *
 * filter:
 *   - null   → 默认行为，按 cwd 角色构建当前包
 *   - 'all'  → 全部 remote + host（拓扑全量）
 *   - string[] → 指定 remote 名列表（仅 remote，不含 host）
 */
export function buildBuildPlan(
  ctx: WorkspaceContext,
  filter: 'all' | string[] | null,
): BuildPlan {
  if (filter === null) {
    if (ctx.role === 'host') return { remotes: [], host: true }
    if (ctx.role === 'remote' && ctx.currentAppName) {
      const app = ctx.apps.find((a) => a.name === ctx.currentAppName)
      if (!app) {
        throw new MahoError(
          'app-not-found',
          `Current app "${ctx.currentAppName}" not in workspace scan result.`,
        )
      }
      return { remotes: [app], host: false }
    }
    throw new MahoError(
      'wrong-directory',
      'Run "maho build" from the workspace root, a remote app dir, or pass --all/--filter.',
    )
  }

  if (filter === 'all') return { remotes: [...ctx.apps], host: true }

  const wanted = ctx.apps.filter((a) => filter.includes(a.name))
  const missing = filter.filter((n) => !ctx.apps.some((a) => a.name === n))
  if (missing.length) {
    logger.warn(`Apps not found in workspace: ${missing.join(', ')}`)
  }
  return { remotes: wanted, host: false }
}

/**
 * dev 命令的 target 解析：返回要起的 app 列表（不含 host —— host 单独处理）。
 */
export function resolveDevApps(
  ctx: WorkspaceContext,
  opts: { filter?: string; hostOnly?: boolean },
): AppInfo[] {
  if (opts.hostOnly) return []

  if (opts.filter === 'all' || !opts.filter) {
    // 默认 = all（设计文档预留 devDefault 字段过滤，本步不实现）
    return [...ctx.apps]
  }

  const names = opts.filter.split(',').map((s) => s.trim()).filter(Boolean)
  const found = ctx.apps.filter((a) => names.includes(a.name))
  const missing = names.filter((n) => !ctx.apps.some((a) => a.name === n))
  if (missing.length) {
    logger.warn(`Apps not found in workspace: ${missing.join(', ')}`)
  }
  return found
}
