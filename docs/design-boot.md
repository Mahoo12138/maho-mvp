# Maho Boot 系统详细设计

> 本文档涵盖：Boot 设计定位、`BootAdapter` 协议、启动流水线、`virtual:maho-config` 消费、布局系统、全局 Loading、`@maho/boot-vue` 实现、自定义 `boot-xxx` 指南。

---

## 目录

1. [设计定位](#设计定位)
2. [包结构](#包结构)
3. [BootAdapter 协议](#bootadapter-协议)
4. [MahoOptions](#mahooptions)
5. [启动流水线](#启动流水线)
6. [virtual:maho-config 消费](#virtualmaho-config-消费)
7. [布局系统](#布局系统)
8. [全局 Loading](#全局-loading)
9. [@maho/boot-vue 实现](#mahoboot-vue-实现)
10. [自定义 boot-xxx 指南](#自定义-boot-xxx-指南)

---

## 设计定位

### Boot 负责的

- **应用启动编排**：按固定顺序执行联邦加载 → 路由收集 → 应用挂载
- **联邦加载**：并行拉取所有 `remoteEntry.js`，失败则跳过
- **路由收集与合并**：从各 remote 加载 `./mf-routes`，执行合并算法
- **路由拦截钩子**：提供统一的拦截器链注入点
- **布局分发**：根据路由 `meta.layout` 动态解析并渲染对应布局
- **全局 Loading 控制**：在框架挂载完成前保持 Loading 可见

### Boot 不负责的

- 用户状态管理（Pinia / Zustand / 任何 store）
- 权限逻辑（由宿主通过拦截器实现）
- UI 组件（按钮、表单、弹窗等）
- 任何业务概念

### "轻量但不简单"

API 面极小，内部复杂度完全内聚：

```
外部看到的              内部隐藏的
──────────────────      ─────────────────────────────────────
createMahoApp()    →    loadFederation（并发、重试、容错）
6 个 adapter 方法  →    collectRoutes（mf-routes 协议解析）
1 个拦截器类型     →    mergeRoutes（展平、竞争、子树替换）
                        resolveLayouts（联邦布局懒加载）
                        virtual:maho-config 静态配置消费
```

---

## 包结构

```
@maho/boot
  interfaces/
    BootAdapter.ts          适配层协议接口
    MahoRoute.ts            规范路由格式（框架无关）
    RouteInterceptor.ts     路由拦截类型
    LayoutConfig.ts         布局配置类型
    MahoStaticConfig.ts     virtual:maho-config 的类型
  core/
    federation.ts           loadFederation / collectRoutes
    route-merger.ts         路由合并算法（RouteMerger 类）
    layout.ts               布局映射解析
    pipeline.ts             runBootPipeline（启动流水线）
    loading.ts              MahoLoading（全局 Loading 控制）
  helpers/
    defineLayouts.ts        defineLayouts 辅助函数
    routeName.ts            routeName 跨模块导航辅助
  index.ts                  公开 API 导出
```

---

## BootAdapter 协议

### 接口定义

```ts
// @maho/boot/interfaces/BootAdapter.ts

export interface BootAdapter<TApp = unknown, TRouter = unknown> {

  /**
   * 将 Maho 规范路由格式转换为具体框架的路由格式。
   * 每条路由的 component 字段需在此处包装为框架要求的懒加载形式。
   */
  convertRoutes(routes: MahoRoute[]): unknown[]

  /**
   * 使用转换后的路由创建框架路由器实例。
   */
  createRouter(routes: unknown[]): TRouter

  /**
   * 将 Boot 的拦截器数组安装到框架路由器的守卫机制中。
   * 负责将 MahoRouteLocation 转换为框架的 route 对象传入拦截器。
   * 拦截器返回 string 时执行重定向，返回 undefined 时放行。
   */
  applyInterceptors(router: TRouter, interceptors: RouteInterceptor[]): void

  /**
   * 将布局映射注入框架路由体系。
   * 具体实现方式由适配层决定（provide/inject、context、全局状态等）。
   */
  applyLayouts(router: TRouter, layouts: ResolvedLayoutMap): void

  /**
   * 创建框架应用实例，注入路由器及其他必要插件（状态管理等）。
   * 不负责挂载，挂载由 mount() 完成。
   */
  createApp(rootComponent: unknown, router: TRouter): TApp

  /**
   * 将应用挂载到指定的 DOM 节点。
   * 挂载完成后由 pipeline 负责隐藏全局 Loading。
   */
  mount(app: TApp, target: string): void

  /**
   * 等待首屏路由渲染完成（可选实现）。
   * 用于精确控制全局 Loading 消失时机。
   * 不实现则 mount() 完成后立即隐藏 Loading。
   */
  waitForFirstRender?(app: TApp, router: TRouter): Promise<void>
}
```

### 规范路由格式

```ts
// @maho/boot/interfaces/MahoRoute.ts

export interface MahoRoute {
  path:       string
  name:       string                                // 已追加模块命名空间
  priority?:  number
  component:  () => Promise<{ default: unknown }>   // 统一懒加载函数形式
  meta?:      MahoRouteMeta
  children?:  MahoRoute[]
}

export interface MahoRouteMeta {
  layout?:      string
  auth?:        boolean
  permissions?: string[]
  title?:       string
  menu?:        { group?: string; order?: number; icon?: string } | false
  keepAlive?:   boolean
  [key: string]: unknown
}
```

### 路由拦截类型

```ts
// @maho/boot/interfaces/RouteInterceptor.ts

export type RouteInterceptor = (
  ctx: RouteContext
) => Redirect | void | Promise<Redirect | void>

export type Redirect = string | { path: string; replace?: boolean }

export interface RouteContext {
  to:   MahoRouteLocation
  from: MahoRouteLocation
}

export interface MahoRouteLocation {
  path:     string
  fullPath: string
  params:   Record<string, string>
  query:    Record<string, string>
  meta:     MahoRouteMeta
  name:     string | undefined
}
```

---

## MahoOptions

宿主 `src/app.ts` 调用 `createMahoApp` 时传入的完整配置：

```ts
// @maho/boot/interfaces/MahoOptions.ts

export interface MahoOptions {
  /**
   * 根组件，由宿主提供（Shell 布局组件）。
   * 内部通常只包含 <LayoutOutlet />。
   */
  root: unknown

  /**
   * 挂载目标 CSS 选择器，默认 '#app'。
   */
  mount?: string

  /**
   * 联邦配置。
   * 不填则使用 virtual:maho-config 中的配置。
   * 填写则与 virtual:maho-config 合并（options 优先）。
   */
  federation?: Partial<FederationConfig>

  /**
   * 布局映射配置，通过 defineLayouts() 辅助函数创建。
   */
  layouts?: LayoutConfig

  /**
   * 路由拦截器数组，按顺序执行，任一返回值则中断。
   */
  interceptors?: RouteInterceptor[]
}

export interface FederationConfig {
  remotes:      string[]        // remoteEntry.js URL 列表
  manifestUrl?: string          // 动态 manifest URL（可选）
}
```

---

## 启动流水线

### `runBootPipeline`

```ts
// @maho/boot/core/pipeline.ts

import mahoConfig from 'virtual:maho-config'

export async function runBootPipeline<TApp, TRouter>(
  options:  MahoOptions,
  adapter:  BootAdapter<TApp, TRouter>,
): Promise<TApp> {

  // 确保全局 Loading 可见（防止提前被外部代码隐藏）
  MahoLoading.show()

  // ── Step 1: 合并联邦配置 ────────────────────────
  // virtual:maho-config 提供构建时已知的静态配置
  // options.federation 允许宿主在运行时覆盖
  const federation: FederationConfig = {
    ...mahoConfig.federation,
    ...options.federation,
  }

  // ── Step 2: 加载联邦远端 ────────────────────────
  // 并行拉取所有 remoteEntry.js
  // 单个失败则跳过（warn 日志），不阻断整体启动
  const remotes = await loadFederation(federation)

  // ── Step 3: 收集路由 ────────────────────────────
  // 合并 inline 静态路由（构建时已知）和 remote 动态路由
  const mahoRoutes = [
    ...mahoConfig.inlineRoutes,
    ...await collectRoutes(remotes),
  ]

  // ── Step 4: 路由格式转换 ────────────────────────
  // 适配层将 MahoRoute[] 转换为框架路由格式
  const frameworkRoutes = adapter.convertRoutes(mahoRoutes)

  // ── Step 5: 创建路由器 ──────────────────────────
  const router = adapter.createRouter(frameworkRoutes)

  // ── Step 6: 安装拦截器 ──────────────────────────
  adapter.applyInterceptors(router, options.interceptors ?? [])

  // ── Step 7: 注册布局 ────────────────────────────
  const layouts = resolveLayouts(options.layouts)
  adapter.applyLayouts(router, layouts)

  // ── Step 8: 创建应用实例 ────────────────────────
  const app = adapter.createApp(options.root, router)

  // ── Step 9: 挂载 ───────────────────────────────
  adapter.mount(app, options.mount ?? '#app')

  // ── Step 10: 等待首屏渲染，隐藏 Loading ─────────
  if (adapter.waitForFirstRender) {
    await adapter.waitForFirstRender(app, router)
  }
  MahoLoading.hide()

  return app
}
```

### `loadFederation` 内部逻辑

```ts
// @maho/boot/core/federation.ts

export async function loadFederation(
  config: FederationConfig,
): Promise<RemoteModule[]> {

  // 动态 manifest 与静态 remotes 合并（动态优先）
  const remoteUrls = await resolveManifest(config)

  // 并行加载，单个失败不影响整体
  const results = await Promise.allSettled(
    remoteUrls.map(url => loadRemoteEntry(url))
  )

  return results
    .filter((r): r is PromiseFulfilledResult<RemoteModule> => {
      if (r.status === 'rejected') {
        console.warn(`[Maho] Failed to load remote: ${r.reason}`)
        return false
      }
      return true
    })
    .map(r => r.value)
}

async function loadRemoteEntry(url: string): Promise<RemoteModule> {
  // 带重试的加载：最多重试 2 次，间隔递增
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchRemoteEntry(url)
    } catch (err) {
      if (attempt === 3) throw err
      await sleep(attempt * 500)
    }
  }
  throw new Error(`Remote unreachable: ${url}`)
}
```

### `collectRoutes` 内部逻辑

```ts
// @maho/boot/core/federation.ts

export async function collectRoutes(
  remotes: RemoteModule[],
): Promise<MahoRoute[]> {

  const merger = new RouteMerger()
  const configs: ModuleRoutesConfig[] = []

  await Promise.allSettled(
    remotes.map(async (remote) => {
      try {
        // 尝试加载 ./mf-routes
        const mod = await remote.load('./mf-routes')

        // 验证导出格式
        if (!mod?.default?.routes) {
          console.error(
            `[Maho] "${remote.name}/mf-routes" has invalid format: ` +
            `missing "routes" field`
          )
          return
        }

        configs.push({ name: remote.name, ...mod.default })
      } catch {
        // 未暴露 ./mf-routes 或加载失败，静默跳过
        console.info(`[Maho] "${remote.name}" has no routes (skipped)`)
      }
    })
  )

  return merger.merge(configs)
}
```

---

## `virtual:maho-config` 消费

### 静态配置结构

```ts
// @maho/boot/interfaces/MahoStaticConfig.ts

export interface MahoStaticConfig {
  role:  'host' | 'remote'
  mode:  string             // 当前构建 mode（'dev' | 'prod' | 自定义）

  federation: {
    remotes:      string[]  // dev: localhost URLs / prod: CDN URLs
    manifestUrl:  string | null
  }

  // inline 子包的路由（构建时已知，无需运行时加载）
  inlineRoutes: MahoRoute[]

  // 共享依赖声明（由 boot-xxx 提供，Cordis 构建时读取并注入）
  shared: Record<string, {
    singleton:       boolean
    requiredVersion: string
  }>
}
```

### 类型声明

`@maho/vite-plugin` 构建时自动写入 `.maho/virtual.d.ts`，确保 TypeScript 可识别虚拟模块：

```ts
// .maho/virtual.d.ts（自动生成，不需要手动维护）
declare module 'virtual:maho-config' {
  import type { MahoStaticConfig } from '@maho/boot'
  const config: MahoStaticConfig
  export default config
}
```

宿主的 `tsconfig.json` 包含 `.maho` 目录即可：

```json
{
  "include": ["src", ".maho"]
}
```

### dev vs prod 差异

差异完全由 Cordis 在生成虚拟模块内容时处理，Boot 代码无需感知：

```ts
// @maho/vite-plugin 内部（伪代码）
function generateVirtualModuleContent(
  config: ResolvedMFConfig,
  mode:   string,
): string {
  const isDev = mode === 'dev'

  const remotes = isDev
    // dev 模式：使用 apps/* 各子包 dev server 的本地地址
    ? resolveDevRemotes(config)
    // prod 模式：使用配置中声明的 CDN 地址
    : config.federation.remotes

  return `
export default ${JSON.stringify({
    role:         config.role,
    mode,
    federation:   { remotes, manifestUrl: config.federation.manifestUrl ?? null },
    inlineRoutes: collectInlineRoutes(config),
    shared:       config.shared,
  })}
`
}
```

---

## 布局系统

### `defineLayouts` 辅助函数

```ts
// @maho/boot/helpers/defineLayouts.ts

export type LayoutValue =
  | unknown                           // 直接传入组件对象
  | (() => Promise<{ default: unknown }>)  // 懒加载本地组件
  | string                            // 联邦组件路径，如 'module-admin/layouts/AdminLayout'

export function defineLayouts(
  map: Record<string, LayoutValue>
): LayoutConfig {
  return { map }
}
```

### 布局解析流程

```ts
// @maho/boot/core/layout.ts

export async function resolveLayout(
  layoutId:  string,
  layoutMap: ResolvedLayoutMap,
): Promise<unknown> {

  const value = layoutMap[layoutId]

  // 未找到：降级 default，打印警告
  if (value === undefined) {
    if (layoutId !== 'default') {
      console.warn(`[Maho] Layout "${layoutId}" not found, falling back to "default"`)
    }
    return layoutMap['default']
  }

  // 已是组件对象，直接返回
  if (isComponent(value)) return value

  // 懒加载函数
  if (typeof value === 'function') {
    const mod = await value()
    return mod.default ?? mod
  }

  // 联邦布局字符串：运行时加载
  if (typeof value === 'string') {
    const [remoteName, ...pathParts] = value.split('/')
    const exposePath = './' + pathParts.join('/')
    const remote = getLoadedRemote(remoteName)
    if (!remote) throw new Error(`[Maho] Remote "${remoteName}" not loaded`)
    const mod = await remote.load(exposePath)
    return mod.default ?? mod
  }

  throw new Error(`[Maho] Invalid layout value for "${layoutId}"`)
}
```

### 布局切换时序

```
用户点击链接 / router.push()
  ↓
路由守卫链执行（拦截器）
  ↓
路由匹配成功
  ↓
<LayoutOutlet> 读取 route.meta.layout
  ↓
resolveLayout() 执行
  ├── 本地组件 → 同步渲染
  ├── 懒加载函数 → Suspense fallback → 渲染完成
  └── 联邦布局字符串 → 加载 remoteEntry → Suspense fallback → 渲染完成
  ↓
<RouterView> 在布局内渲染页面组件
```

---

## 全局 Loading

### HTML 模板注入

`@maho/vite-plugin` 在构建时自动向 `index.html` 注入，无需手动编写：

```html
<!-- 由 @maho/vite-plugin 自动注入 -->
<style>
  #maho-loading {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--maho-loading-bg, #ffffff);
    z-index: 99999;
    transition: opacity 0.25s ease, visibility 0.25s ease;
  }
  #maho-loading[data-hidden] {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .maho-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #e5e7eb;
    border-top-color: var(--maho-loading-color, #6366f1);
    border-radius: 50%;
    animation: maho-spin 0.7s linear infinite;
  }
  @keyframes maho-spin { to { transform: rotate(360deg); } }
</style>
<div id="maho-loading" aria-label="Loading application">
  <div class="maho-spinner"></div>
</div>
```

### `MahoLoading` 控制器

```ts
// @maho/boot/core/loading.ts

export const MahoLoading = {
  show() {
    const el = document.getElementById('maho-loading')
    el?.removeAttribute('data-hidden')
  },

  hide() {
    const el = document.getElementById('maho-loading')
    if (!el) return
    el.setAttribute('data-hidden', '')
    // 过渡动画结束后从 DOM 移除，避免遮挡
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  },
}
```

### Loading 自定义

宿主可在 `config.yml` 中替换默认 spinner：

```yaml
# config/config.yml
loading:
  # 替换为自定义 HTML 片段
  html: '<div class="my-logo-spinner"><img src="/logo.svg" /></div>'
  # 背景色
  background: "#f8fafc"
  # 主色（spinner 颜色）
  color: "#0ea5e9"
```

---

## `@maho/boot-vue` 实现

### 完整适配器

```ts
// @maho/boot-vue/adapter.ts

import {
  createApp as vueCreateApp,
  defineAsyncComponent,
  ref, computed, provide, inject,
  type Component,
} from 'vue'
import {
  createRouter,
  createWebHistory,
  useRoute,
  type Router,
  type RouteRecordRaw,
} from 'vue-router'
import { createPinia } from 'pinia'
import type { BootAdapter, MahoRoute, RouteInterceptor } from '@maho/boot'
import LayoutOutlet from './components/LayoutOutlet.vue'

const LAYOUTS_KEY = Symbol('maho:layouts')

export const vueAdapter: BootAdapter<ReturnType<typeof vueCreateApp>, Router> = {

  // ── 路由转换 ──────────────────────────────────────
  convertRoutes(routes: MahoRoute[]): RouteRecordRaw[] {
    const convert = (route: MahoRoute): RouteRecordRaw => ({
      path:      route.path,
      name:      route.name,
      meta:      route.meta ?? {},
      // 包装为 defineAsyncComponent，内置重试与错误边界
      component: defineAsyncComponent({
        loader:            route.component,
        errorComponent:    MahoRemoteError,
        loadingComponent:  MahoRemoteLoading,
        delay:             200,
        timeout:           10_000,
        onError(_, retry, fail, attempts) {
          attempts <= 2 ? retry() : fail()
        },
      }),
      children: route.children?.map(convert),
    })
    return routes.map(convert)
  },

  // ── 路由器创建 ─────────────────────────────────────
  createRouter(routes: RouteRecordRaw[]): Router {
    return createRouter({
      history: createWebHistory(),
      routes,
    })
  },

  // ── 安装拦截器 ─────────────────────────────────────
  applyInterceptors(router: Router, interceptors: RouteInterceptor[]) {
    router.beforeEach(async (to, from) => {
      const ctx = {
        to:   toMahoLocation(to),
        from: toMahoLocation(from),
      }
      for (const interceptor of interceptors) {
        const result = await interceptor(ctx)
        if (result !== undefined) return result
      }
      return true
    })
  },

  // ── 布局注册 ──────────────────────────────────────
  applyLayouts(router: Router, layouts: ResolvedLayoutMap) {
    // 通过 router.app 的 provide 共享布局映射
    // LayoutOutlet 组件通过 inject 消费
    router.isReady().then(() => {
      if (router.currentRoute.value.matched[0]?.components) {
        // 应用创建后通过 provide 注入
        ;(router as any).__mahoLayouts = layouts
      }
    })
  },

  // ── 应用创建 ──────────────────────────────────────
  createApp(rootComponent: Component, router: Router) {
    const app = vueCreateApp(rootComponent)
    const pinia = createPinia()
    app.use(pinia)
    app.use(router)
    // 注册全局组件
    app.component('LayoutOutlet', LayoutOutlet)
    // 布局映射通过 provide/inject 共享
    app.provide(LAYOUTS_KEY, (router as any).__mahoLayouts ?? {})
    return app
  },

  // ── 挂载 ──────────────────────────────────────────
  mount(app, target: string) {
    app.mount(target)
  },

  // ── 等待首屏渲染 ──────────────────────────────────
  async waitForFirstRender(_, router: Router) {
    await router.isReady()
  },
}

// 辅助：Vue Router location → MahoRouteLocation
function toMahoLocation(route: any): MahoRouteLocation {
  return {
    path:     route.path,
    fullPath: route.fullPath,
    params:   route.params as Record<string, string>,
    query:    route.query  as Record<string, string>,
    meta:     route.meta   as MahoRouteMeta,
    name:     route.name   as string | undefined,
  }
}
```

### `LayoutOutlet` 组件

```vue
<!-- @maho/boot-vue/components/LayoutOutlet.vue -->
<template>
  <Suspense>
    <component :is="currentLayout">
      <RouterView />
    </component>
    <template #fallback>
      <div class="maho-layout-loading" />
    </template>
  </Suspense>
</template>

<script setup lang="ts">
import { computed, inject, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { resolveLayout } from '@maho/boot'

const route   = useRoute()
const layouts = inject<ResolvedLayoutMap>(LAYOUTS_KEY, {})

const currentLayout = computed(() => {
  const layoutId = (route.meta.layout as string | undefined) ?? 'default'
  return defineAsyncComponent(() =>
    resolveLayout(layoutId, layouts).then(c => ({ default: c }))
  )
})
</script>
```

### `createMahoApp` 对外入口

```ts
// @maho/boot-vue/index.ts

import { runBootPipeline } from '@maho/boot'
import { vueAdapter }      from './adapter'
import type { MahoOptions } from '@maho/boot'

/**
 * 创建并启动 Maho Vue 应用。
 * 这是 Vue 项目宿主唯一需要调用的函数。
 */
export function createMahoApp(options: MahoOptions) {
  return runBootPipeline(options, vueAdapter)
}

// 重新导出常用工具，用户无需同时安装 @maho/boot
export { defineLayouts, routeName } from '@maho/boot'
export type { MahoRoute, MahoRouteMeta, RouteInterceptor } from '@maho/boot'

// boot-vue 特有的共享依赖声明（供 @maho/vite-plugin 读取）
export const sharedDeps = {
  'vue':        { singleton: true, requiredVersion: '^3.4.0' },
  'vue-router': { singleton: true, requiredVersion: '^4.3.0' },
  'pinia':      { singleton: true, requiredVersion: '^2.1.0' },
}
```

### 宿主 `src/app.ts` 完整示例

```ts
// src/app.ts
import { createMahoApp, defineLayouts } from '@maho/boot-vue'
import AppShell      from './AppShell.vue'
import DefaultLayout from './layouts/DefaultLayout.vue'
import BlankLayout   from './layouts/BlankLayout.vue'
import { useAuthStore } from './stores/auth'

createMahoApp({
  root:  AppShell,
  mount: '#app',

  layouts: defineLayouts({
    default: DefaultLayout,
    blank:   BlankLayout,
    // 联邦布局，运行时从 module-admin 加载
    admin:   'module-admin/layouts/AdminLayout',
  }),

  interceptors: [
    // 登录拦截
    async ({ to }) => {
      const auth = useAuthStore()
      if (to.meta.auth !== false && !auth.isLoggedIn) {
        return `/login?redirect=${encodeURIComponent(to.fullPath)}`
      }
    },
    // 权限拦截
    async ({ to }) => {
      const auth = useAuthStore()
      const required = to.meta.permissions as string[] | undefined
      if (required?.length && !required.every(p => auth.hasPermission(p))) {
        return '/403'
      }
    },
  ],
})
```

### `src/AppShell.vue` 极简实现

```vue
<!-- src/AppShell.vue -->
<template>
  <LayoutOutlet />
</template>
```

---

## 自定义 `boot-xxx` 指南

任何 UI 框架只需实现 `BootAdapter` 接口并调用 `runBootPipeline` 即可接入 Maho。

### 最小实现骨架

```ts
// my-boot-solid/index.ts
import { runBootPipeline } from '@maho/boot'
import type { BootAdapter, MahoOptions, MahoRoute } from '@maho/boot'

const solidAdapter: BootAdapter = {

  convertRoutes(routes: MahoRoute[]) {
    // 转换为 @solidjs/router 的格式
    return routes.map(r => ({
      path:      r.path,
      component: lazy(() => r.component()),
      data:      r.meta,
      children:  r.children ? solidAdapter.convertRoutes(r.children) : [],
    }))
  },

  createRouter(routes) {
    // 返回 Solid Router 配置
    return routes
  },

  applyInterceptors(router, interceptors) {
    // Solid Router 的守卫机制
  },

  applyLayouts(_, layouts) {
    // 将布局映射存入 Solid 的 context
    setLayoutContext(layouts)
  },

  createApp(root, router) {
    // 返回 Solid 应用的 render 函数
    return () => render(() => <Router>{root}</Router>, document.getElementById('app')!)
  },

  mount(app) {
    app()
  },
}

export function createMahoApp(options: MahoOptions) {
  return runBootPipeline(options, solidAdapter)
}

// 声明该框架的共享依赖（供 @maho/vite-plugin 读取）
export const sharedDeps = {
  'solid-js': { singleton: true, requiredVersion: '^1.8.0' },
}
```

### 实现要点检查清单

```
✅ convertRoutes：将 MahoRoute.component（懒加载函数）转换为框架格式
✅ createRouter：路由器实例包含完整路由表
✅ applyInterceptors：确保拦截器按数组顺序串行执行，返回值作为重定向目标
✅ applyLayouts：布局映射需在组件树中可被 LayoutOutlet 等价组件访问
✅ createApp：注入路由器，不执行挂载
✅ mount：执行挂载，此时 DOM 已准备好
✅ sharedDeps：声明框架核心依赖为单例，防止多实例
```

---

*下一篇：[design-cordis-services.md](./design-cordis-services.md) — Cordis 服务地图、事件时序、插件 API*
