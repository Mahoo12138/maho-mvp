import mahoConfig from 'virtual:maho-config'
import type { BootAdapter } from '../interfaces/BootAdapter'
import type { FederationConfig, MahoOptions } from '../interfaces/MahoOptions'
import type { ResolvedLayoutMap } from '../interfaces/LayoutConfig'
import { loadFederation } from './federation'
import { collectRoutes } from './route-collect'
import { MahoLoading } from './loading'

/**
 * 10 步启动流水线。BootAdapter 实现负责所有框架特定步骤；
 * 此函数只负责编排顺序和数据流。
 */
export async function runBootPipeline<TApp, TRouter>(
  options: MahoOptions,
  adapter: BootAdapter<TApp, TRouter>,
): Promise<TApp> {
  MahoLoading.show()

  // 1. 合并联邦配置（virtual:maho-config 作为基线，options 覆盖）
  const federation: FederationConfig = {
    remotes: options.federation?.remotes ?? mahoConfig.federation.remotes,
    manifestUrl:
      options.federation?.manifestUrl ?? mahoConfig.federation.manifestUrl,
  }

  // 2. 并行加载所有 remoteEntry.js（失败跳过）
  const remotes = await loadFederation(federation)

  // 3. 收集路由：inline（构建时内联）+ remote（运行时通过 mf-routes）
  const mahoRoutes = [
    ...(mahoConfig.inlineRoutes ?? []),
    ...(await collectRoutes(remotes)),
  ]

  // 4. 转换为目标框架路由格式
  const frameworkRoutes = adapter.convertRoutes(mahoRoutes)

  // 5. 创建路由器
  const router = adapter.createRouter(frameworkRoutes)

  // 6. 安装拦截器链
  adapter.applyInterceptors(router, options.interceptors ?? [])

  // 7. 注册布局映射
  const layouts: ResolvedLayoutMap = options.layouts?.map ?? {}
  adapter.applyLayouts(router, layouts)

  // 8. 创建应用实例
  const app = adapter.createApp(options.root, router)

  // 9. 挂载
  adapter.mount(app, options.mount ?? '#app')

  // 10. 等待首屏渲染，隐藏 Loading
  if (adapter.waitForFirstRender) {
    try {
      await adapter.waitForFirstRender(app, router)
    } catch (err) {
      console.warn('[Maho] waitForFirstRender threw, hiding loading anyway:', err)
    }
  }
  MahoLoading.hide()

  return app
}
