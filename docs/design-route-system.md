# Maho 路由系统详细设计

> 本文档涵盖：`mf-routes.ts` 协议、路由合并算法、priority 规则、守卫链、布局集成、菜单联动。

---

## 目录

1. [整体流程](#整体流程)
2. [mf-routes.ts 协议](#mf-routests-协议)
3. [路由合并算法](#路由合并算法)
4. [Priority 规则](#priority-规则)
5. [路由守卫链](#路由守卫链)
6. [布局集成](#布局集成)
7. [菜单联动](#菜单联动)
8. [类型扩展](#类型扩展)
9. [错误处理](#错误处理)

---

## 整体流程

```
子包构建
  └── 暴露 ./mf-routes（defineModuleRoutes 声明）

Boot 启动
  ├── loadFederation：加载所有 remoteEntry.js
  ├── collectRoutes：从每个 remote 加载 ./mf-routes
  ├── mergeRoutes：执行合并算法（展平 → 竞争 → 重组树）
  └── createRouter：用合并后的路由表创建框架路由器

运行时
  ├── 路由切换 → 守卫链执行 → 布局解析 → 组件渲染
  └── 菜单组件 useMenu() 响应路由表变化自动更新
```

---

## `mf-routes.ts` 协议

### 子包必须暴露的出口

每个参与路由分发的 Remote 子包，必须在 `exposes` 中声明 `./mf-routes`：

```ts
// apps/module-order/vite.config.ts（由 @maho/vite-plugin 自动注入，无需手写）
federation({
  exposes: {
    './mf-routes': './src/mf-routes.ts',
    // ... 其他暴露
  },
})
```

### `defineModuleRoutes` 完整 Schema

```ts
import { defineModuleRoutes } from '@maho/boot'

export default defineModuleRoutes({
  // 路由前缀。不填则默认使用模块名，如 /module-order
  // 填写后所有 routes[].path 都会以此为前缀
  prefix?: string,

  // 挂载到 Host 的哪个具名路由下（用于嵌套布局场景）
  // 不填则挂载到根路由层级
  parentRoute?: string,

  routes: ModuleRoute[],
})
```

### `ModuleRoute` 字段定义

```ts
interface ModuleRoute {
  // 相对于 prefix 的路径，必须以 / 开头
  path: string

  // 模块内唯一的路由名称
  // boot 合并时自动添加命名空间：${moduleName}__${name}
  name: string

  // 优先级，默认 0，越大越优先
  // 用于同 path 多模块竞争场景（路由覆盖/改写）
  priority?: number

  // 始终是懒加载函数，适配层负责转换为框架格式
  component: () => Promise<{ default: unknown }>

  // 路由元数据
  meta?: MahoRouteMeta

  // 子路由，递归结构，每条子路由也有独立 priority
  children?: ModuleRoute[]
}
```

### `MahoRouteMeta` 标准字段

```ts
interface MahoRouteMeta {
  // 使用哪个布局，对应 defineLayouts 中的 key
  // 填写包含 / 的字符串则视为联邦布局路径（运行时懒加载）
  layout?: string

  // 是否需要登录，默认 true
  // 显式设为 false 则该路由为公开路由（如登录页）
  auth?: boolean

  // 所需权限列表，全部满足才可访问
  permissions?: string[]

  // 页面标题，供 document.title 和面包屑使用
  title?: string

  // 菜单配置，false 则不出现在菜单
  menu?: {
    group?: string    // 所属菜单分组
    order?: number    // 分组内排序，越小越靠前
    icon?:  string    // 图标标识符
  } | false

  // 路由组件缓存（对应 <KeepAlive>）
  keepAlive?: boolean

  // 业务自定义字段，通过声明合并扩展类型（见「类型扩展」章节）
  [key: string]: unknown
}
```

### 完整声明示例

```ts
// apps/module-order/src/mf-routes.ts
import { defineModuleRoutes } from '@maho/boot'

export default defineModuleRoutes({
  prefix: '/order',

  routes: [
    {
      path: '/list',
      name: 'order-list',
      component: () => import('./pages/OrderList.vue'),
      meta: {
        layout: 'default',
        auth: true,
        permissions: ['order:read'],
        title: '订单列表',
        menu: { group: '业务管理', order: 10, icon: 'ti-clipboard-list' },
        keepAlive: true,
      },
    },
    {
      path: '/detail/:id',
      name: 'order-detail',
      component: () => import('./pages/OrderDetail.vue'),
      meta: {
        layout: 'default',
        auth: true,
        permissions: ['order:read'],
        title: '订单详情',
        menu: false,     // 不出现在菜单
      },
    },
    {
      path: '/print/:id',
      name: 'order-print',
      component: () => import('./pages/OrderPrint.vue'),
      meta: {
        layout: 'blank', // 打印页使用空白布局
        auth: true,
        title: '打印订单',
        menu: false,
      },
    },
  ],
})
```

---

## 路由合并算法

合并分三步：**展平 → 竞争解析 → 重组树**。

### Step 1：展平所有路由，计算完整 path

```ts
interface FlatRoute {
  fullPath:   string        // 完整路径，如 /order/detail/:id
  parentPath: string | null // 父路由完整路径，根路由为 null
  route:      ModuleRoute
  priority:   number        // 继承自 route.priority ?? 0
  moduleName: string        // 来源模块名
  loadOrder:  number        // 模块加载序号，priority 相同时用于 tiebreak
}

function flattenRoutes(
  config: ModuleRoutesConfig,
  loadOrder: number,
): FlatRoute[] {
  const result: FlatRoute[] = []

  function walk(routes: ModuleRoute[], parentFullPath: string | null) {
    for (const route of routes) {
      const segment = route.path.startsWith('/')
        ? route.path
        : `/${route.path}`

      const fullPath = parentFullPath === null
        ? `${config.prefix}${segment}`          // 根路由：prefix + path
        : `${parentFullPath}/${segment}`.replace(/\/+/g, '/')  // 子路由

      result.push({
        fullPath,
        parentPath: parentFullPath,
        route,
        priority:   route.priority ?? 0,
        moduleName: config.name,
        loadOrder,
      })

      if (route.children?.length) {
        walk(route.children, fullPath)
      }
    }
  }

  walk(config.routes, null)
  return result
}
```

### Step 2：竞争解析

按 `fullPath` 分组，每组内按 priority 决出胜者，记录被淘汰的子树根节点：

```ts
function resolveConflicts(allFlat: FlatRoute[]): {
  winners:        Map<string, FlatRoute>   // path → 胜出路由
  eliminatedRoots: Set<string>             // "moduleName::path" 被消除的子树根
} {
  const byPath   = groupBy(allFlat, f => f.fullPath)
  const winners  = new Map<string, FlatRoute>()
  const eliminated = new Set<string>()

  for (const [path, group] of byPath) {
    if (group.length === 1) {
      winners.set(path, group[0])
      continue
    }

    // priority 降序，priority 相同时 loadOrder 降序（后加载的赢）
    group.sort((a, b) =>
      b.priority !== a.priority
        ? b.priority - a.priority
        : b.loadOrder - a.loadOrder
    )

    const winner = group[0]
    const losers = group.slice(1)

    // 同 priority 的情况：warn 并取最后一个（已通过 loadOrder 排序保证）
    const samePriority = losers.filter(l => l.priority === winner.priority)
    if (samePriority.length > 0) {
      console.warn(
        `[Maho Router] Route conflict at "${path}" — same priority ${winner.priority}. ` +
        `Modules: [${[winner, ...samePriority].map(f => f.moduleName).join(', ')}]. ` +
        `"${winner.moduleName}" wins by load order.`
      )
    }

    winners.set(path, winner)

    // 所有败者的该 path 标记为消除子树根
    for (const loser of losers) {
      eliminated.add(`${loser.moduleName}::${path}`)
    }
  }

  return { winners, eliminatedRoots: eliminated }
}
```

### Step 3：过滤消除子树，重组嵌套结构

```ts
function buildRouteTree(
  allFlat:        FlatRoute[],
  winners:        Map<string, FlatRoute>,
  eliminatedRoots: Set<string>,
): MahoRoute[] {

  // 判断某条路由是否在被消除的子树内
  function isEliminated(flat: FlatRoute): boolean {
    // 自身是被淘汰的子树根
    if (eliminatedRoots.has(`${flat.moduleName}::${flat.fullPath}`)) {
      return true
    }
    // 祖先路径中有被消除的根（子树连带消除）
    const parts = flat.fullPath.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const ancestor = '/' + parts.slice(0, i).join('/')
      if (eliminatedRoots.has(`${flat.moduleName}::${ancestor}`)) {
        return true
      }
    }
    return false
  }

  // 只保留胜出路由
  const surviving = allFlat.filter(flat => {
    if (isEliminated(flat)) return false
    const winner = winners.get(flat.fullPath)
    return !winner || winner === flat
  })

  // 按父路径重建嵌套结构
  const byFullPath = new Map(surviving.map(f => [f.fullPath, f]))
  const roots: MahoRoute[] = []

  for (const flat of surviving) {
    // 路由名添加模块命名空间，防止全局 name 冲突
    const record = {
      ...flat.route,
      path:     flat.fullPath,
      name:     `${flat.moduleName}__${flat.route.name}`,
      children: [] as MahoRoute[],
    }

    if (flat.parentPath === null) {
      roots.push(record)
    } else {
      const parent = byFullPath.get(flat.parentPath)
      if (parent) {
        ;(parent.route as any).__resolved ??= record
        ;(parent.route as any).__children ??= []
        ;(parent.route as any).__children.push(record)
      }
    }
  }

  return roots
}
```

### 对外入口

```ts
export class RouteMerger {
  merge(configs: ModuleRoutesConfig[]): MahoRoute[] {
    const allFlat = configs.flatMap((config, index) =>
      flattenRoutes(config, index)
    )
    const { winners, eliminatedRoots } = resolveConflicts(allFlat)
    return buildRouteTree(allFlat, winners, eliminatedRoots)
  }
}
```

---

## Priority 规则

### 基本规则

| 场景 | 处理方式 |
|---|---|
| 不同 path | 各自独立注册，无竞争 |
| 相同 path，不同 prefix（本质不同 path）| 各自独立注册 |
| 相同 path，priority 不同 | 高 priority 胜出，低 priority **整棵子树**消失 |
| 相同 path，priority 相同 | `warn`，按模块加载顺序取最后一个 |

### 子树替换语义

覆盖是以**整棵子树**为单位的，不是单条路由：

```
module-a 声明：
  /shared/page-a (priority: 10)
    ├── /shared/page-a/detail (priority: 10)
    └── /shared/page-a/comments (priority: 10)

module-b 声明：
  /shared/page-a (priority: 20)
    └── /shared/page-a/detail (priority: 20)

合并结果：
  ✓ /shared/page-a          来自 module-b（priority 20 胜）
  ✓ /shared/page-a/detail   来自 module-b（priority 20 胜）
  ✗ /shared/page-a/comments 随 module-a 子树一起被消除
```

### 孤儿子节点处理

当低优先级模块的父节点被替换，但高优先级模块只覆盖了部分子节点时：

```
module-a：/shared/page-a (priority: 10)
module-b：/shared/page-a/detail (priority: 20)  ← 只有子节点，没有父节点

合并结果：
  ✓ /shared/page-a          来自 module-a（唯一声明，无竞争）
  ✓ /shared/page-a/detail   来自 module-b（priority 胜出）
  孤儿节点 /shared/page-a/detail 挂载到 module-a 的 /shared/page-a 下
```

### 宿主路由地位

Host 自身声明的路由与子包路由**平等参与** priority 竞争，无特权。若 Host 想确保某路由不被覆盖，显式声明足够高的 priority 即可。

---

## 路由守卫链

### 执行顺序

```
全局拦截器（app.ts 传入的 interceptors[]）
  ↓ 按数组顺序依次执行
  ↓ 任意一个返回非 undefined 则中断，执行重定向
  ↓ 全部通过
页面组件 beforeRouteEnter（框架原生守卫）
```

### 拦截器类型

```ts
type RouteInterceptor = (
  ctx: RouteContext
) => Redirect | void | Promise<Redirect | void>

type Redirect = string | { path: string; replace?: boolean }

interface RouteContext {
  to:   MahoRouteLocation
  from: MahoRouteLocation
}

interface MahoRouteLocation {
  path:        string
  fullPath:    string
  params:      Record<string, string>
  query:       Record<string, string>
  meta:        MahoRouteMeta
  name:        string | undefined
}
```

### 适配层安装守卫

拦截器数组由 Boot 传递给适配层，适配层负责翻译成框架守卫 API：

```ts
// @maho/boot-vue 内部
applyInterceptors(router: VueRouter, interceptors: RouteInterceptor[]) {
  router.beforeEach(async (to, from) => {
    const ctx: RouteContext = {
      to:   toMahoLocation(to),
      from: toMahoLocation(from),
    }
    for (const interceptor of interceptors) {
      const result = await interceptor(ctx)
      if (result !== undefined) return result   // 重定向
    }
    return true  // 放行
  })
}
```

### 典型守卫写法

```ts
// src/app.ts
createMahoApp({
  interceptors: [
    // 登录检查
    async ({ to }) => {
      if (to.meta.auth !== false && !authStore.isLoggedIn) {
        return `/login?redirect=${encodeURIComponent(to.fullPath)}`
      }
    },
    // 权限检查
    async ({ to }) => {
      const required = to.meta.permissions
      if (required?.length && !required.every(p => authStore.hasPermission(p))) {
        return '/403'
      }
    },
    // 业务自定义逻辑
    async ({ to }) => {
      if (to.meta.requiresVip && !userStore.isVip) {
        return '/upgrade'
      }
    },
  ],
})
```

---

## 布局集成

### 声明方式

```ts
// src/app.ts
import { defineLayouts } from '@maho/boot-vue'

createMahoApp({
  layouts: defineLayouts({
    // 本地组件（直接引用）
    default: DefaultLayout,

    // 本地懒加载组件
    blank: () => import('./layouts/BlankLayout.vue'),

    // 联邦布局：字符串格式，运行时懒加载
    admin: 'module-admin/layouts/AdminLayout',
  }),
})
```

### 布局解析优先级

```
路由 meta.layout 有值
  → 在 layoutMap 中查找
  → 找到：
      是组件 → 直接使用
      是函数 → await 执行，取 .default
      是字符串 → mf.load(string)，运行时联邦加载
  → 未找到 → 降级使用 default 布局 + warn 日志

路由 meta.layout 未声明
  → 使用 default 布局
```

### `<LayoutOutlet>` 组件

由 `@maho/boot-vue` 提供，根据当前路由的 `meta.layout` 动态切换布局：

```vue
<!-- @maho/boot-vue/components/LayoutOutlet.vue -->
<template>
  <Suspense>
    <component :is="currentLayout">
      <RouterView />
    </component>
    <template #fallback>
      <!-- 联邦布局加载中，复用全局 loading 样式 -->
      <div class="maho-layout-loading" />
    </template>
  </Suspense>
</template>
```

Host 的 `AppShell.vue` 只需引用这一个组件：

```vue
<!-- src/AppShell.vue -->
<template>
  <LayoutOutlet />
</template>
```

---

## 菜单联动

### `useMenu()` Composable

框架提供响应式菜单数据，路由表变化时自动更新：

```ts
// @maho/boot-vue 导出
export function useMenu(): ComputedRef<MenuItem[]>

interface MenuItem {
  title:    string
  path:     string
  name:     string
  icon?:    string
  order:    number
  children: MenuItem[]
}
```

### 内部实现

```ts
// @maho/boot-vue 内部
export function useMenu() {
  const router = useRouter()

  return computed(() => {
    const routes = router.getRoutes()

    // 筛选出现在菜单的路由
    const menuRoutes = routes.filter(r =>
      r.meta?.menu !== false &&
      r.meta?.menu != null
    )

    // 按 group 分组，按 order 排序，组装树结构
    return buildMenuTree(menuRoutes)
  })
}
```

路由表动态追加（remote 模块加载完成后）会触发 computed 重新计算，菜单组件无需额外订阅。

---

## 类型扩展

### 扩展 `MahoRouteMeta`

业务层可以为 meta 声明自定义字段，在路由声明和拦截器中都获得类型推导：

```ts
// src/types/maho.d.ts（或任意 .d.ts 文件）
import '@maho/boot'

declare module '@maho/boot' {
  interface MahoRouteMeta {
    keepAlive?:  boolean
    transition?: string
    breadcrumb?: string[]
    requiresVip?: boolean
  }
}
```

扩展后，路由 meta 和拦截器的 `ctx.to.meta` 都有完整类型提示。

### 路由名类型安全辅助

跨模块导航时，模块名空间化的路由名可通过辅助函数生成：

```ts
import { routeName } from '@maho/boot'

// routeName('module-order', 'order-detail') → 'module-order__order-detail'
router.push({ name: routeName('module-order', 'order-detail'), params: { id: '123' } })
```

---

## 错误处理

### `collectRoutes` 容错矩阵

| 情况 | 行为 | 日志级别 |
|---|---|---|
| remote 未暴露 `./mf-routes` | 跳过，视为无路由模块 | `info` |
| `./mf-routes` 加载失败（网络/404）| 跳过该模块路由，不影响其他模块 | `warn` |
| 导出格式不合法（缺少 `routes` 字段）| 跳过，打印具体缺失字段 | `error` |
| 路由 `component` 加载失败（页面级）| 渲染错误边界组件，不影响其他路由 | `error` |

### 错误边界组件

适配层为每个远程组件自动包裹错误边界，单个页面加载失败不影响整个应用：

```ts
// @maho/boot-vue 内部：convertRoutes 时自动包装
function wrapWithErrorBoundary(loader: () => Promise<unknown>) {
  return defineAsyncComponent({
    loader,
    errorComponent: MahoRemoteError,   // 框架内置错误展示组件
    loadingComponent: MahoRemoteLoading,
    delay: 200,
    timeout: 10_000,
    onError(err, retry, fail, attempts) {
      if (attempts <= 2) retry()       // 自动重试 2 次
      else fail()
    },
  })
}
```

### 路由合并冲突日志格式

开发模式下，所有路由竞争结果输出到控制台，格式统一便于排查：

```
[Maho Router] Route resolution report:

/shared/page-a
  ✓ module-b   priority=20  [winner]
  ✗ module-a   priority=10  [eliminated, subtree: /detail, /comments]

/shared/page-b
  ✓ module-a   priority=0   [no conflict]

/shared/page-c/detail
  ⚠ module-a   priority=5   [warn: same priority, loses by load order]
  ✓ module-c   priority=5   [winner by load order]
```

---

*下一篇：[design-boot.md](./design-boot.md) — Boot 适配协议、pipeline、布局系统*
