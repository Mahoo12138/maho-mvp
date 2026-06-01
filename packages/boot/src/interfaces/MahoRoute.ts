/**
 * 规范路由格式：框架无关，由 BootAdapter.convertRoutes 翻译到各 UI 框架。
 *
 * - path 是完整路径（合并阶段已展平），不再含相对段。
 * - name 在合并阶段已加上模块命名空间：`${moduleName}__${origName}`。
 * - component 始终是懒加载函数；适配层负责包装为 defineAsyncComponent / lazy 等。
 */
export interface MahoRoute {
  path: string
  name: string
  priority?: number
  component: () => Promise<{ default: unknown }>
  meta?: MahoRouteMeta
  children?: MahoRoute[]
}

/**
 * 路由元数据。
 *
 * 业务侧可通过 declaration merging 扩展自定义字段：
 *
 * ```ts
 * declare module '@maho/boot' {
 *   interface MahoRouteMeta {
 *     breadcrumb?: string[]
 *   }
 * }
 * ```
 */
export interface MahoRouteMeta {
  layout?: string
  auth?: boolean
  permissions?: string[]
  title?: string
  menu?: { group?: string; order?: number; icon?: string } | false
  keepAlive?: boolean
  [key: string]: unknown
}

/**
 * 子包 mf-routes.ts 默认导出的形状。
 * defineModuleRoutes 返回此结构（不含 name —— name 在 collectRoutes 阶段补齐）。
 */
export interface ModuleRoute {
  path: string
  name: string
  priority?: number
  component: () => Promise<{ default: unknown }>
  meta?: MahoRouteMeta
  children?: ModuleRoute[]
}

export interface ModuleRoutesDeclaration {
  prefix?: string
  parentRoute?: string
  routes: ModuleRoute[]
}

/**
 * collectRoutes 内部使用：补齐了 moduleName 的声明。
 */
export interface ModuleRoutesConfig extends ModuleRoutesDeclaration {
  name: string
}
