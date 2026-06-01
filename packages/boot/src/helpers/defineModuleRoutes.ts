import type { ModuleRoutesDeclaration } from '../interfaces/MahoRoute'

/**
 * 子包路由声明辅助。运行时即透传函数，仅用于类型提示与可读性。
 *
 * ```ts
 * export default defineModuleRoutes({
 *   prefix: '/order',
 *   routes: [{ path: '/list', name: 'order-list', component: () => import('./pages/List.vue') }],
 * })
 * ```
 */
export function defineModuleRoutes(
  decl: ModuleRoutesDeclaration,
): ModuleRoutesDeclaration {
  return decl
}
