/**
 * 跨模块导航的路由名辅助。
 *
 * 与路由合并阶段使用的命名空间规则一致：
 *   routeName('module-order', 'order-detail') === 'module-order__order-detail'
 *
 * 跨模块跳转：
 *   router.push({ name: routeName('module-order', 'order-detail'), params: { id: '1' } })
 */
export function routeName(moduleName: string, name: string): string {
  return `${moduleName}__${name}`
}
