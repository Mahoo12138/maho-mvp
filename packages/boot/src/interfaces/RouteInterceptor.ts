import type { MahoRouteMeta } from './MahoRoute'

export type Redirect = string | { path: string; replace?: boolean }

export interface MahoRouteLocation {
  path: string
  fullPath: string
  params: Record<string, string>
  query: Record<string, string>
  meta: MahoRouteMeta
  name: string | undefined
}

export interface RouteContext {
  to: MahoRouteLocation
  from: MahoRouteLocation
}

/**
 * 路由拦截器：
 * - 返回 undefined 表示放行
 * - 返回 string 视作 path，执行重定向
 * - 返回 { path, replace } 进行带选项的重定向
 *
 * 拦截器数组按顺序串行执行，任一返回非 undefined 即中断。
 */
export type RouteInterceptor = (
  ctx: RouteContext,
) => Redirect | void | Promise<Redirect | void>
