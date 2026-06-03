/**
 * 类型聚合入口。专门给 Node 端（vite-plugin / cli / core）使用 ——
 * 不会牵出运行时模块（federation.ts / loading.ts 等含 DOM 调用），
 * 避免下游 tsconfig 必须开 `lib: ["DOM"]`。
 *
 * 浏览器侧消费方仍走 `@maho/boot`（默认入口），完整 API + 类型。
 */
export type { BootAdapter } from './interfaces/BootAdapter'
export type {
  BootBuildAdapter,
  BootSharedDep,
  BootSharedDepsMap,
  VitePluginLike,
} from './interfaces/BootBuildAdapter'
export type {
  MahoRoute,
  MahoRouteMeta,
  ModuleRoute,
  ModuleRoutesDeclaration,
  ModuleRoutesConfig,
} from './interfaces/MahoRoute'
export type {
  MahoOptions,
  FederationConfig,
} from './interfaces/MahoOptions'
export type {
  RouteInterceptor,
  RouteContext,
  MahoRouteLocation,
  Redirect,
} from './interfaces/RouteInterceptor'
export type {
  LayoutConfig,
  LayoutValue,
  ResolvedLayoutMap,
} from './interfaces/LayoutConfig'
export type { MahoStaticConfig } from './interfaces/MahoStaticConfig'
export type { MFMeta } from './interfaces/MFMeta'
export type { ModuleRegistry } from './interfaces/ModuleRegistry'
export type {
  RemoteModule,
  ManifestRemoteEntry,
  FederationManifest,
} from './interfaces/RemoteModule'
