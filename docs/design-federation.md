# Maho 模块联邦详细设计

> 本文档涵盖：remoteEntry 协议、`mf-meta.ts` 自描述、federation manifest 管理、共享依赖策略、运行时加载机制、构建配置生成。

---

## 目录

1. [整体模型](#整体模型)
2. [remoteEntry 协议](#remoteentry-协议)
3. [mf-meta.ts 自描述](#mf-metats-自描述)
4. [Federation Manifest](#federation-manifest)
5. [共享依赖策略](#共享依赖策略)
6. [运行时加载机制](#运行时加载机制)
7. [构建配置生成](#构建配置生成)
8. [FederationService 实现](#federationservice-实现)
9. [dev 模式联邦](#dev-模式联邦)

---

## 整体模型

```
子包构建
  └── remoteEntry.js（部署至 CDN）
        ├── ./mf-meta      自描述（版本、兼容性）
        ├── ./mf-routes    路由声明
        └── ./pages/xxx    业务模块（按需加载）

父包运行时（Boot）
  └── loadFederation()
        ├── 读取 virtual:maho-config 中的 remotes 列表
        ├── 可选：拉取动态 manifest 并与静态列表合并
        ├── 并行加载所有 remoteEntry.js
        └── 返回 RemoteModule[] 供路由收集使用

共享依赖
  └── 由 @maho/boot-vue（或对应适配包）统一声明
        ↓ Cordis 构建时读取
        ↓ 注入到父包和所有子包的 Vite federation 配置
        ↓ 运行时保证 vue / vue-router / pinia 全局单例
```

---

## remoteEntry 协议

### 约定出口

每个参与联邦的子包必须暴露以下固定出口：

| 出口路径 | 类型 | 必须 | 说明 |
|---|---|---|---|
| `./mf-meta` | `MFMeta` | ✅ | 模块自描述，版本、兼容性声明 |
| `./mf-routes` | `ModuleRoutesConfig` | 可选 | 路由声明，无路由的工具包可不暴露 |
| `./pages/*` | Component | 按需 | 业务页面，与 mf-routes 中 component 对应 |
| `./components/*` | Component | 按需 | 可复用组件，供其他模块消费 |
| `./utils/*` | any | 按需 | 工具函数库 |
| `./layouts/*` | Component | 按需 | 布局组件（供 Host 的 layouts 配置引用） |

框架约定的 `./mf-meta` 和 `./mf-routes` 由 `@maho/vite-plugin` 在构建时自动追加到 `exposes`，子包无需手动声明。

### `exposes` 自动生成

```ts
// @maho/vite-plugin 内部

function resolveExposes(config: ResolvedMFConfig): Record<string, string> {
  const userExposes: Record<string, string> = {}

  // 用户在 config.yml 中声明的 exposes
  for (const exposePath of config.exposes ?? []) {
    // './pages/OrderList' → { './pages/OrderList': './src/pages/OrderList' }
    const key = exposePath
    const src  = `./src/${exposePath.replace('./', '')}`
    userExposes[key] = src
  }

  // 框架强制追加的固定出口
  return {
    ...userExposes,
    './mf-meta':   './src/mf-meta.ts',    // 必须存在
    './mf-routes': './src/mf-routes.ts',  // 不存在时静默跳过
  }
}
```

---

## `mf-meta.ts` 自描述

### 格式定义

```ts
// @maho/boot/interfaces/MFMeta.ts

export interface MFMeta {
  /** 模块唯一标识，与 config.yml 中的 name 一致 */
  name: string

  /** 当前 remoteEntry 的版本（SemVer） */
  version: string

  /**
   * 与 npm 包类型版本对齐。
   * boot 在运行时对比已安装 npm 包版本，不一致时发出警告。
   */
  typesVersion: string

  /**
   * 声明本模块兼容的最低 @maho/boot 版本。
   * boot 加载时检查，不兼容则跳过该模块并报错。
   */
  minBootVersion: string

  /** 模块描述（可选，供 Devtools 展示） */
  description?: string
}
```

### 子包中的实现

```ts
// apps/module-order/src/mf-meta.ts
import { defineMFMeta } from '@maho/boot'

export default defineMFMeta({
  name:           'module-order',
  version:        '2.1.0',
  typesVersion:   '2.1.0',
  minBootVersion: '1.0.0',
  description:    '订单管理模块',
})
```

`defineMFMeta` 是一个纯类型辅助函数，运行时直接返回传入的对象：

```ts
// @maho/boot/helpers/defineMFMeta.ts
export function defineMFMeta(meta: MFMeta): MFMeta {
  return meta
}
```

### 版本兼容性检测

Boot 加载每个 remote 后，异步检测版本兼容性（不阻塞路由收集）：

```ts
// @maho/boot/core/federation.ts

async function validateRemote(remote: RemoteModule): Promise<void> {
  let meta: MFMeta | null = null

  try {
    const mod = await remote.load('./mf-meta')
    meta = mod?.default ?? null
  } catch {
    // mf-meta 不存在，跳过检测
    return
  }

  if (!meta) return

  // 1. Boot 版本兼容性检测
  const bootVersion = MAHO_BOOT_VERSION   // 由构建时注入
  if (meta.minBootVersion && !satisfies(bootVersion, `>=${meta.minBootVersion}`)) {
    console.error(
      `[Maho] Remote "${meta.name}" requires @maho/boot >= ${meta.minBootVersion}, ` +
      `but current version is ${bootVersion}. Module will be skipped.`
    )
    return
  }

  // 2. 类型版本漂移检测（仅 dev 模式）
  if (import.meta.env.DEV) {
    const installedVer = getInstalledNpmVersion(meta.name)
    if (installedVer && meta.typesVersion !== installedVer) {
      console.warn(
        `[Maho] Type mismatch for "${meta.name}":\n` +
        `  Installed npm types : ${installedVer}\n` +
        `  Runtime remoteEntry : ${meta.typesVersion}\n` +
        `  → Run "npm update @org/${meta.name}" or redeploy the CDN bundle.`
      )
    }
  }
}
```

---

## Federation Manifest

### 静态配置与动态 Manifest 的关系

```
config.yml federation.remotes[]    →  静态配置（提交到 git，稳定）
config.yml federation.manifestUrl  →  动态 manifest URL（可选）
                                         ↓ 运行时拉取
                                    manifest.json
                                         ↓ 同名条目优先级高于静态配置
                                    最终 remotes 列表
```

动态 Manifest 的典型使用场景：多团队独立发布子包，各团队只需更新中心 Manifest 服务，父包无需重新构建即可接收新版本。

### Manifest 格式

```json
{
  "version": "2025-01-15T08:30:00Z",
  "remotes": [
    {
      "name":      "module-order",
      "entry":     "https://cdn.org.com/module-order/v2.1.0/remoteEntry.js",
      "integrity": "sha384-abc123...",
      "meta": {
        "version":      "2.1.0",
        "typesVersion": "2.1.0"
      }
    },
    {
      "name":      "module-user",
      "entry":     "https://cdn.org.com/module-user/v1.4.2/remoteEntry.js",
      "integrity": "sha384-def456..."
    }
  ]
}
```

### Manifest 解析与合并

```ts
// @maho/boot/core/federation.ts

async function resolveManifest(
  config: FederationConfig,
): Promise<ResolvedRemote[]> {

  // Step 1：静态 remotes 转换为 ResolvedRemote
  const staticRemotes: ResolvedRemote[] = config.remotes.map(entry => {
    if (typeof entry === 'string') {
      // 纯 URL：name 从 remoteEntry.js 加载后从 mf-meta 读取
      return { url: entry, source: 'static' as const }
    }
    return { ...entry, source: 'static' as const }
  })

  // Step 2：拉取动态 manifest（如果配置了 manifestUrl）
  if (!config.manifestUrl) return staticRemotes

  let dynamicRemotes: ResolvedRemote[] = []
  try {
    const resp     = await fetch(config.manifestUrl, {
      signal: AbortSignal.timeout(5000),   // 5s 超时
    })
    const manifest: FederationManifest = await resp.json()
    dynamicRemotes = manifest.remotes.map(r => ({
      ...r,
      source: 'manifest' as const,
    }))
  } catch (err) {
    // manifest 拉取失败：降级使用静态配置，warn 提示
    console.warn(
      `[Maho] Failed to fetch manifest from "${config.manifestUrl}". ` +
      `Falling back to static remotes.\n${err}`
    )
    return staticRemotes
  }

  // Step 3：合并（动态 manifest 中同名条目覆盖静态配置）
  const merged = [...staticRemotes]
  for (const dynamic of dynamicRemotes) {
    const idx = merged.findIndex(s => s.name === dynamic.name)
    if (idx >= 0) {
      merged[idx] = dynamic   // 覆盖
    } else {
      merged.push(dynamic)    // 追加新 remote
    }
  }

  return merged
}
```

### Manifest 的构建时写入

子包构建完成后，`BuildPipelineService` 将 manifest 写入 `dist/` 目录，供父包的 `manifestUrl` 引用：

```ts
// @maho/core/pipelines/build.ts

async function writeManifest(
  config:  ResolvedMFConfig,
  outDir:  string = 'dist',
): Promise<void> {

  const manifest: FederationManifest = {
    version: new Date().toISOString(),
    remotes: [{
      name:    config.name!,
      entry:   `${config.cdn?.baseUrl ?? ''}/${outDir}/remoteEntry.js`,
      meta: {
        version:      config.version,
        typesVersion: config.version,
      },
    }],
  }

  const manifestPath = path.join(outDir, 'mf-manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  console.info(`[Maho] Manifest written to ${manifestPath}`)
}
```

---

## 共享依赖策略

### 设计决策

子包开发者**不需要声明任何共享依赖**。框架基础依赖（vue、react、router、store 等）由 `@maho/boot-vue` / `@maho/boot-react` 统一声明，`@maho/vite-plugin` 在构建时自动读取并注入到父包和所有子包的 federation 配置中。

### `boot-vue` 共享依赖声明

```ts
// @maho/boot-vue/index.ts

/**
 * Vue 生态的共享依赖声明。
 * @maho/vite-plugin 在生成 federation 配置时读取此导出。
 * 父包和所有子包构建时会自动获得这些共享依赖声明。
 */
export const sharedDeps: SharedDepsMap = {
  'vue': {
    singleton:       true,
    requiredVersion: '^3.4.0',
    // eager: true 表示同步预加载，避免 chunk 分割导致的异步问题
    eager:           true,
  },
  'vue-router': {
    singleton:       true,
    requiredVersion: '^4.3.0',
    eager:           true,
  },
  'pinia': {
    singleton:       true,
    requiredVersion: '^2.1.0',
    eager:           true,
  },
}
```

### Vite 插件读取并注入

```ts
// @maho/vite-plugin/plugins/shared-deps.ts

async function resolveSharedDeps(
  config: ResolvedMFConfig,
): Promise<SharedDepsMap> {

  // 1. 从 boot-xxx 读取基础共享依赖
  const bootPlugin = config.plugins?.find(p =>
    p.use.startsWith('@maho/boot-')
  )
  let bootShared: SharedDepsMap = {}

  if (bootPlugin) {
    try {
      const bootPkg = await import(bootPlugin.use)
      bootShared = bootPkg.sharedDeps ?? {}
    } catch {
      console.warn(`[Maho] Could not read sharedDeps from "${bootPlugin.use}"`)
    }
  }

  // 2. 与用户在 config.yml 中手动追加的共享依赖合并
  const userShared = config.shared ?? {}

  // 用户声明优先（允许覆盖 boot 的版本要求）
  return { ...bootShared, ...userShared }
}
```

### 版本冲突处理

运行时，若两个 remote 加载了不同版本的共享依赖，federation 的 singleton 机制会：

1. 第一个加载的版本成为全局单例
2. 后续 remote 若版本满足 `requiredVersion` 范围，复用已加载的单例
3. 版本不兼容时，加载独立副本并输出警告

```ts
// 版本不兼容警告示例（由 @originjs/vite-plugin-federation 处理）
// [Maho Federation] Shared module "vue" version mismatch:
//   Singleton: 3.4.21 (loaded by host)
//   Required:  ^3.3.0 (required by module-legacy)
//   → Loading separate instance for module-legacy
```

### 子包追加共享依赖

子包若使用了额外的重型公共库（如 echarts），可在 `config.yml` 追加：

```yaml
# apps/module-chart/config/config.yml
shared:
  echarts:
    singleton: true
    version: "^5.4.0"
```

追加的共享依赖只影响声明了它的子包，不影响其他子包。

---

## 运行时加载机制

### `RemoteModule` 接口

```ts
// @maho/boot/interfaces/RemoteModule.ts

interface RemoteModule {
  /** 模块名（从 mf-meta 读取，或从 URL 推断） */
  name:    string

  /** remoteEntry.js 的 URL */
  entry:   string

  /** 加载指定出口 */
  load(exposePath: string): Promise<any>

  /** 是否已加载（remoteEntry 已初始化） */
  isReady: boolean
}
```

### `loadFederation` 完整实现

```ts
// @maho/boot/core/federation.ts

export async function loadFederation(
  config: FederationConfig,
): Promise<RemoteModule[]> {

  // Step 1：解析最终 remotes 列表
  const resolvedRemotes = await resolveManifest(config)

  if (resolvedRemotes.length === 0) {
    console.info('[Maho] No remotes configured.')
    return []
  }

  // Step 2：并行加载所有 remoteEntry.js
  const results = await Promise.allSettled(
    resolvedRemotes.map(remote => loadSingleRemote(remote))
  )

  // Step 3：收集成功的 remote，记录失败的 remote
  const loaded: RemoteModule[] = []

  results.forEach((result, index) => {
    const remote = resolvedRemotes[index]
    if (result.status === 'fulfilled') {
      loaded.push(result.value)
    } else {
      // 失败：跳过，不阻断整体启动
      console.warn(
        `[Maho] Failed to load remote "${remote.name ?? remote.url}":\n` +
        `  ${result.reason}\n` +
        `  This module's routes and components will be unavailable.`
      )
    }
  })

  // Step 4：异步验证版本兼容性（不阻塞路由收集）
  loaded.forEach(remote => validateRemote(remote).catch(() => {}))

  return loaded
}

async function loadSingleRemote(
  remote: ResolvedRemote,
): Promise<RemoteModule> {

  // 带重试的加载（最多 3 次，间隔递增）
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchAndInitRemoteEntry(remote)
    } catch (err) {
      if (attempt === 3) {
        throw new Error(
          `Remote "${remote.url}" failed after 3 attempts: ${err}`
        )
      }
      await sleep(attempt * 500)   // 0.5s, 1s, 1.5s
    }
  }

  throw new Error('Unreachable')
}

async function fetchAndInitRemoteEntry(
  remote: ResolvedRemote,
): Promise<RemoteModule> {

  // 通过动态 script 标签加载 remoteEntry.js
  // @originjs/vite-plugin-federation 会在 window 上注册对应的模块容器
  await loadScript(remote.url, remote.integrity)

  // 获取 federation 容器（由 vite-plugin-federation 注入到 window）
  const containerName = await getContainerName(remote)
  const container     = (window as any)[containerName]

  if (!container) {
    throw new Error(`Container "${containerName}" not found after loading ${remote.url}`)
  }

  // 初始化共享依赖作用域
  await container.init(__webpack_share_scopes__.default)

  return {
    name:    remote.name ?? containerName,
    entry:   remote.url,
    isReady: true,
    async load(exposePath: string) {
      const factory = await container.get(exposePath)
      return factory()
    },
  }
}

async function loadScript(url: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src  = url
    script.type = 'text/javascript'
    script.async = true

    if (integrity) {
      script.integrity   = integrity
      script.crossOrigin = 'anonymous'
    }

    script.onload  = () => resolve()
    script.onerror = () => reject(new Error(`Script load failed: ${url}`))
    document.head.appendChild(script)
  })
}
```

### 错误边界集成

加载失败的子包模块在路由层面提供降级渲染：

```ts
// @maho/boot-vue/adapter.ts

// convertRoutes 时包装每个组件为带错误边界的异步组件
function wrapComponent(loader: () => Promise<{ default: unknown }>) {
  return defineAsyncComponent({
    loader,
    errorComponent:   MahoRemoteError,   // 显示"模块加载失败"
    loadingComponent: MahoRemoteLoading, // 显示加载占位
    delay:   200,
    timeout: 10_000,
    onError(error, retry, fail, attempts) {
      // 自动重试 2 次，超过则展示错误组件
      if (attempts <= 2) {
        retry()
      } else {
        console.error('[Maho] Component load failed after retries:', error)
        fail()
      }
    },
  })
}
```

---

## 构建配置生成

### `@maho/vite-plugin` 的 federation 插件

```ts
// @maho/vite-plugin/plugins/federation.ts

import federation from '@originjs/vite-plugin-federation'

export function mahoFederationPlugin(
  config: ResolvedMFConfig,
  mode:   string,
): Plugin {

  const shared   = await resolveSharedDeps(config)
  const exposes  = resolveExposes(config)
  const remotes  = resolveRemotes(config, mode)

  // Host 角色：配置为消费者
  if (config.role === 'host') {
    return federation({
      name:    'host',
      remotes,           // 需要加载的 remote 模块
      shared,            // 共享依赖声明
    })
  }

  // Remote 角色：配置为提供者
  return federation({
    name:     config.name!,
    filename: 'remoteEntry.js',
    exposes,             // 对外暴露的模块
    shared,              // 共享依赖声明
  })
}

function resolveRemotes(
  config: ResolvedMFConfig,
  mode:   string,
): Record<string, string> {

  // dev 模式：从环境变量读取本地 dev server 地址
  if (mode === 'dev' && process.env.MAHO_DEV_REMOTES) {
    const devRemotes: Array<{ name: string; entry: string }> =
      JSON.parse(process.env.MAHO_DEV_REMOTES)

    return Object.fromEntries(
      devRemotes.map(r => [r.name, r.entry])
    )
  }

  // prod 模式：使用 virtual:maho-config 中的静态地址
  // federation 插件在运行时动态加载，此处返回空对象
  // 实际 remote URL 由 boot 的 loadFederation 在运行时处理
  return {}
}
```

### 完整 Vite 配置示例

框架生成的最终 Vite 配置（用户不需要手动编写）：

```ts
// 父包（Host）的生成 Vite 配置
export default defineConfig({
  plugins: [
    vue(),
    mahoFederationPlugin(resolvedConfig, 'prod'),
    // 虚拟模块注册
    mahoVirtualConfigPlugin(resolvedConfig, 'prod'),
    // CSS Modules 强制开启（通过 postcss 配置）
    mahoCSSModulesPlugin(),
    // HTML 模板注入全局 Loading
    mahoLoadingPlugin(resolvedConfig.loading),
    // 用户插件通过 vite:config hook 追加
    ...userVitePlugins,
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // 子包 chunk 命名加入 hash，避免 CDN 缓存问题
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  css: {
    modules: {
      // CSS Modules 命名规范：[模块名]__[类名]__[hash]
      generateScopedName: '[local]__[hash:base64:5]',
    },
  },
})
```

---

## `FederationService` 实现

```ts
// @maho/core/services/federation.ts

class FederationService extends Service {
  static inject = ['config', 'mode'] as const

  /** 当前已解析的 remote 列表 */
  remotes: ResolvedRemote[] = []

  /** 最后一次解析的时间戳 */
  private lastResolvedAt: number = 0

  async resolve(): Promise<ResolvedRemote[]> {
    const { federation } = this.ctx.config.resolved
    const isDev = this.ctx.mode.isDev

    // Step 1：解析静态 + 动态 manifest
    let remotes = await this.resolveStaticRemotes(federation)

    if (federation.manifestUrl) {
      remotes = await this.mergeWithManifest(remotes, federation.manifestUrl)
    }

    // Step 2：dev 模式应用本地覆盖
    if (isDev) {
      remotes = this.applyDevOverrides(remotes, federation.dev?.overrides)
    }

    this.remotes        = remotes
    this.lastResolvedAt = Date.now()

    this.ctx.emit('federation:resolved', remotes)
    return remotes
  }

  private resolveStaticRemotes(
    federation: ResolvedMFConfig['federation'],
  ): ResolvedRemote[] {
    return (federation?.remotes ?? []).map(url => ({
      url,
      name:   extractNameFromUrl(url),   // 从 URL 路径推断模块名（best-effort）
      source: 'static' as const,
    }))
  }

  private async mergeWithManifest(
    staticRemotes: ResolvedRemote[],
    manifestUrl:   string,
  ): Promise<ResolvedRemote[]> {
    try {
      const resp     = await fetch(manifestUrl, {
        signal: AbortSignal.timeout(5_000),
      })
      const manifest: FederationManifest = await resp.json()
      const merged   = [...staticRemotes]

      for (const entry of manifest.remotes) {
        const idx = merged.findIndex(r => r.name === entry.name)
        if (idx >= 0) {
          merged[idx] = { ...entry, source: 'manifest' }
        } else {
          merged.push({ ...entry, source: 'manifest' })
        }
      }
      return merged
    } catch (err) {
      console.warn(
        `[Maho] Manifest fetch failed: ${err}\n` +
        `Falling back to static remotes.`
      )
      return staticRemotes
    }
  }

  private applyDevOverrides(
    remotes:   ResolvedRemote[],
    overrides: Record<string, string> = {},
  ): ResolvedRemote[] {
    // 同时处理环境变量注入的 dev remotes（来自 CLI 进程管理器）
    const envRemotes: Array<{ name: string; entry: string }> =
      process.env.MAHO_DEV_REMOTES
        ? JSON.parse(process.env.MAHO_DEV_REMOTES)
        : []

    const allOverrides = {
      ...Object.fromEntries(envRemotes.map(r => [r.name, r.entry])),
      ...overrides,  // config.yml 中手动声明的覆盖优先级更高
    }

    return remotes.map(r =>
      allOverrides[r.name]
        ? { ...r, url: allOverrides[r.name], source: 'dev-override' as const }
        : r
    )
  }
}
```

---

## dev 模式联邦

### 完整链路

```
maho dev --filter order,user

CLI ProcessManager
  ├── 启动 Host dev server（port 5173）
  ├── 启动 module-order dev server（port 5174）
  └── 启动 module-user dev server（port 5175）

CLI 注入环境变量：
  MAHO_DEV_REMOTES='[
    {"name":"module-order","entry":"http://localhost:5174/remoteEntry.js"},
    {"name":"module-user", "entry":"http://localhost:5175/remoteEntry.js"}
  ]'

Host Vite dev server 启动
  ↓ ViteService.buildViteConfig()
  ↓ FederationService.resolve()
      → 读取 MAHO_DEV_REMOTES 环境变量
      → remotes 指向 localhost 地址
  ↓ virtual:maho-config 生成
      → federation.remotes = ['http://localhost:5174/...', 'http://localhost:5175/...']

浏览器运行
  ↓ Boot.loadFederation()
  ↓ 并行加载 localhost:5174/remoteEntry.js 和 localhost:5175/remoteEntry.js
  ↓ 收集路由，合并，渲染
```

### 未启动的子包降级

若某些子包未被 `--filter` 包含，Host 使用已发布的 CDN 版本：

```ts
// FederationService.applyDevOverrides

// 没有被覆盖的 remote 仍使用 config.yml 中的 CDN 地址
// 例如：module-admin 未启动 → 使用 https://cdn.org.com/module-admin/remoteEntry.js
```

这保证了开发者只需启动自己负责的子包，其余模块仍然可用（使用线上最新版本）。

---

*下一篇：[design-mvp.md](./design-mvp.md) — V1 实现计划、包边界、里程碑、优先级*
