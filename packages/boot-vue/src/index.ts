import { runBootPipeline, type MahoOptions } from '@maho/boot'
import { vueAdapter } from './adapter'

/**
 * 创建并启动 Maho Vue 应用。Vue 项目宿主唯一需要调用的函数。
 *
 * ```ts
 * import { createMahoApp, defineLayouts } from '@maho/boot-vue'
 *
 * createMahoApp({
 *   root: AppShell,
 *   layouts: defineLayouts({ default: DefaultLayout }),
 *   interceptors: [authGuard],
 * })
 * ```
 */
export function createMahoApp(options: MahoOptions) {
  return runBootPipeline(options, vueAdapter)
}

/**
 * 供 @maho/vite-plugin 在构建期读取并注入到 federation 配置。
 * Vue 生态的核心依赖统一声明为 singleton。
 */
export const sharedDeps = {
  vue: { singleton: true, requiredVersion: '^3.4.0' },
  'vue-router': { singleton: true, requiredVersion: '^4.3.0' },
  pinia: { singleton: true, requiredVersion: '^2.1.0' },
} as const

// ── 组件与组合式 API ─────────────────────────────────
export { default as LayoutOutlet } from './components/LayoutOutlet.vue'
export { default as MahoRemoteError } from './components/MahoRemoteError.vue'
export { default as MahoRemoteLoading } from './components/MahoRemoteLoading.vue'
export { useMenu, type MenuItem } from './composables/useMenu'
export { LAYOUTS_KEY } from './layouts-key'
export { vueAdapter } from './adapter'

// ── 透传 @maho/boot 常用工具 ─────────────────────────
export {
  defineModuleRoutes,
  defineMFMeta,
  defineLayouts,
  routeName,
  load,
  MahoLoading,
  getLoadedRemote,
  listLoadedRemotes,
} from '@maho/boot'

// ── 类型透传 ────────────────────────────────────────
export type {
  MahoOptions,
  FederationConfig,
  MahoRoute,
  MahoRouteMeta,
  ModuleRoute,
  ModuleRoutesDeclaration,
  RouteInterceptor,
  RouteContext,
  MahoRouteLocation,
  Redirect,
  LayoutConfig,
  LayoutValue,
  ResolvedLayoutMap,
  MahoStaticConfig,
  MFMeta,
  ModuleRegistry,
  RemoteModule,
  BootAdapter,
} from '@maho/boot'
