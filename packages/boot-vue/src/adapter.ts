import {
  createApp as vueCreateApp,
  defineAsyncComponent,
  type App,
  type Component,
} from 'vue'
import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type RouteRecordRaw,
  type Router,
} from 'vue-router'
import { createPinia } from 'pinia'
import type {
  BootAdapter,
  MahoRoute,
  MahoRouteLocation,
  MahoRouteMeta,
  ResolvedLayoutMap,
  RouteInterceptor,
} from '@maho/boot'

import LayoutOutlet from './components/LayoutOutlet.vue'
import MahoRemoteError from './components/MahoRemoteError.vue'
import MahoRemoteLoading from './components/MahoRemoteLoading.vue'
import { LAYOUTS_KEY } from './layouts-key'

/**
 * 将布局映射与具体路由器实例关联，
 * createApp 时再 provide 给整个组件树。
 *
 * 不污染 Router 对象本身，且支持多实例并存。
 */
const layoutsByRouter = new WeakMap<Router, ResolvedLayoutMap>()

export const vueAdapter: BootAdapter<App, Router> = {
  convertRoutes(routes: MahoRoute[]): RouteRecordRaw[] {
    return routes.map(convertRoute)
  },

  createRouter(routes): Router {
    return createRouter({
      history: createWebHistory(),
      routes: routes as RouteRecordRaw[],
    })
  },

  applyInterceptors(router, interceptors: RouteInterceptor[]) {
    if (interceptors.length === 0) return
    router.beforeEach(async (to, from) => {
      const ctx = {
        to: toMahoLocation(to),
        from: toMahoLocation(from),
      }
      for (const interceptor of interceptors) {
        const result = await interceptor(ctx)
        if (result === undefined) continue
        if (typeof result === 'string') return result
        // { path, replace }
        const target: RouteLocationRaw = { path: result.path, replace: result.replace }
        return target
      }
      return true
    })
  },

  applyLayouts(router, layouts) {
    layoutsByRouter.set(router, layouts)
  },

  createApp(rootComponent, router) {
    const app = vueCreateApp(rootComponent as Component)
    app.use(createPinia())
    app.use(router)
    app.component('LayoutOutlet', LayoutOutlet)
    app.provide(LAYOUTS_KEY, layoutsByRouter.get(router) ?? {})
    return app
  },

  mount(app, target) {
    app.mount(target)
  },

  async waitForFirstRender(_app, router) {
    await router.isReady()
  },
}

function convertRoute(route: MahoRoute): RouteRecordRaw {
  const record: RouteRecordRaw = {
    path: route.path,
    name: route.name,
    meta: route.meta ?? {},
    component: defineAsyncComponent({
      loader: route.component as () => Promise<Component>,
      errorComponent: MahoRemoteError,
      loadingComponent: MahoRemoteLoading,
      delay: 200,
      timeout: 10_000,
      onError(_err, retry, fail, attempts) {
        if (attempts <= 2) retry()
        else fail()
      },
    }),
  } as RouteRecordRaw
  if (route.children?.length) {
    ;(record as any).children = route.children.map(convertRoute)
  }
  return record
}

function toMahoLocation(loc: RouteLocationNormalized): MahoRouteLocation {
  return {
    path: loc.path,
    fullPath: loc.fullPath,
    params: loc.params as Record<string, string>,
    query: loc.query as Record<string, string>,
    meta: loc.meta as MahoRouteMeta,
    name: typeof loc.name === 'string' ? loc.name : undefined,
  }
}
