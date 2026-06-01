import type { LayoutConfig, LayoutValue } from '../interfaces/LayoutConfig'

/**
 * 布局映射声明辅助。
 *
 * ```ts
 * defineLayouts({
 *   default: DefaultLayout,
 *   blank: () => import('./layouts/BlankLayout.vue'),
 *   admin: 'module-admin/layouts/AdminLayout',
 * })
 * ```
 */
export function defineLayouts(
  map: Record<string, LayoutValue>,
): LayoutConfig {
  return { map }
}
