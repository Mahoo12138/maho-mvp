import type { MahoRoute } from './MahoRoute'
import type { RouteInterceptor } from './RouteInterceptor'
import type { ResolvedLayoutMap } from './LayoutConfig'

/**
 * Boot 适配协议。任何 UI 框架（Vue / React / Solid…）只需实现此接口
 * 并调用 runBootPipeline 即可接入 Maho。
 */
export interface BootAdapter<TApp = unknown, TRouter = unknown> {
  /**
   * 将规范路由转换为目标框架的路由格式。
   * 每条路由的 component（懒加载函数）需要被包装为目标框架的异步组件。
   */
  convertRoutes(routes: MahoRoute[]): unknown[]

  /** 用转换后的路由创建框架路由器实例。 */
  createRouter(routes: unknown[]): TRouter

  /**
   * 将拦截器数组安装到路由器守卫机制中：
   * - 按数组顺序串行执行
   * - 任一拦截器返回非 undefined 视为重定向，中断后续执行
   */
  applyInterceptors(router: TRouter, interceptors: RouteInterceptor[]): void

  /**
   * 将布局映射注入框架的组件树体系，使 LayoutOutlet（或等价组件）能消费。
   */
  applyLayouts(router: TRouter, layouts: ResolvedLayoutMap): void

  /**
   * 创建应用实例（注入路由器、状态管理等），不执行挂载。
   */
  createApp(rootComponent: unknown, router: TRouter): TApp

  /** 挂载到 DOM 选择器。 */
  mount(app: TApp, target: string): void

  /**
   * 可选：等待首屏路由渲染完成。
   * 不实现则 mount() 完成后立即隐藏全局 Loading。
   */
  waitForFirstRender?(app: TApp, router: TRouter): Promise<void>
}
