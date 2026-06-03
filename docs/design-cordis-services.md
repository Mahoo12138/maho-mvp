# Maho Cordis 服务体系详细设计

> 本文档涵盖：Cordis 在 Maho 中的定位、服务地图与职责、服务依赖图、事件时序、插件 API、`MFContext` 类型扩展。

---

## 目录

1. [Cordis 在 Maho 中的定位](#cordis-在-maho-中的定位)
2. [服务地图](#服务地图)
3. [服务依赖图](#服务依赖图)
4. [各服务详细设计](#各服务详细设计)
5. [事件时序](#事件时序)
6. [插件 API](#插件-api)
7. [MFContext 类型扩展](#mfcontext-类型扩展)
8. [内置插件清单](#内置插件清单)

---

## Cordis 在 Maho 中的定位

### 边界约定

```
构建侧（Node.js）          运行时（Browser）
─────────────────          ─────────────────
Cordis Context             @maho/boot
  所有 Service               runBootPipeline
  Plugin Runner              BootAdapter
  事件系统                   路由合并算法
         │
         │ virtual:maho-config（单向数据流）
         ▼
       Vite 构建产物
```

Cordis 仅运行在 Node.js 侧，负责管理从「读取配置」到「输出构建产物」的全部构建期逻辑。它通过 `virtual:maho-config` 虚拟模块向 Boot 传递静态配置，两侧在运行时没有任何耦合。

### 选用 Cordis 的理由

- **服务 IoC**：内部模块（路由合并器、manifest 解析器等）通过容器注册，用户可替换任意实现
- **插件平权**：官方插件与用户插件使用完全相同的 `apply(ctx)` API
- **生命周期管理**：`dispose()` 自动清理所有副作用，dev 模式下服务重启无需手动清理
- **声明式依赖**：`static inject` 驱动自动初始化顺序，无需手写启动序列

---

## 服务地图

```
基础层（无依赖，最先初始化）
  ConfigService        解析 config/ 目录，管理多层配置合并
  ModeService          当前运行 mode（dev / build / 自定义）
  WatchService         文件变更监听，驱动热更新

核心层（依赖基础层）
  ViteService          管理 Vite dev server 或 build 进程
  RouteService         路由声明收集与合并（内置 RouteMerger）
  FederationService    remote 加载、manifest 解析与管理
  TypeService          .d.ts 生成与跨模块类型注册表

流水线层（依赖核心层，编排执行顺序）
  DevPipelineService   编排 dev 全流程
  BuildPipelineService 编排 build 全流程

可选层（按需加载，不影响核心）
  DevtoolsService      WebSocket 推送，Devtools 页面通信（V2）
  AppsService          管理 apps/* 子包进程（CLI dev 命令用）
```

---

## 服务依赖图

```
ConfigService ──────────────────────────────┐
ModeService   ──────────────────────────────┤
                                            │
WatchService  (inject: config)              │
    │                                       │
    │  config:changed 事件                  │
    ▼                                       ▼
FederationService  (inject: config)     ViteService  (inject: config, mode)
RouteService       (inject: config,     TypeService  (inject: config, federation)
                           federation)
    │                   │                   │
    └───────────────────┴───────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
  DevPipelineService      BuildPipelineService
  (inject: 以上全部)      (inject: 以上全部)
```

Cordis 根据 `static inject` 声明自动推导初始化顺序——声明了依赖的服务会等待被依赖的服务就绪后才激活，无需手写启动序列。

---

## 各服务详细设计

### ConfigService

```ts
// @maho/core/services/config.ts

class ConfigService extends Service {
  static inject = []   // 无依赖，第一批初始化

  // 三份独立数据，职责分离
  base:     ParsedConfig        // config/config.yml 原始内容
  current:  ParsedConfig        // config/config.{mode}.yml 原始内容
  resolved: ResolvedMFConfig    // deepMerge(base, current)，只读

  async load(mode: string) {
    const configDir = this.findConfigDir()

    this.base    = await loadYaml(path.join(configDir, 'config.yml'))
    this.current = await loadYaml(
      path.join(configDir, `config.${mode}.yml`)
    ).catch(() => ({}))

    this.recompute()
    this.ctx.emit('config:ready', this.resolved)
  }

  // Devtools 回写：Base 层
  async updateBase(patch: DeepPartial<MFConfig>) {
    this.base = deepMerge(this.base, patch)
    await writeYaml('config/config.yml', this.base)
    this.recompute()
    this.ctx.emit('config:base-changed', this.base)
  }

  // Devtools 回写：Current 层
  async updateCurrent(patch: DeepPartial<MFConfig>) {
    this.current = deepMerge(this.current, patch)
    await writeYaml(`config/config.${this.ctx.mode.current}.yml`, this.current)
    this.recompute()
    this.ctx.emit('config:current-changed', this.current)
  }

  // 清除 Current 层某字段，让 Base 值透出
  async clearCurrentField(keyPath: string) {
    deleteByPath(this.current, keyPath)
    await writeYaml(`config/config.${this.ctx.mode.current}.yml`, this.current)
    this.recompute()
  }

  private recompute() {
    this.resolved = deepMerge(this.base, this.current) as ResolvedMFConfig
    this.ctx.emit('config:resolved', this.resolved)
  }

  private findConfigDir(): string {
    // 向上查找包含 config/config.yml 的目录
    let dir = process.cwd()
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'config', 'config.yml'))) return dir
      dir = path.dirname(dir)
    }
    throw new Error('[Maho] config/config.yml not found')
  }
}
```

### ModeService

```ts
// @maho/core/services/mode.ts

class ModeService extends Service {
  static inject = []

  // 从 CLI 参数读取，默认值由命令决定（dev → 'dev'，build → 'prod'）
  readonly current: string

  constructor(ctx: MFContext, mode: string) {
    super(ctx, 'mode')
    this.current = mode
  }

  get isDev()   { return this.current === 'dev'  }
  get isProd()  { return this.current === 'prod' }
}
```

### WatchService

```ts
// @maho/core/services/watch.ts

class WatchService extends Service {
  static inject = ['config'] as const

  private watcher: FSWatcher | null = null

  async start() {
    const configDir = path.join(process.cwd(), 'config')

    this.watcher = chokidar.watch([
      configDir,
      'apps/*/config',    // 子包配置目录
    ], { ignoreInitial: true })

    this.watcher.on('change', (filePath) => this.onFileChange(filePath))

    // 注册 dispose，服务停止时自动关闭 watcher
    this.ctx.on(Context.dispose, () => this.watcher?.close())
  }

  private async onFileChange(filePath: string) {
    if (filePath.includes('config/config')) {
      // 重新读取对应 config 文件
      const mode    = this.ctx.mode.current
      const isBase  = !filePath.includes(`.${mode}.`)

      if (isBase) {
        this.ctx.config.base = await loadYaml(filePath)
      } else {
        this.ctx.config.current = await loadYaml(filePath)
      }

      this.ctx.config.recompute()
      this.ctx.emit('config:changed', { filePath, isBase })
    }
  }
}
```

### FederationService

```ts
// @maho/core/services/federation.ts

class FederationService extends Service {
  static inject = ['config'] as const

  // 当前已解析的 remote 列表（dev 时指向 localhost，prod 时指向 CDN）
  remotes: ResolvedRemote[] = []

  async resolve() {
    const { remotes, manifestUrl } = this.ctx.config.resolved.federation
    const isDev = this.ctx.mode.isDev

    // 静态 remotes
    let resolved: ResolvedRemote[] = remotes.map(url => ({
      url,
      source: 'static' as const,
    }))

    // 动态 manifest 覆盖（同名 remote 动态优先）
    if (manifestUrl) {
      const manifest = await fetchManifest(manifestUrl)
      for (const entry of manifest.remotes) {
        const idx = resolved.findIndex(r => r.name === entry.name)
        if (idx >= 0) resolved[idx] = { ...entry, source: 'manifest' }
        else resolved.push({ ...entry, source: 'manifest' })
      }
    }

    // dev 模式：用 apps/* 的本地 dev server 地址覆盖
    if (isDev) {
      resolved = this.applyDevOverrides(resolved)
    }

    this.remotes = resolved
    this.ctx.emit('federation:resolved', resolved)
  }

  private applyDevOverrides(remotes: ResolvedRemote[]): ResolvedRemote[] {
    const overrides = this.ctx.config.resolved.federation.dev?.overrides ?? {}
    return remotes.map(r =>
      overrides[r.name]
        ? { ...r, url: overrides[r.name], source: 'dev-override' as const }
        : r
    )
  }
}
```

### RouteService

```ts
// @maho/core/services/route.ts

class RouteService extends Service {
  static inject = ['config', 'federation'] as const

  // 合并后的路由表（用于生成 virtual:maho-config 的 inlineRoutes）
  mergedRoutes: MahoRoute[] = []

  // 可通过 IoC 替换的路由合并器
  private merger: RouteMerger

  constructor(ctx: MFContext) {
    super(ctx, 'routes')
    // 默认使用内置合并器，用户可通过插件替换
    this.merger = ctx.container.resolve('route-merger')
  }

  async collect() {
    const configs = await this.scanInlineModules()
    this.mergedRoutes = this.merger.merge(configs)
    this.ctx.emit('routes:merged', this.mergedRoutes)
    return this.mergedRoutes
  }

  // 扫描 apps/* 的路由声明（构建时静态扫描，用于 inline 模块）
  private async scanInlineModules(): Promise<ModuleRoutesConfig[]> {
    const appsDir = path.join(process.cwd(), 'apps')
    if (!fs.existsSync(appsDir)) return []

    const modules = fs.readdirSync(appsDir)
    return Promise.all(
      modules.map(async (name) => {
        const routesFile = path.join(appsDir, name, 'src', 'mf-routes.ts')
        if (!fs.existsSync(routesFile)) return null
        const mod = await importFresh(routesFile)
        return { name, ...mod.default }
      })
    ).then(results => results.filter(Boolean))
  }
}
```

### ViteService

```ts
// @maho/core/services/vite.ts

class ViteService extends Service {
  static inject = ['config', 'mode'] as const

  private server:    ViteDevServer | null = null
  private buildDone: boolean = false

  // 构建最终的 Vite 配置
  async buildViteConfig(): Promise<UserConfig> {
    // 1. 框架生成基础配置
    let config = generateBaseViteConfig(this.ctx.config.resolved)

    // 2. 触发 vite:config hook，让所有插件追加配置
    config = await this.ctx.serial('vite:config', config)

    // 3. 用户 vite.extend() 最后追加（优先级最高）
    const extend = this.ctx.config.resolved.vite?.extend
    if (extend) config = mergeConfig(config, extend(config))

    return config
  }

  async startDevServer() {
    const viteConfig = await this.buildViteConfig()
    this.server = await createViteServer(viteConfig)
    await this.server.listen()

    this.ctx.emit('vite:configured', viteConfig)
    this.ctx.emit('server:ready', {
      url: this.server.resolvedUrls?.local?.[0],
    })

    // dispose 时关闭 dev server
    this.ctx.on(Context.dispose, () => this.server?.close())
  }

  async build() {
    const viteConfig = await this.buildViteConfig()
    await viteBuild(viteConfig)
    this.buildDone = true
    this.ctx.emit('vite:built')
  }

  async restart() {
    await this.server?.restart()
    this.ctx.emit('server:restarted')
  }
}
```

### TypeService

```ts
// @maho/core/services/type.ts

class TypeService extends Service {
  static inject = ['config', 'federation'] as const

  // 生成本包 exposes 的 .d.ts（子包发布时用）
  async emitDeclarations() {
    const exposes = this.ctx.config.resolved.exposes ?? {}
    await generateDts({
      entries:  Object.values(exposes),
      outDir:   'dist/types',
      rollup:   true,    // 展开内部路径别名
    })
    this.ctx.emit('types:emitted')
  }

  // 扫描 node_modules 中的 maho 包，生成跨模块类型注册表
  async syncRegistry() {
    const packages = await scanMahoPackages(process.cwd())

    const lines = packages.flatMap(pkg =>
      (pkg.maho?.exposes ?? []).map((exposePath: string) => {
        const key = `${pkg.maho.name}${exposePath.slice(1)}`
        return `    '${key}': typeof import('${pkg.name}${exposePath.slice(1)}')`
      })
    )

    const content = [
      '// 自动生成，请勿手动编辑',
      "declare module '@maho/boot' {",
      '  interface ModuleRegistry {',
      ...lines,
      '  }',
      '}',
    ].join('\n')

    await fs.writeFile('.maho/registry.d.ts', content)
    this.ctx.emit('types:synced')
  }
}
```

### DevPipelineService

```ts
// @maho/core/pipelines/dev.ts

class DevPipelineService extends Service {
  static inject = ['config', 'mode', 'vite', 'routes', 'federation', 'watch'] as const

  async start() {
    // 按依赖顺序启动
    await this.ctx.federation.resolve()
    await this.ctx.routes.collect()
    await this.ctx.vite.startDevServer()

    // 注册热更新响应
    this.ctx.on('config:changed',        () => this.onConfigChange())
    this.ctx.on('routes:invalidated',    () => this.ctx.routes.collect())
    this.ctx.on('federation:changed',    () => this.onFederationChange())

    this.ctx.emit('dev:ready')
  }

  private async onConfigChange() {
    // 精确判断哪些服务需要重新执行
    const changed = this.ctx.config.resolved

    if (this.federationChanged(changed)) {
      await this.ctx.federation.resolve()
    }
    if (this.routesChanged(changed)) {
      await this.ctx.routes.collect()
    }
    if (this.viteConfigChanged(changed)) {
      await this.ctx.vite.restart()
    }

    this.ctx.emit('manifest:updated')
  }

  private async onFederationChange() {
    await this.ctx.routes.collect()
    this.ctx.emit('manifest:updated')
  }

  private federationChanged(config: ResolvedMFConfig) {
    // 对比前后 resolved 中 federation 字段是否变化
    return JSON.stringify(config.federation) !==
           JSON.stringify(this.lastResolved?.federation)
  }
}
```

### BuildPipelineService

```ts
// @maho/core/pipelines/build.ts

class BuildPipelineService extends Service {
  static inject = ['config', 'vite', 'routes', 'federation', 'types'] as const

  async run() {
    // 有明确先后顺序的构建流水线
    await this.ctx.types.syncRegistry()     // 同步消费方类型注册表
    await this.ctx.federation.resolve()     // 解析 remote 列表
    await this.ctx.routes.collect()         // 收集路由（用于 virtual:maho-config）
    await this.ctx.vite.build()             // Vite 构建
    await this.ctx.types.emitDeclarations() // 生成本包 .d.ts
    await this.writeManifest()              // 写 federation manifest

    this.ctx.emit('build:done', {
      duration: Date.now() - this.startTime,
    })
  }

  private async writeManifest() {
    const manifest = {
      version: new Date().toISOString(),
      remotes: this.ctx.federation.remotes.map(r => ({
        name:      r.name,
        entry:     r.url,
        integrity: r.integrity,
      })),
    }
    await fs.writeFile('dist/mf-manifest.json', JSON.stringify(manifest, null, 2))
    this.ctx.emit('manifest:written', manifest)
  }
}
```

---

## 事件时序

### Dev 模式完整时序

```
CLI 解析参数，创建 MFContext
  │
  ├─ ConfigService.load(mode)
  │     → config:ready
  │
  ├─ WatchService.start()
  │
  ├─ DevPipelineService.start()
  │     ├─ FederationService.resolve()
  │     │     → federation:resolved
  │     │
  │     ├─ RouteService.collect()
  │     │     → routes:merged
  │     │
  │     └─ ViteService.startDevServer()
  │           → vite:configured
  │           → server:ready
  │
  └─ → dev:ready（所有服务就绪，打印本地访问地址）

── 开发中 ──────────────────────────────────────────

config/ 文件变更
  WatchService → config:changed
    DevPipelineService.onConfigChange()
      → 按需重启 federation / routes / vite
      → manifest:updated

apps/*/src/mf-routes.ts 变更
  WatchService → routes:invalidated
    RouteService.collect()
      → routes:merged
      → manifest:updated
```

### Build 模式完整时序

```
CLI 创建 MFContext（mode = 'prod' 或自定义）
  │
  ├─ ConfigService.load(mode)
  │     → config:ready
  │
  └─ BuildPipelineService.run()
        ├─ TypeService.syncRegistry()
        │     → types:synced
        │
        ├─ FederationService.resolve()
        │     → federation:resolved
        │
        ├─ RouteService.collect()
        │     → routes:merged
        │
        ├─ ViteService.build()
        │     → vite:built
        │
        ├─ TypeService.emitDeclarations()
        │     → types:emitted
        │
        └─ BuildPipelineService.writeManifest()
              → manifest:written
              → build:done
```

### 事件全表

| 事件名 | 触发时机 | 携带数据 |
|---|---|---|
| `config:ready` | 配置首次加载完成 | `ResolvedMFConfig` |
| `config:resolved` | 任意配置变更后重新合并 | `ResolvedMFConfig` |
| `config:base-changed` | Base 层被 Devtools 修改 | `ParsedConfig` |
| `config:current-changed` | Current 层被 Devtools 修改 | `ParsedConfig` |
| `config:changed` | 配置文件被手动编辑 | `{ filePath, isBase }` |
| `federation:resolved` | remote 列表解析完成 | `ResolvedRemote[]` |
| `federation:changed` | remote 列表发生变化 | `ResolvedRemote[]` |
| `routes:merged` | 路由合并完成 | `MahoRoute[]` |
| `routes:invalidated` | 路由声明文件变更，需重新收集 | `string`（文件路径） |
| `vite:config` | Vite 配置生成前（可修改）| `UserConfig`（串行 hook）|
| `vite:configured` | Vite 配置最终确定 | `UserConfig` |
| `server:ready` | Dev server 启动完成 | `{ url: string }` |
| `server:restarted` | Dev server 重启完成 | — |
| `vite:built` | Vite build 完成 | — |
| `types:synced` | 类型注册表生成完成 | — |
| `types:emitted` | .d.ts 文件输出完成 | — |
| `manifest:updated` | Dev 模式 manifest 更新 | — |
| `manifest:written` | Build 模式 manifest 写入 | `FederationManifest` |
| `dev:ready` | 所有服务就绪 | — |
| `build:done` | 构建全部完成 | `{ duration: number }` |

---

## 插件 API

### 插件格式

Maho 插件是标准 Cordis 插件，有两种写法：

```ts
// 写法一：函数式（推荐，适合简单插件）
export function myPlugin(ctx: MFContext, options: MyOptions) {
  ctx.on('routes:merged', (routes) => { /* ... */ })
  ctx.on('vite:config',   (config) => { /* ... */ })
}
myPlugin.inject = ['config'] as const   // 声明依赖（可选）

// 写法二：类式（适合有状态的复杂插件）
export class MyPlugin {
  static inject = ['config', 'routes'] as const

  constructor(ctx: MFContext, options: MyOptions) {
    ctx.on('build:done', () => this.onBuildDone())
  }

  private onBuildDone() { /* ... */ }
}
```

在 `config.yml` 中引用：

```yaml
plugins:
  - use: "@org/maho-plugin-my"
    with:
      option1: value1
      option2: value2

  - use: "./plugins/local-plugin"   # 本地 TS 文件
```

### Hook 类型

`vite:config` 是唯一的**串行（serial）hook**，其余均为**并行（parallel）事件**：

```ts
// 串行 hook：可修改传入值，返回修改后的配置
ctx.on('vite:config', (config: UserConfig) => {
  config.build ??= {}
  config.build.target = 'es2020'
  return config    // 必须返回修改后的对象
})

// 并行事件：只监听，不修改
ctx.on('routes:merged', (routes: MahoRoute[]) => {
  console.log(`[MyPlugin] ${routes.length} routes merged`)
})

// 异步事件监听
ctx.on('build:done', async ({ duration }) => {
  await notifySlack(`Build completed in ${duration}ms`)
})
```

### IoC 替换内部模块

插件可以替换框架内部的任意可注册模块：

```ts
// 替换路由合并器
export function customMergerPlugin(ctx: MFContext) {
  // 直接覆盖 IoC 容器中的注册
  ctx.container.register('route-merger', new MyCustomRouteMerger())
}

// 替换 manifest 解析器
export function customManifestPlugin(ctx: MFContext) {
  ctx.container.register('manifest-resolver', new MyManifestResolver())
}
```

### 可替换的内置模块

| 注册 key | 默认实现 | 用途 |
|---|---|---|
| `route-merger` | `DefaultRouteMerger` | 路由合并算法 |
| `manifest-resolver` | `DefaultManifestResolver` | federation manifest 解析 |
| `layout-resolver` | `DefaultLayoutResolver` | 布局组件解析 |
| `type-generator` | `DefaultTypeGenerator` | .d.ts 生成器 |
| `yaml-loader` | `DefaultYamlLoader` | YAML 文件读取与解析 |

### 扩展配置 Schema

插件可以通过 TypeScript 声明合并扩展 `MFConfig`，让用户在 `config.yml` 中填写插件自定义配置时获得类型提示：

```ts
// 在插件包的类型声明文件中
declare module '@maho/core' {
  interface MFConfig {
    myPlugin?: {
      apiKey: string
      endpoint: string
    }
  }
}
```

用户 `config.yml`：

```yaml
myPlugin:
  apiKey: !env MY_PLUGIN_API_KEY
  endpoint: "https://api.example.com"
```

插件内读取：

```ts
export function myPlugin(ctx: MFContext) {
  const { apiKey, endpoint } = ctx.config.resolved.myPlugin ?? {}
  // 有完整类型推导
}
```

### 完整插件示例

以「构建完成后上传产物到 OSS」为例：

```ts
// plugins/upload-oss.ts
import type { MFContext } from '@maho/core'

declare module '@maho/core' {
  interface MFConfig {
    oss?: {
      bucket:    string
      region:    string
      prefix?:   string
    }
  }
}

export const name = 'upload-oss'

export function apply(ctx: MFContext) {
  // 只在 build 模式生效
  if (!ctx.mode.isProd) return

  ctx.on('build:done', async () => {
    const { bucket, region, prefix = '' } = ctx.config.resolved.oss ?? {}
    if (!bucket) return

    console.log('[OSS] Uploading dist/ ...')
    await uploadToOss({
      dir:    'dist',
      bucket,
      region,
      prefix,
      accessKey: process.env.OSS_ACCESS_KEY!,
      secretKey: process.env.OSS_SECRET_KEY!,
    })
    console.log('[OSS] Upload complete.')
  })
}
```

```yaml
# config/config.prod.yml
oss:
  bucket: "my-app-assets"
  region: "cn-hangzhou"
  prefix: "maho-app/"

plugins:
  - use: "./plugins/upload-oss"
```

---

## MFContext 类型扩展

`MFContext` 继承自 Cordis `Context`，通过声明合并在其上注册所有服务的类型：

```ts
// @maho/core/context.ts

import { Context } from 'cordis'

export class MFContext extends Context {}

// 声明合并：让 ctx.xxx 有完整类型推导
declare module 'cordis' {
  interface Context {
    // 基础层服务
    config:     ConfigService
    mode:       ModeService
    watch:      WatchService

    // 核心层服务
    vite:       ViteService
    routes:     RouteService
    federation: FederationService
    types:      TypeService

    // 流水线层服务
    devPipeline:   DevPipelineService
    buildPipeline: BuildPipelineService

    // IoC 容器（用于替换内部模块）
    container:  ServiceContainer
  }
}
```

用户写插件时访问 `ctx.config.resolved`、`ctx.routes.mergedRoutes` 等均有完整类型补全，与访问本地变量没有区别。

---

## 内置插件清单

Maho 的官方能力全部以内置插件形式实现，与用户插件使用相同 API：

| 插件 | 包 | 职责 |
|---|---|---|
| `mf-federation` | `@maho/core` | 联邦 manifest 解析，`remoteEntry` URL 管理 |
| `mf-router` | `@maho/core` | 路由声明扫描，`virtual:maho-config` 中 `inlineRoutes` 生成 |
| `mf-types` | `@maho/core` | `.d.ts` 生成，类型注册表维护 |
| `mf-vite-bridge` | `@maho/vite-plugin` | Vite 配置生成，虚拟模块注册，CSS Modules 强制 |
| `mf-loading` | `@maho/vite-plugin` | HTML 模板注入全局 Loading |
| `mf-shared-deps` | `@maho/vite-plugin` | 从 boot-xxx 读取共享依赖声明，注入 federation 配置 |
| `mf-devtools` | `@maho/devtools` | WebSocket 服务，状态推送（V2）|

---

*下一篇：[design-config-system.md](./design-config-system.md) — YAML 配置、多 mode 合并、Devtools 回写闭环*
