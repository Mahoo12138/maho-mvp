/// <reference path="./virtual.d.ts" />

// ── 核心 API ─────────────────────────────────────────
export { runBootPipeline } from './core/pipeline'
export { loadFederation } from './core/federation'
export { collectRoutes } from './core/route-collect'
export { RouteMerger, namespaceRouteName } from './core/route-merger'
export { resolveLayout } from './core/layout'
export { MahoLoading } from './core/loading'
export {
  getLoadedRemote,
  listLoadedRemotes,
  registerRemote,
  _resetRemoteRegistry,
} from './core/registry'

// ── Helpers ──────────────────────────────────────────
export { defineModuleRoutes } from './helpers/defineModuleRoutes'
export { defineMFMeta } from './helpers/defineMFMeta'
export { defineLayouts } from './helpers/defineLayouts'
export { routeName } from './helpers/routeName'
export { load } from './helpers/load'

// ── 类型导出 ─────────────────────────────────────────
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
