/**
 * 布局值的三种形态：
 * - 直接组件对象（已加载）
 * - 懒加载函数：() => import('./Layout.vue')
 * - 联邦路径字符串：'module-admin/layouts/AdminLayout'
 */
export type LayoutValue =
  | unknown
  | (() => Promise<{ default: unknown } | unknown>)
  | string

export interface LayoutConfig {
  map: Record<string, LayoutValue>
}

/**
 * 注入到适配层 / LayoutOutlet 的形态，与 LayoutConfig.map 同构。
 * resolveLayout 负责把任一种形态归一为可渲染的组件。
 */
export type ResolvedLayoutMap = Record<string, LayoutValue>
