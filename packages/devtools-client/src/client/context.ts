import type { Context } from 'cordis'
import { inject, type InjectionKey, type Ref } from 'vue'
import type { RouteLocation, Router } from './router.js'

export const kContext = Symbol('maho.devtools.context') as InjectionKey<Context>
export const kRouter = Symbol('maho.devtools.router') as InjectionKey<Router>
export const kRoute = Symbol('maho.devtools.route') as InjectionKey<Ref<RouteLocation>>

export function useContext(): Context {
  return inject(kContext)!
}

export function useRouter(): Router {
  return inject(kRouter)!
}

export function useRoute(): RouteLocation {
  const route = inject(kRoute)!
  return new Proxy({} as RouteLocation, {
    get: (_, key) => (route.value as unknown as Record<string | symbol, unknown>)[key as string],
    has: (_, key) => key in (route.value as unknown as object),
    ownKeys: () => Reflect.ownKeys(route.value as unknown as object),
    getOwnPropertyDescriptor: (_, key) =>
      Reflect.getOwnPropertyDescriptor(route.value as unknown as object, key),
  })
}

/**
 * `useRpc<T>()` — Inside a panel component, returns the reactive `data` for
 * the current entry. Function-typed fields on that data are RPC bridges
 * installed by LoaderService.injectMethods, so `data.reload()` calls the
 * server-side method transparently.
 */
export function useRpc<T = unknown>(): Ref<T> {
  const ctx = inject(kContext)!
  return ctx.$entry!.data as Ref<T>
}
