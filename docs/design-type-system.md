# Maho 跨模块类型系统详细设计

> 本文档涵盖：类型分发机制、子包构建期类型生成、跨模块注册表、`mf.load()` 类型推导、`virtual:maho-config` 类型声明、版本漂移检测。

---

## 目录

1. [设计目标](#设计目标)
2. [整体链路](#整体链路)
3. [子包类型生成](#子包类型生成)
4. [npm 包的双产物结构](#npm-包的双产物结构)
5. [跨模块类型注册表](#跨模块类型注册表)
6. [mf.load() 类型推导](#mfload-类型推导)
7. [virtual:maho-config 类型声明](#virtualmaho-config-类型声明)
8. [MahoRouteMeta 类型扩展](#mahoroutemeta-类型扩展)
9. [TypeService 实现](#typeservice-实现)
10. [版本漂移检测](#版本漂移检测)
11. [tsconfig 配置指南](#tsconfig-配置指南)

---

## 设计目标

```
跨模块调用有类型    mf.load('module-order/utils/formatters')
                    → 自动推导为 typeof import('@org/module-order/utils/formatters')

路由 meta 有类型    route.meta.permissions → string[]
                    route.meta.keepAlive   → boolean（业务扩展字段）

配置有类型          virtual:maho-config → MahoStaticConfig
                    插件 with 字段      → 对应插件声明的 Schema 类型

无任何手动维护      类型随 npm 包版本走，框架自动生成注册表
```

---

## 整体链路

```
子包构建
  └── TypeService.emitDeclarations()
        → dist/types/*.d.ts（每个 exposes 入口的类型）
        → package.json exports.types 字段更新
              ↓
        npm publish @org/module-order

消费方（Host 或其他子包）
  └── npm install @org/module-order
        ↓
  TypeService.syncRegistry()（dev/build 启动时自动执行）
        → 扫描 node_modules 中所有带 maho 字段的包
        → 生成 .maho/registry.d.ts
        ↓
  mf.load('module-order/utils/formatters')
        → TypeScript 从 registry.d.ts 查找映射
        → 推导为对应类型
```

---

## 子包类型生成

### 触发时机

子包执行 `maho build` 时，`BuildPipelineService` 在 Vite 构建完成后调用 `TypeService.emitDeclarations()`。

### 生成范围

只为 `config.yml` 中 `exposes` 声明的入口生成类型，内部实现细节不暴露：

```yaml
# apps/module-order/config/config.yml
exposes:
  - ./pages/OrderList
  - ./pages/OrderDetail
  - ./components/OrderCard
  - ./utils/formatters
  - ./mf-routes
```

### 生成产物

```
dist/
  types/
    pages/
      OrderList.d.ts
      OrderDetail.d.ts
    components/
      OrderCard.d.ts
    utils/
      formatters.d.ts
    mf-routes.d.ts
```

### 生成实现

```ts
// @maho/core/services/type.ts

async function emitDeclarations(config: ResolvedMFConfig): Promise<void> {
  const exposes = config.exposes ?? []

  // 使用 vite-plugin-dts 对每个 exposes 入口生成 .d.ts
  // rollupTypes: true 展开内部路径别名，消费方无需了解子包内部结构
  await generateDts({
    include:      exposes.map(e => `src/${e.replace('./', '')}`),
    outDir:       'dist/types',
    rollupTypes:  true,
    // 只保留 public API，剥除内部 import
    strictOutput: true,
  })

  // 同步更新 package.json 的 exports 字段
  await syncPackageExports(exposes)
}

async function syncPackageExports(exposes: string[]): Promise<void> {
  const pkg = await readJson('package.json')

  pkg.exports ??= {}

  for (const exposePath of exposes) {
    // './utils/formatters' → exports['./utils/formatters']
    pkg.exports[exposePath] = {
      types:  `./dist/types${exposePath.slice(1)}.d.ts`,
      import: `./dist${exposePath.slice(1)}.js`,
    }
  }

  // maho 元数据：供 TypeService.scanMahoPackages 识别
  pkg.maho = {
    name:    config.name,
    exposes: exposes,
  }

  await writeJson('package.json', pkg)
}
```

---

## npm 包的双产物结构

子包发布的 npm 包同时承担两个职责：**运行时代码**和**类型来源**。

```
@org/module-order/
  package.json
  dist/
    remoteEntry.js          → 部署到 CDN，运行时远程加载
    utils/
      formatters.js         → npm 直接引用（测试 / monorepo 场景）
    components/
      OrderCard.js
    types/
      utils/
        formatters.d.ts     → npm 安装后的类型来源
      components/
        OrderCard.d.ts
      mf-routes.d.ts
```

### `package.json` exports 示例

```json
{
  "name": "@org/module-order",
  "version": "2.1.0",
  "maho": {
    "name": "module-order",
    "exposes": [
      "./utils/formatters",
      "./components/OrderCard",
      "./pages/OrderList",
      "./pages/OrderDetail",
      "./mf-routes"
    ]
  },
  "exports": {
    "./utils/formatters": {
      "types":  "./dist/types/utils/formatters.d.ts",
      "import": "./dist/utils/formatters.js"
    },
    "./components/OrderCard": {
      "types":  "./dist/types/components/OrderCard.d.ts",
      "import": "./dist/components/OrderCard.js"
    },
    "./mf-routes": {
      "types":  "./dist/types/mf-routes.d.ts",
      "import": "./dist/mf-routes.js"
    }
  }
}
```

`"import"` 字段指向真实的模块代码，使子包在以下场景可直接引用，不强制走 `mf.load()`：

- **单元测试**：`import { formatDate } from '@org/module-order/utils/formatters'`
- **Monorepo 本地开发**：workspace 直接引用，无需 dev server
- **类型检查**：TypeScript 通过 `exports.types` 找到类型声明

---

## 跨模块类型注册表

### 注册表格式

```ts
// .maho/registry.d.ts（自动生成，不要手动编辑）

import '@maho/boot'

declare module '@maho/boot' {
  interface ModuleRegistry {
    // module-order 的所有暴露模块
    'module-order/utils/formatters':   typeof import('@org/module-order/utils/formatters')
    'module-order/components/OrderCard': typeof import('@org/module-order/components/OrderCard')
    'module-order/pages/OrderList':    typeof import('@org/module-order/pages/OrderList')
    'module-order/pages/OrderDetail':  typeof import('@org/module-order/pages/OrderDetail')

    // module-user 的所有暴露模块
    'module-user/utils/auth':          typeof import('@org/module-user/utils/auth')
    'module-user/components/Avatar':   typeof import('@org/module-user/components/Avatar')
  }
}
```

### `ModuleRegistry` 接口定义

```ts
// @maho/boot/interfaces/ModuleRegistry.ts

/**
 * 模块注册表，通过声明合并扩展。
 * key：'模块名/暴露路径'（去掉 ./ 前缀）
 * value：对应 npm 包导出的类型
 */
export interface ModuleRegistry {
  // 空接口，由 .maho/registry.d.ts 自动扩展
}
```

### `TypeService.syncRegistry` 实现

```ts
// @maho/core/services/type.ts

async function syncRegistry(projectRoot: string): Promise<void> {
  const packages = await scanMahoPackages(projectRoot)

  if (packages.length === 0) {
    // 没有 maho 包，生成空注册表
    await writeRegistry(projectRoot, [])
    return
  }

  const entries = packages.flatMap(pkg =>
    (pkg.maho.exposes as string[]).map(exposePath => ({
      // key：去掉 ./ 前缀，拼接模块名
      // './utils/formatters' → 'module-order/utils/formatters'
      key:        `${pkg.maho.name}${exposePath.slice(1)}`,
      // value：从 npm 包的 exports 路径导入
      importPath: `${pkg.name}${exposePath.slice(1)}`,
    }))
  )

  await writeRegistry(projectRoot, entries)
  ctx.emit('types:synced')
}

async function scanMahoPackages(
  projectRoot: string,
): Promise<PackageJson[]> {
  const nodeModules = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(nodeModules)) return []

  // 读取 lockfile 变更时间，避免每次冷启动全量扫描
  const lockfileChanged = await checkLockfileChanged(projectRoot)
  if (!lockfileChanged) {
    return readRegistryCache(projectRoot)
  }

  // 扫描所有 package.json，查找带 maho 字段的包
  const allPkgs = await globby('**/package.json', {
    cwd:   nodeModules,
    depth: 3,               // 避免扫描太深
    ignore: ['**/node_modules/**'],
  })

  const mahoPackages = (
    await Promise.all(
      allPkgs.map(async pkgPath => {
        const pkg = await readJson(path.join(nodeModules, pkgPath))
        return pkg.maho ? pkg : null
      })
    )
  ).filter(Boolean)

  await writeRegistryCache(projectRoot, mahoPackages)
  return mahoPackages
}

async function writeRegistry(
  projectRoot: string,
  entries: Array<{ key: string; importPath: string }>,
): Promise<void> {
  const lines = entries.map(
    ({ key, importPath }) =>
      `    '${key}': typeof import('${importPath}')`
  )

  const content = [
    '// 自动生成，请勿手动编辑',
    '// 由 @maho/core TypeService 在 dev/build 启动时生成',
    '',
    "import '@maho/boot'",
    '',
    "declare module '@maho/boot' {",
    '  interface ModuleRegistry {',
    ...lines,
    '  }',
    '}',
    '',
  ].join('\n')

  const outPath = path.join(projectRoot, '.maho', 'registry.d.ts')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, content, 'utf-8')
}
```

### 增量更新策略

```ts
// 通过对比 lockfile mtime 决定是否重新扫描
// 避免每次 dev 启动都全量扫描 node_modules

async function checkLockfileChanged(projectRoot: string): Promise<boolean> {
  const lockfiles = [
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
  ]

  for (const lf of lockfiles) {
    const lfPath = path.join(projectRoot, lf)
    if (!fs.existsSync(lfPath)) continue

    const lfMtime    = fs.statSync(lfPath).mtimeMs
    const cacheMtime = readCacheMtime(projectRoot)

    if (lfMtime > cacheMtime) {
      writeCacheMtime(projectRoot, lfMtime)
      return true   // lockfile 有变化，需要重新扫描
    }
    return false    // lockfile 未变化，使用缓存
  }

  return true  // 没有 lockfile，始终扫描
}
```

---

## `mf.load()` 类型推导

### `mf.load` 函数签名

```ts
// @maho/boot/core/federation.ts

/**
 * 运行时加载远程模块。
 * 有注册表映射时自动推导返回类型，无映射时退化为 any。
 */
export async function load<K extends string>(
  key: K
): Promise<
  K extends keyof ModuleRegistry
    ? ModuleRegistry[K]
    : any
>
```

### 类型推导效果

```ts
import { mf } from '@maho/boot-vue'

// ✅ 自动推导为 typeof import('@org/module-order/utils/formatters')
const { formatDate, formatPrice } = await mf.load('module-order/utils/formatters')
//       ^? (date: Date, locale?: string) => string
//                       ^? (amount: number, currency: string) => string

// ✅ 自动推导为组件类型
const OrderCard = await mf.load('module-order/components/OrderCard')
//    ^? DefineComponent<OrderCardProps, ...>

// ✅ 路由中使用
{
  path:      '/order',
  component: () => mf.load('module-order/pages/OrderList'),
  //               IDE 可跳转到子包源码定义
}

// ✅ 无注册表的路径：退化为 any，不报错
const unknown = await mf.load('some-unregistered/module')
//    ^? any
```

### IDE 跳转支持

`typeof import(...)` 形式的注册表映射支持 IDE「跳转到定义」——直接跳转到子包的 `.d.ts` 文件，再通过 source map 跳转到子包源码。

---

## `virtual:maho-config` 类型声明

### 自动生成文件

`@maho/vite-plugin` 在每次启动时写入 `.maho/virtual.d.ts`：

```ts
// .maho/virtual.d.ts（自动生成）

declare module 'virtual:maho-config' {
  import type { MahoStaticConfig } from '@maho/boot'
  const config: MahoStaticConfig
  export default config
}
```

### `MahoStaticConfig` 类型定义

```ts
// @maho/boot/interfaces/MahoStaticConfig.ts

export interface MahoStaticConfig {
  /** 当前包角色 */
  role: 'host' | 'remote'

  /** 当前运行 mode */
  mode: string

  /** 联邦配置（已根据 dev/prod 模式切换 URL） */
  federation: {
    remotes:     string[]
    manifestUrl: string | null
  }

  /**
   * inline 子包的路由（构建时静态收集）。
   * remote 子包的路由在 Boot 运行时通过 collectRoutes 动态加载。
   */
  inlineRoutes: MahoRoute[]

  /**
   * 共享依赖声明（由 boot-xxx 的 sharedDeps 导出，
   * Cordis 构建时读取并注入）
   */
  shared: Record<string, {
    singleton:       boolean
    requiredVersion: string
  }>
}
```

### 消费侧类型完整性

```ts
// Boot pipeline 内部
import mahoConfig from 'virtual:maho-config'
//     ^? MahoStaticConfig

mahoConfig.federation.remotes    // string[]
mahoConfig.inlineRoutes          // MahoRoute[]
mahoConfig.shared.vue            // { singleton: boolean; requiredVersion: string }
mahoConfig.mode                  // string
```

---

## `MahoRouteMeta` 类型扩展

### 扩展机制

`MahoRouteMeta` 通过声明合并扩展，业务字段在路由声明和拦截器中全程有类型推导：

```ts
// src/types/maho.d.ts（Host 项目中添加）
import '@maho/boot'

declare module '@maho/boot' {
  interface MahoRouteMeta {
    // 路由组件缓存
    keepAlive?: boolean

    // 页面切换动画
    transition?: 'fade' | 'slide-left' | 'slide-right' | false

    // 面包屑配置
    breadcrumb?: Array<{ label: string; path?: string }>

    // VIP 专属页面
    requiresVip?: boolean

    // 数据预加载策略
    prefetch?: 'eager' | 'visible' | 'idle' | false
  }
}
```

### 扩展后的类型效果

```ts
// apps/module-order/src/mf-routes.ts
export default defineModuleRoutes({
  routes: [
    {
      path: '/list',
      name: 'order-list',
      component: () => import('./pages/OrderList.vue'),
      meta: {
        layout:     'default',
        keepAlive:  true,          // ✅ 有类型
        transition: 'fade',        // ✅ 有类型
        breadcrumb: [              // ✅ 有类型
          { label: '首页', path: '/' },
          { label: '订单列表' },
        ],
        requiresVip: false,        // ✅ 有类型
      },
    },
  ],
})
```

```ts
// src/app.ts 拦截器中
interceptors: [
  async ({ to }) => {
    if (to.meta.requiresVip && !userStore.isVip) {
      //       ^? boolean | undefined  ✅ 有类型
      return '/upgrade'
    }
  },
]
```

---

## TypeService 实现

### 完整服务代码

```ts
// @maho/core/services/type.ts

class TypeService extends Service {
  static inject = ['config', 'mode'] as const

  /**
   * 构建时：为本包 exposes 生成 .d.ts
   * 由 BuildPipelineService 在 vite:built 后调用
   */
  async emitDeclarations(): Promise<void> {
    const exposes = this.ctx.config.resolved.exposes ?? []
    if (exposes.length === 0) {
      console.info('[Maho Types] No exposes declared, skipping declaration emit')
      return
    }

    console.info(`[Maho Types] Generating declarations for ${exposes.length} entries...`)

    await generateDts({
      include:      exposes.map(e => `src/${e.replace('./', '')}`),
      outDir:       'dist/types',
      rollupTypes:  true,
      strictOutput: true,
    })

    await syncPackageExports(exposes, this.ctx.config.resolved)
    this.ctx.emit('types:emitted')

    console.info('[Maho Types] Declarations generated successfully')
  }

  /**
   * dev/build 启动时：扫描已安装的 maho 包，生成类型注册表
   * 由 DevPipelineService / BuildPipelineService 最先调用
   */
  async syncRegistry(): Promise<void> {
    const projectRoot = process.cwd()
    const packages    = await scanMahoPackages(projectRoot)

    console.info(
      `[Maho Types] Found ${packages.length} maho packages, syncing registry...`
    )

    await writeRegistry(projectRoot, packages)
    await writeVirtualTypeDeclaration(projectRoot)
    this.ctx.emit('types:synced')
  }

  /**
   * 写入 virtual:maho-config 的类型声明文件
   */
  private async writeVirtualTypeDeclaration(projectRoot: string): Promise<void> {
    const content = [
      '// 自动生成，请勿手动编辑',
      '',
      "declare module 'virtual:maho-config' {",
      "  import type { MahoStaticConfig } from '@maho/boot'",
      '  const config: MahoStaticConfig',
      '  export default config',
      '}',
      '',
    ].join('\n')

    const outPath = path.join(projectRoot, '.maho', 'virtual.d.ts')
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, content, 'utf-8')
  }
}
```

---

## 版本漂移检测

### 问题描述

npm 包版本（类型来源）与 CDN 上的 `remoteEntry.js` 版本（运行时来源）可能不一致：

```
消费方安装了 @org/module-order@2.1.0
  → 类型基于 v2.1.0：formatDate(date, locale) 两个参数

但 manifest 指向的 remoteEntry 是 v2.0.0
  → 运行时实现：formatDate(date) 只有一个参数

结果：TypeScript 编译通过，运行时传入 locale 参数被忽略
```

### 检测机制

子包的 `mf-meta.ts` 声明类型版本，Boot 加载时进行比对：

```ts
// apps/module-order/src/mf-meta.ts
export default {
  name:         'module-order',
  version:      '2.1.0',
  // 与 npm 包版本保持一致，标识当前 remoteEntry 对应的类型版本
  typesVersion: '2.1.0',
  // Boot 最低兼容版本
  minBootVersion: '1.0.0',
}
```

```ts
// @maho/boot/core/federation.ts

async function validateRemoteVersion(
  remote:           RemoteModule,
  installedVersion: string | null,
): Promise<void> {

  try {
    const meta = await remote.load('./mf-meta')
    if (!meta?.default?.typesVersion) return

    const runtimeVersion = meta.default.typesVersion

    if (installedVersion && runtimeVersion !== installedVersion) {
      console.warn(
        `[Maho] Version mismatch for "${remote.name}":\n` +
        `  Installed npm types: ${installedVersion}\n` +
        `  Runtime remoteEntry: ${runtimeVersion}\n` +
        `  Run "npm update @org/${remote.name}" or update CDN deployment.`
      )
    }
  } catch {
    // mf-meta 不存在或加载失败，跳过版本检测
  }
}
```

### 获取已安装版本

```ts
// 从 node_modules 读取已安装的 npm 包版本
function getInstalledVersion(moduleName: string): string | null {
  // 通过 maho 字段中的 name 反查 npm 包名
  const mahoPackage = installedMahoPackages.find(
    p => p.maho?.name === moduleName
  )
  return mahoPackage?.version ?? null
}
```

### 检测触发时机

```
Boot 启动
  → loadFederation()
  → 每个 remote 加载完成后
  → 异步调用 validateRemoteVersion()（非阻塞，不影响启动速度）
  → 发现版本漂移时 console.warn
```

版本漂移警告只在 **dev 模式**下输出，生产环境静默（避免泄露内部版本信息）：

```ts
if (import.meta.env.DEV && runtimeVersion !== installedVersion) {
  console.warn(/* ... */)
}
```

---

## tsconfig 配置指南

### Host 项目 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target":           "ES2020",
    "module":           "ESNext",
    "moduleResolution": "Bundler",
    "strict":           true,
    "jsx":              "preserve",

    // 路径映射（可选，让 IDE 支持 mf.load 的跳转）
    "paths": {
      "virtual:maho-config": ["./.maho/virtual.d.ts"]
    }
  },
  "include": [
    "src",
    ".maho",       // registry.d.ts + virtual.d.ts 所在目录
    "plugins"      // 本地 TS 插件也纳入类型检查
  ]
}
```

### 子包 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target":           "ES2020",
    "module":           "ESNext",
    "moduleResolution": "Bundler",
    "strict":           true,
    "declaration":      true,          // 生成 .d.ts
    "declarationDir":   "dist/types",  // 输出目录
    "emitDeclarationOnly": false       // 由 vite-plugin-dts 负责生成
  },
  "include": ["src"]
}
```

### Monorepo 根 `tsconfig.json`

```json
{
  "references": [
    { "path": "./apps/module-order" },
    { "path": "./apps/module-user" }
  ],
  "files": []
}
```

---

## 完整类型链路示意

```
子包源码
  src/utils/formatters.ts
    export function formatDate(date: Date, locale?: string): string
    export function formatPrice(amount: number, currency: string): string

       ↓ maho build（TypeService.emitDeclarations）

子包产物
  dist/types/utils/formatters.d.ts
    export declare function formatDate(date: Date, locale?: string): string
    export declare function formatPrice(amount: number, currency: string): string

  package.json
    "maho": { "name": "module-order", "exposes": ["./utils/formatters", ...] }
    "exports": { "./utils/formatters": { "types": "...", "import": "..." } }

       ↓ npm publish → 消费方 npm install
       ↓ TypeService.syncRegistry()

.maho/registry.d.ts
  declare module '@maho/boot' {
    interface ModuleRegistry {
      'module-order/utils/formatters': typeof import('@org/module-order/utils/formatters')
    }
  }

       ↓ TypeScript 查找 ModuleRegistry

消费方代码
  const { formatDate } = await mf.load('module-order/utils/formatters')
  //       ^? (date: Date, locale?: string) => string  ✅ 完整类型
```

---

*下一篇：[design-cli.md](./design-cli.md) — 命令设计、模板系统、工作区结构、进程管理*
