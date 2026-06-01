/**
 * 跨模块类型注册表。
 *
 * 框架自身是空接口；vite-plugin 在构建期向 `.maho/registry.d.ts` 写入
 * 声明合并的内容，例如：
 *
 * ```ts
 * declare module '@maho/boot' {
 *   interface ModuleRegistry {
 *     'module-order/utils/formatters': typeof import('@org/module-order/utils/formatters')
 *   }
 * }
 * ```
 *
 * `mf.load(key)` 在 key 命中时返回精确类型，未命中时退化为 any。
 */
export interface ModuleRegistry {}
