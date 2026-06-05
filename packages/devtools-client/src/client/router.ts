import { Context, Service } from 'cordis'
import { reactive, shallowRef, watch, type App, type Component, type MaybeRefOrGetter, toValue } from 'vue'
import { pathToRegexp } from 'path-to-regexp'
import type { Dict } from 'cosmokit'
import { kRoute, kRouter } from './context.js'

declare module 'cordis' {
  interface Context {
    router: RouterService
  }

  interface Events {
    'activity'(activity: Activity): boolean
  }
}

export interface RouteMeta {
  activity?: Activity
}

export interface RouteRecord {
  path: string
  name?: string
  component: Component
  meta: RouteMeta
  regex: RegExp
  keys: string[]
}

export interface RouteLocation {
  path: string
  fullPath: string
  query: Dict<string>
  params: Dict<string>
  name?: string
  meta: RouteMeta
  matched: RouteRecord[]
}

export type NavigationTarget = string | { path?: string; query?: Dict<string | undefined> }
export type BeforeGuard = (to: RouteLocation, from: RouteLocation) => unknown | Promise<unknown>
export type AfterGuard = (to: RouteLocation, from: RouteLocation) => void

export const INITIAL: RouteLocation = {
  path: '',
  fullPath: '',
  query: {},
  params: {},
  meta: {},
  matched: [],
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item)
  if (i >= 0) list.splice(i, 1)
}

function parseUrl(input: string): { path: string; query: Dict<string> } {
  const i = input.indexOf('?')
  if (i < 0) return { path: input, query: {} }
  const query: Dict<string> = {}
  for (const [k, v] of new URLSearchParams(input.slice(i + 1))) query[k] = v
  return { path: input.slice(0, i), query }
}

function stringifyQuery(query: Dict<string | undefined>): string {
  const parts: string[] = []
  for (const k in query) {
    if (query[k] === undefined) continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]!))
  }
  return parts.length ? '?' + parts.join('&') : ''
}

/**
 * Minimal HTML5 history router. Mirrors webui-main `Router` modulo the
 * features we don't need (named routes, route caching).
 */
export class Router {
  public records: RouteRecord[] = []
  public currentRoute = shallowRef<RouteLocation>(INITIAL)
  private _before: BeforeGuard[] = []
  private _after: AfterGuard[] = []

  constructor(public base: string) {
    window.addEventListener('popstate', () => {
      const url = location.pathname.slice(this.base.length) + location.search
      this._navigate(url, true).catch(console.error)
    })
  }

  resolve(target: NavigationTarget): RouteLocation {
    let path: string, query: Dict<string>
    if (typeof target === 'string') {
      ({ path, query } = parseUrl(target))
    } else {
      path = target.path ?? this.currentRoute.value.path
      query = {}
      for (const k in target.query ?? {}) {
        if (target.query![k] !== undefined) query[k] = target.query![k]!
      }
    }
    for (const record of this.records) {
      const m = record.regex.exec(path)
      if (!m) continue
      const params: Dict<string> = {}
      record.keys.forEach((key, i) => (params[key] = m[i + 1] ?? ''))
      const fullPath = path + stringifyQuery(query)
      return { path, fullPath, query, params, name: record.name, meta: record.meta, matched: [record] }
    }
    const fullPath = path + stringifyQuery(query)
    return { path, fullPath, query, params: {}, meta: {}, matched: [] }
  }

  addRoute(record: Omit<RouteRecord, 'regex' | 'keys'>): () => void {
    const { regexp: regex, keys } = pathToRegexp(record.path)
    const full: RouteRecord = { ...record, regex, keys: keys.map((k) => k.name) }
    this.records.push(full)
    const cur = this.currentRoute.value
    if (cur !== INITIAL && !cur.matched.length) {
      const resolved = this.resolve(cur.fullPath)
      if (resolved.matched.length) this.currentRoute.value = resolved
    }
    return () => {
      remove(this.records, full)
      if (this.currentRoute.value.matched[0] === full) {
        this.currentRoute.value = this.resolve(this.currentRoute.value.fullPath)
      }
    }
  }

  beforeEach(guard: BeforeGuard): () => void {
    this._before.push(guard)
    return () => remove(this._before, guard)
  }

  afterEach(guard: AfterGuard): () => void {
    this._after.push(guard)
    return () => remove(this._after, guard)
  }

  async push(target: NavigationTarget): Promise<void> {
    const resolved = this.resolve(target)
    return this._navigate(resolved.fullPath, false)
  }

  async replace(target: NavigationTarget): Promise<void> {
    const resolved = this.resolve(target)
    return this._navigate(resolved.fullPath, true)
  }

  private async _navigate(fullPath: string, replace: boolean): Promise<void> {
    const from = this.currentRoute.value
    let to = this.resolve(fullPath)
    for (const guard of this._before) {
      const r = await guard(to, from)
      if (r === false) return
      if (typeof r === 'string' || (r && typeof r === 'object')) {
        to = this.resolve(r as NavigationTarget)
      }
    }
    const url = this.base + to.fullPath
    if (replace || from === INITIAL) {
      history.replaceState(null, '', url)
    } else {
      history.pushState(null, '', url)
    }
    this.currentRoute.value = to
    for (const guard of this._after) guard(to, from)
  }

  async ready(): Promise<void> {
    if (this.currentRoute.value !== INITIAL) return
    const url = location.pathname.slice(this.base.length) + location.search
    await this._navigate(url || '/', true)
  }

  install(app: App): void {
    app.provide(kRouter, this)
    app.provide(kRoute, this.currentRoute)
  }
}

export namespace Activity {
  export interface Options {
    id?: string
    path: string
    component: Component
    name: MaybeRefOrGetter<string>
    order?: number
    position?: 'top' | 'bottom'
    disabled?: () => boolean | undefined
  }
}

export interface Activity extends Activity.Options {}

function getActivityId(path: string): string {
  return path.replace(/^\//, '') || ''
}

/**
 * One sidebar entry. Setup yields disposers — wired into the caller's
 * fiber via `ctx.effect(() => activity.setup())`. Disposing the fiber
 * removes the route and the sidebar entry.
 */
export class Activity {
  id!: string

  constructor(public ctx: Context, public options: Activity.Options) {
    options.order ??= 0
    options.position ??= 'top'
    const { name: _n, disabled: _d, ...rest } = options
    Object.assign(this, rest)
  }

  *setup() {
    const { path, id = getActivityId(path), component } = this.options
    yield this.ctx.router.router.addRoute({
      path,
      name: id,
      component,
      meta: { activity: this },
    })
    this.id ??= id
    this.ctx.router.pages[this.id] = this
    yield () => { delete this.ctx.router.pages[this.id] }
  }

  get name(): string {
    return toValue(this.options.name ?? this.id)
  }

  disabled(): boolean {
    if (this.ctx.bail('activity', this)) return true
    if (this.options.disabled?.()) return true
    return false
  }
}

/**
 * RouterService exposes `pages` (reactive Dict of registered activities,
 * drives the sidebar) and `page()` for plugins to register a panel.
 *
 *     ctx.router.page({ path: '/config', component: ConfigPanel, name: 'Config' })
 */
export class RouterService extends Service {
  static override name = 'router'

  public pages = reactive<Dict<Activity>>({})
  public router: Router

  constructor(public override ctx: Context) {
    super(ctx, 'router')
    this.router = new Router('')

    ctx.effect(() => {
      const initialTitle = document.title
      const stop = watch(
        this.router.currentRoute,
        (route) => {
          if (route.meta.activity) {
            document.title = `${route.meta.activity.name}${initialTitle ? ` | ${initialTitle}` : ''}`
          }
        },
        { immediate: true },
      )
      return () => {
        document.title = initialTitle
        stop()
      }
    })
  }

  page(options: Activity.Options): unknown {
    // Wrap the component so its setup() sees the shadow ctx (with `$entry`)
    // through `provide(kContext, ...)`. Mirrors webui-main RouterService.page.
    options.component = this.ctx.client.wrapComponent(options.component)
    return this.ctx.effect(() => {
      const activity = new Activity(this.ctx, options)
      return activity.setup()
    })
  }
}
