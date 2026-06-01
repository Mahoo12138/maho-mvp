import type {
  MahoRoute,
  ModuleRoutesConfig,
  ModuleRoutesDeclaration,
} from '../interfaces/MahoRoute'
import type { RemoteModule } from '../interfaces/RemoteModule'
import { RouteMerger } from './route-merger'

/**
 * 从已加载的 remotes 收集 mf-routes 声明并合并。
 *
 * - 每个 remote 尝试 load('./mf-routes')
 * - 缺失：info 日志，视为无路由模块（不打断）
 * - 格式错误：error 日志（缺 routes 字段），跳过
 * - 异常：warn 日志，跳过
 */
export async function collectRoutes(
  remotes: RemoteModule[],
): Promise<MahoRoute[]> {
  const configs: ModuleRoutesConfig[] = []

  await Promise.allSettled(
    remotes.map(async (remote) => {
      let mod: any
      try {
        mod = await remote.load('./mf-routes')
      } catch (err) {
        console.info(
          `[Maho] "${remote.name}" has no mf-routes (skipped):`,
          err,
        )
        return
      }
      const decl = (mod?.default ?? mod) as ModuleRoutesDeclaration | undefined
      if (!decl || !Array.isArray(decl.routes)) {
        console.error(
          `[Maho] "${remote.name}/mf-routes" has invalid format: missing "routes" array`,
        )
        return
      }
      configs.push({ name: remote.name, ...decl })
    }),
  )

  return new RouteMerger().merge(configs)
}
