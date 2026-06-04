# Maho 设计优化记录

> 实现 V1 MVP 过程中相对原始设计文档的偏离与优化。每条记录包含：原始设计、问题分析、采用方案、影响范围。
> 原始设计文档不做就地修改，待 V1 稳定后再回流。

---

## 目录

1. [Step 1：`@maho/boot` + `@maho/boot-vue`](#step-1mahoboot--mahoboot-vue)
2. [Step 2：`@maho/vite-plugin`](#step-2mahovite-plugin)
3. [Step 3：`@maho/core`（最小核）](#step-3mahocore最小核)

---

## Step 1：`@maho/boot` + `@maho/boot-vue`

### S1-O1：`RouteMerger` 重组树移除 `(parent.route as any).__resolved` 中间态

**原始设计**（`design-route-system.md` §Step 3 buildRouteTree）：

```ts
;(parent.route as any).__resolved ??= record
;(parent.route as any).__children ??= []
;(parent.route as any).__children.push(record)
```

**问题**：在用户传入的 `ModuleRoute` 对象上挂私有字段，污染输入；后续遍历需要再把 `__children` 拷贝到正式 `children`，逻辑迂回。

**采用方案**（`packages/boot/src/core/route-merger.ts`）：用 `Map<fullPath, MahoRoute>` 二次索引，直接在新构造的节点上 push 子节点。原 `ModuleRoute` 始终保持不可变。

**影响**：仅内部实现差异，对外行为完全一致。

---

### S1-O2：`applyLayouts` 用 `WeakMap<Router, ResolvedLayoutMap>` 而非 `(router as any).__mahoLayouts`

**原始设计**（`design-boot.md` §`applyLayouts`）：

```ts
router.isReady().then(() => {
  ;(router as any).__mahoLayouts = layouts
})
```

**问题**：
1. `as any` 入侵 Router 对象。
2. `router.isReady()` 解析时机在 `createApp` 之后，但 `createApp` 内部已经读取 `(router as any).__mahoLayouts` —— 读到 `undefined`。

**采用方案**（`packages/boot-vue/src/adapter.ts`）：模块级 `WeakMap<Router, ResolvedLayoutMap>`，`applyLayouts` 同步写入，`createApp` 同步读取并 `provide`。

**影响**：行为正确性修复 + 支持多 Router 实例并存。

---

### S1-O3：`loadFederation` 共享 scope 容错初始化

**原始设计**（`design-federation.md` §`fetchAndInitRemoteEntry`）：

```ts
await container.init(__webpack_share_scopes__.default)
```

**问题**：`__webpack_share_scopes__` 是 webpack 概念，`@originjs/vite-plugin-federation` 暴露的全局名为 `__federation_shared__`，且在 host 未初始化前可能为 undefined。此外多次 `init` 会抛错，需要吞掉。

**采用方案**（`packages/boot/src/core/federation.ts:loadRemoteEntryOnce`）：

```ts
const shareScope = (window as any).__federation_shared__ ?? {}
try { await container.init?.(shareScope) } catch { /* 已初始化 */ }
```

**影响**：兼容 vite-plugin-federation 真实运行时；多次加载同 remote 也安全。

---

## Step 2：`@maho/vite-plugin`

### S2-O1：Host 角色的 `remotes` 在 federation 插件中传空对象

**原始设计**（`design-federation.md` §`mahoFederationPlugin`）：

```ts
if (config.role === 'host') {
  return federation({ name: 'host', remotes, shared })
}
```

其中 `remotes` 来自配置的静态地址，会作为构建期常量编入 host bundle。

**问题**：
1. 这与 Maho 「动态 manifest 运行时合并」的目标冲突 —— 若 host 把 remote URL 编死到 bundle 里，CDN 替换/灰度发布必须重新构建 host。
2. boot 端的 `loadFederation` 本身就在运行时通过 `<script>` 注入 + container API 加载 remote。同时让 vite-plugin-federation 也维护一份会引发双重加载。

**采用方案**（`packages/vite-plugin/src/plugins/federation.ts:mahoFederationPlugin`）：

```ts
if (options.role === 'host') {
  return federation({
    name: options.name,
    remotes: {},              // ← 不再编入静态地址
    shared: sharedForFederation,
  })
}
```

`shared` 仍然传，让 federation 插件注入 share scope 运行时（保证 boot 调 `container.init` 时有 scope 可用）。所有 remote 加载完全由 boot 在运行时驱动，URL 来自 `virtual:maho-config`，dynamic manifest 直接生效，无需重新构建 host。

**影响**：
- ✅ 动态 manifest 现在真正运行时生效
- ✅ dev 模式下 CLI 注入 `MAHO_DEV_REMOTES` 后无需 vite-plugin-federation 配合
- ⚠️ 用户不能再用 `import('module-x/...')` 这种 vite-plugin-federation 静态语法 —— 必须用 Maho 提供的 `mf.load(key)` 或 `() => import('virtual:...')`。这是显式设计权衡，记入文档。

---

### S2-O2：`shared` 字段剥除 `eager`

**原始设计**（`design-federation.md` §「共享依赖策略」）：

```ts
export const sharedDeps: SharedDepsMap = {
  vue: { singleton: true, requiredVersion: '^3.4.0', eager: true },
  ...
}
```

**问题**：`eager` 是 webpack ModuleFederationPlugin 的概念（表示该共享依赖同步预加载，避免 chunk 分割引发的 race condition）。`@originjs/vite-plugin-federation` 没有对应字段；传入会被忽略，但容易让人误以为生效。

**采用方案**：
1. `@maho/boot-vue` 的 `sharedDeps` 导出（`packages/boot-vue/src/index.ts`）只声明 `singleton + requiredVersion`，不写 `eager`。
2. `@maho/vite-plugin` 的 `normalizeSharedShape` 显式只读取 `singleton/requiredVersion/version`（`packages/vite-plugin/src/plugins/shared-deps.ts`）。
3. 由 federation 插件的运行时容器机制保证单例（`singleton: true` + 满足 `requiredVersion` 时复用已加载实例）。

**影响**：行为与原设计意图一致（vue/router/pinia 单例），但去掉了误导性字段。

---

### S2-O3：CSS Modules「强制开启」改为 scopedName 统一

**原始设计**（`design-mvp.md` 验收 §CSS）：

> 子包手写样式自动开启 CSS Modules

**问题**：「强制对所有 .css 文件应用 CSS Modules」会破坏 `reset.css`、Element Plus 全局样式等不期望被 hash 的场景。Vite 本身已经按文件名约定（`*.module.css`）自动处理。

**采用方案**（`packages/vite-plugin/src/plugins/css-modules.ts`）：插件职责重新定位为「统一 scopedName 命名规则」，不再强制把全部 css 当 modules 处理。

```ts
config() {
  return {
    css: { modules: { generateScopedName: '[local]__[hash:base64:5]' } },
  }
}
```

**影响**：
- ✅ 仍然解决「子包间 className 冲突」的核心目标
- ✅ 不破坏全局样式
- ⚠️ 文档需明确：业务想做 module 的样式文件必须用 `*.module.css` / `<style module>`

---

### S2-O4：`virtual:maho-config` 与类型注册表生成下沉到 vite-plugin

**原始设计**（`design-type-system.md`）：将类型注册表生成、`virtual.d.ts` 写入归到 `@maho/core` 的 `TypeService`。

**问题**：Step 2（vite-plugin）先于 Step 3（core）完成。若 vite-plugin 依赖 core，构建顺序卡死；用户在没有 core 的最小场景也无法获得类型支持。

**采用方案**：
1. Step 2 在 `packages/vite-plugin/src/plugins/type-registry.ts` 内置一份极简扫描器（不递归 .pnpm，不做 lockfile 缓存）。
2. Step 3 接入 core 后，`TypeService` 接管该职责；vite-plugin 通过 `emitTypes: false` 让位即可。

**影响**：
- ✅ vite-plugin 现在自包含可用
- ✅ Step 3 落地时可平滑切换，用户配置零改动
- ⚠️ 当前扫描器不支持深层 monorepo workspaces，仅支持 `node_modules/<pkg>` 和 `node_modules/@<scope>/<pkg>` 两级；复杂场景需要等 Step 3 的 TypeService

---

### S2-O5：`inlineRoutes` 在 Step 2 改为插件显式参数

**原始设计**（`design-cordis-services.md` 中的 `RouteService`）：扫描 inline 子包目录自动收集路由。

**问题**：`RouteService` 是 Step 3 的产物。Step 2 时 vite-plugin 拿不到「inline 子包列表」。

**采用方案**（`packages/vite-plugin/src/types.ts`）：在 `MahoPluginOptions` 增加 `inlineRoutes: MahoRoute[]` 字段，由调用方显式传入；为空时退化为「无 inline 子包」。

**影响**：
- ✅ Step 2 独立可测试
- ✅ Step 3 接入后，core 计算出 inlineRoutes 再传入即可，无 API 变化
- ⚠️ 现阶段单独使用 vite-plugin 想 inline 嵌入子包需要用户手写 MahoRoute 数组

---

### S2-O6：`MahoStaticConfig` 增加可选 `loading` 字段

**原始设计**（`design-type-system.md` §`MahoStaticConfig`）：仅 `role / mode / federation / inlineRoutes / shared`。

**问题**：HTML loading 注入插件需要把背景色、主色、自定义 HTML 写到 `index.html` 的 `<style>`；同时 boot 端的 `MahoLoading` 也可能想知道这些配置（虽然 Step 1 还没用到）。两边读取同一份配置最合理。

**采用方案**（`packages/boot/src/interfaces/MahoStaticConfig.ts`）：

```ts
loading?: {
  html?: string
  background?: string
  color?: string
}
```

**影响**：boot 暂不消费该字段，仅 vite-plugin 写入；后续 boot 想做「Loading 二次渲染兜底」时可以读取。零破坏性。

---

## Step 3：`@maho/core`（最小核）

> Step 3 原本规划 9 个 service + 2 个 pipeline 的完整 Cordis 体系。落地时按「能否在不依赖 CLI 的前提下被实运行验证」的标准做了大幅裁剪 —— 只保留 `ConfigService` + `ModeService` + utils + `MFContext` 骨架。剩余 service 推迟到 Step 4 与 CLI 一起设计，避免「写了但跑不起来」的死代码。

### S3-O1：范围裁剪 —— 只交付 Config + Mode + utils

**原始设计**（`design-cordis-services.md`）：Step 3 一次性落地 `ConfigService / FederationService / RouteService / ViteService / WatchService / TypeService / DevPipelineService / BuildPipelineService` 等 9+ 个服务。

**问题**：

1. `FederationService / RouteService / ViteService` 的输出（manifest、inlineRoutes、vite config）只有在 CLI 真正调用 `vite` / `build` 时才能验证；脱离 Step 4 CLI 写出来的实现无法测试。
2. `WatchService` 依赖 chokidar 在 CLI dev 模式下接管；Step 3 单独写无 dev server 可触发。
3. `TypeService` 依赖 tsc Compiler API 生成 `.d.ts`，需要 vite-plugin 的 `emitTypes: false` 让位 —— 也属于 CLI 接入流程。
4. 一次性写 9 个 service 会让 Step 3 体量翻倍，但增加的代码大多不会被任何调用方触发，等到 Step 4 真正接入时又要返工。

**采用方案**（`packages/core/src/`）：

- 仅实现：`ConfigService` / `ModeService` / `MFContext` / `createMahoContext` / `utils/{merge,env,yaml,plugin-loader,config-validator}`。
- 其他 service 在 Step 4 的 CLI 实现过程中逐个引入，每个 service 都伴随 CLI 中的实际调用点。
- `MFContext` 已经预留 events 声明（`config:ready / config:resolved / config:changed`），后续 service 直接 listen 即可。

**影响**：

- ✅ Step 3 收敛到「能加载一个真实 YAML 配置并 deepMerge 后通过校验」的最小验收
- ✅ Step 4 CLI 实现时按需追加 service，避免空转代码
- ⚠️ 当前 `ConfigService.reload` 是个空壳，等 WatchService 接入后才有意义；保留接口是为了下游 import 路径稳定

---

### S3-O2：`config.local.yml` 第三层合并暂缓

**原始设计**（`design-config-system.md`）：三层合并 `base ← current ← local`，`config.local.yml` 用于 Devtools 临时回写。

**问题**：MVP 阶段没有 Devtools，第三层永远是空对象。同时三层合并会让 `recompute()` 的写法和事件链条都更长。

**采用方案**（`packages/core/src/services/config.ts`）：

```ts
private recompute(): void {
  this.resolved = deepMerge(this.base, this.current) as ResolvedMFConfig
}
```

`base / current` 两层即可；`local` 第三层与 Devtools 回写 API 一起留到 V2。

**影响**：YAML 解析与 deepMerge 行为不变；用户无感知；后续插入第三层只需扩 `recompute` 与新增 `local` 字段。

---

### S3-O3：Cordis 4.x API 替换 —— `ctx.effect` 而非 `ctx.on(Context.dispose, ...)`

**原始设计**（`design-cordis-services.md` §「Cordis 基础」）：

```ts
ctx.on(Context.dispose, () => watcher.close())
```

**问题**：参考的是 Cordis 3.x API。当前依赖的 `cordis@^4.0.0-rc.6` 已经把生命周期清理统一到 `ctx.effect(setup)` 模式 —— `setup` 返回 dispose 函数。

**采用方案**：本包后续所有需要清理资源的 service（Step 4 引入的 WatchService 等）一律使用：

```ts
ctx.effect(() => {
  const watcher = chokidar.watch(...)
  return () => watcher.close()
})
```

Step 3 的两个 service（Config / Mode）目前没有需要清理的资源，未触发该模式；但模式已经在设计文档里全面替换。

**影响**：仅文档与未来代码风格统一；不影响当前实现。

---

### S3-O4：移除 `ctx.container.register/resolve` 抽象

**原始设计**（`design-cordis-services.md` §「IoC 替换」）：

```ts
ctx.container.register('vite', NewViteService)
const vite = ctx.container.resolve<ViteService>('vite')
```

**问题**：Cordis 4.x 根本没有 `ServiceContainer` 概念。所有服务的"替换"通过同名 `ctx.plugin(NewImpl, options)` 重新注册即可 —— Cordis 内部按 service name 维护 fiber，老 fiber 自动 dispose。

**采用方案**：本包采用 Cordis 原生 `ctx.plugin()`，不再提供 `ctx.container` 这层抽象。设计文档中所有 `container.register/resolve` 示例需在 Step 4 同步改写。

**影响**：API 表面更接近 Cordis 原生；用户/插件作者只需学一份 Cordis 概念。

---

### S3-O5：`ConfigService` 显式 `projectRoot` 注入

**原始设计**（`design-config-system.md` §`findConfigDir`）：从 `process.cwd()` 向上递归查找 `config/config.yml` 所在目录。

**问题**：

1. monorepo 场景下 `process.cwd()` 可能是 workspace root 而非 app 目录，向上爬找不到。
2. 测试 / 多项目嵌入场景需要显式控制 root。
3. 自动查找还会引入 fs 调用开销与「跨包污染」（爬到 monorepo 根可能读到其他包的 config.yml）。

**采用方案**（`packages/core/src/services/config.ts`）：

```ts
export interface ConfigServiceOptions {
  projectRoot: string
}
```

`createMahoContext({ projectRoot? })` 默认用 `process.cwd()`，但允许调用方（CLI / 测试 / 嵌入）显式指定。

**影响**：

- ✅ monorepo 友好
- ✅ 测试可注入虚假 root
- ✅ 没有意外的「向上爬」副作用

---

### S3-O6：Devtools 回写 API 推迟到 V2

**原始设计**（`design-config-system.md`）：`ConfigService` 暴露 `updateBase / updateCurrent / updateLocal / clearCurrentField` 等修改方法。

**问题**：这些 API 仅服务于 Devtools UI（编辑配置后写回磁盘）。MVP 无 Devtools，实现后没有触发路径，也无法做真实回归测试。

**采用方案**：本步骤不实现；保留 `base / current / resolved` 三个只读字段 + `load() / reload()`，足够 CLI 与（未来的）插件读取配置。

**影响**：插件目前应将 `ctx.config.resolved` 视为只读快照，要响应配置变化请 listen `config:resolved` 事件。

---

### S3-O7：`deepMergeWithSource` 字段来源追踪推迟

**原始设计**（`design-config-system.md` §「Devtools 字段来源视图」）：deepMerge 同时输出一份 `Map<dotPath, 'base' | 'current' | 'local'>`，让 Devtools 展示每个字段来自哪一层。

**问题**：唯一消费方是 Devtools。MVP 没有消费方，提前实现会让 `deepMerge` 函数复杂度倍增（递归路径累计 + 多返回值）。

**采用方案**：`utils/merge.ts` 只实现纯净版 `deepMerge`。字段来源追踪作为独立函数留到 V2，互不耦合。

**影响**：合并逻辑保持单一职责；V2 增加 source map 时无需破坏现有 API。

---

### S3-O8：`TypeService.emitDeclarations` 改用 tsc Compiler API（推迟到 Step 4）

**原始设计**（`design-type-system.md`）：`TypeService` 内调用 `vite-plugin-dts` 触发 `.d.ts` 生成。

**问题**：

1. `vite-plugin-dts` 必须嵌入 Rollup 构建流水线，意味着 `TypeService.emitDeclarations()` 不能脱离 Vite 单独运行（如 CI 中的纯类型构建）。
2. 把类型生成绑死在 Rollup 上，dev / build / CLI standalone 三种触发点都要绕开 Vite 单独跑一次，路径不直。
3. `vite-plugin-dts` 内部多次扫描 + 自带缓存策略，与 Maho 已有的「registry 索引 + lockfile mtime」缓存重复且不可控。

**采用方案**：Step 4 落地 `TypeService` 时改用 `typescript` 包的 Compiler API（`ts.createProgram + program.emit({ emitOnlyDtsFiles: true })`），独立于 Vite / Rollup，CLI 可以单独 `maho types` 触发。Step 3 暂不实现该 service。

**影响**：

- ✅ 类型生成不再依赖 Vite 启动
- ✅ `maho types` 可独立运行
- ⚠️ 需要 core 自己处理 `tsconfig.json` 解析；不过 `ts.parseJsonConfigFileContent` 已经现成

---

### S3-O9：YAML 解析错误信息携带文件路径

**原始设计**：`parseYaml(filePath)` 直接 `yaml.load(text)`，错误堆栈中没有文件名。

**问题**：用户写错 YAML 时（`config.yml` / `config.dev.yml` 任一）只看到 `js-yaml` 的行列号，不知道哪个文件。

**采用方案**（`packages/core/src/utils/yaml.ts`）：

```ts
return yaml.load(text, { schema, filename: filePath })
```

`js-yaml` 的 `filename` 选项会把路径写进 `YAMLException.mark.name`，错误消息直接包含文件路径。

**影响**：用户体验细节；零成本。

---

## Step 4：`@maho/cli`（dev + build only）

> Step 4 原计划交付 4 个命令（dev/build/init/add）+ 内置模板系统 + 完整进程编排。落地时按「最小可跑通」标准做了大幅范围裁剪 —— 只保留 `dev` 与 `build`，让用户在已经手写好的工作区里一行命令跑起来。`init` / `add` / 模板系统推迟到 Step 5。

### S4-O1：范围裁剪 —— 只交付 dev + build

**原始设计**（`design-cli.md`）：Step 4 一次性交付 `maho dev / build / init / add` + 内置 host-vue / remote-vue 模板（EJS 渲染）+ 包管理器适配（npm / yarn / pnpm install）。

**问题**：

1. 模板系统体量超过 dev + build 之和；需要维护内置模板内容、占位符替换、依赖版本同步。
2. `init` 与 `add` 的可演化性依赖模板，每次 boot/boot-vue/vite-plugin API 变化都要回头修模板。
3. dev/build 是用户「装完包就能跑」的入口，缺它就完全没有体验；init/add 只是首次脚手架，缺它用户仍可手写工作区跑通。

**采用方案**：Step 4 只交付 `dev` 与 `build` 两条命令。`init` / `add` 推迟到 Step 5 单独 PR。

**影响**：
- ✅ Step 4 PR 体量减半，可在「smoke 例子手写工作区跑通」即达成验收
- ✅ 模板系统延后到 boot/vite-plugin API 稳定后再设计，避免反复重写
- ⚠️ 用户首次使用需要手写 `package.json` / `vite.config.ts` / `config/config.yml` —— 用 `examples/smoke` 作为复制模板

---

### S4-O2：CLI 直接 `spawn vite`，不引入 dev-runner 中间层

**原始设计**（`design-cli.md` §dev-runner）：CLI 调 `node --import tsx/esm @maho/core/dev-runner`，由 core 内的 `ViteService` 创建 Vite server。

**问题**：

1. 用户的 `vite.config.ts` 已经是社区标准入口，再套一层 dev-runner 让 Maho 隐藏了 Vite 配置 —— 反而违背 vite-plugin 已经成立的「插件契约」。
2. dev-runner 必然要求 core 新增 `ViteService`（创建 / 销毁 server），但本次 Step 3 已经把 ViteService 推迟。
3. 多一层中间层意味着 vite 自己的错误堆栈要穿越 dev-runner 才能到用户终端，调试链变长。

**采用方案**（`packages/cli/src/core/process-manager.ts`）：CLI 直接 `execa(viteBin, ['--port', String(port), '--strictPort'], { cwd, env, ... })`，每个 app 一个 Vite 子进程。

**影响**：
- ✅ 用户 `vite.config.ts` 是真正可控的入口，社区生态可直接复用
- ✅ vite 错误直接打在终端，无中间层包装
- ✅ core 零变更，本次 PR 不动 ConfigService / ModeService 之外的内容

---

### S4-O3：Dev manifest 走环境变量而非文件

**原始设计**：部分设计稿写 `.maho/dev-manifest.json` 让 vite-plugin 从磁盘读取 dev 地址。

**问题**：

1. 落盘文件需要在 Ctrl+C 时清理，否则下次启动残留脏数据。
2. Windows 路径处理 / 文件锁定让落盘变成额外故障源。
3. 同机器多 workspace 并行 dev 时，manifest 文件容易互踩。

**采用方案**：vite-plugin 已实现读 `MAHO_DEV_REMOTES` env var（`packages/vite-plugin/src/utils/resolve-options.ts:69`），CLI 直接在 `spawn vite host` 时 `env: { MAHO_DEV_REMOTES: JSON.stringify([...]) }` 注入。零落盘 + 进程隔离天然干净。

**影响**：
- ✅ 退出无残留
- ✅ 多 workspace 互不干扰
- ✅ vite-plugin 不动一行 —— 它对接的契约已经存在

---

### S4-O4：不引入 chokidar 文件监听

**原始设计**（`design-cordis-services.md` §`WatchService`）：监听 `config.yml` / `config.dev.yml` 变更，触发 `config:changed` 事件。

**问题**：

1. CLI 的 dev 链路里没有任何「监听到事件后该做什么」的消费方 —— ViteService / FederationService 都已经被推迟。
2. Vite 自己的 HMR 已经处理 `vite.config.ts` 变更（fullReload）；YAML 变更场景下重启进程是合理代价。
3. 提前引入 chokidar 而无消费方，会变成「半热重载」的窘境 —— 监听到了但没人响应。

**采用方案**：Step 4 不引入 chokidar、不实现 `WatchService`。YAML 配置变更 = 手动 Ctrl+C 重启。

**影响**：
- ✅ CLI 依赖更少：`cac / picocolors / execa / jiti` 四个轻量包
- ⚠️ 改 YAML 需重启；可接受，留待真正有插件订阅 `config:changed` 时再做

---

### S4-O5：vite bin 解析采用 `node_modules/.bin` 向上查找，而非 `pnpm exec`

**原始设计**：通过 `execa('pnpm', ['exec', 'vite', ...])` 利用包管理器解析 bin。

**问题**：强绑定 pnpm —— npm / yarn 用户用不了。

**采用方案**（`packages/cli/src/core/bin-resolver.ts`）：实现 `resolveBin(cwd, name)`，沿 cwd 向上查找 `node_modules/.bin/<name>(.cmd|.CMD)?`。三种包管理器都会在 `.bin` 下生成对应 shim，全平台兼容（Windows 优先 `.CMD`）。

**影响**：
- ✅ 兼容 npm / yarn / pnpm 全部安装布局
- ✅ Windows / POSIX 同代码路径

---

### S4-O6：子包目录执行 `maho dev` 自动委派到 workspace root

**原始设计**：仅在 root 目录可执行 `maho dev`。

**问题**：用户开发某个 remote 时通常 `cd apps/module-x` 后 `maho dev`，期望只起当前 remote + host。从 root 反向操作打断工作流。

**采用方案**（`packages/cli/src/commands/dev.ts`）：检测到 `ctx.role === 'remote'` 时，spawn 一个新的 `maho dev --filter <self>` 子进程在 root 下运行，而非进程内转发 —— 避免重复 ConfigService 初始化的状态污染。

**影响**：
- ✅ 子包目录无障碍开发体验
- ✅ 委派走子进程，状态隔离干净

---

### S4-O7：`maho build` host 失败退出 1，remote 失败 warn 但不中断

**原始设计**（`design-cli.md`）：所有失败一视同仁退出 1。

**问题**：CI 场景下，remote 的偶发构建错误（如类型未生成）不该阻断 host 的构建报告。而 host 是用户主入口，host 失败必须明确失败。

**采用方案**（`packages/cli/src/commands/build.ts`）：

```ts
// Stage 1: 并行所有 remote，Promise.allSettled，失败 warn 不抛
// Stage 2: 串行 host，try/catch，host 失败 → process.exit(1)
```

最终的 `printSummary` 在 remote 有失败时显示 `Build finished with errors: X/Y succeeded`，由 CI 自行决定是否拦截（看 exit code + summary 标记）。

**影响**：
- ✅ host 失败 = 退出 1（必须），CI 拦截语义明确
- ✅ remote 失败 = 退出 1 但 host 已完成（最后 `results.some((r) => !r.ok)` 兜底退出 1）
- ✅ summary 区分「全成功」与「部分失败」

---

### S4-O8：picocolors 替代 chalk

**原始设计**：`chalk` 做终端着色。

**问题**：`chalk` v5 ESM + 一堆 transitive deps（`supports-color` 等），CLI 启动时间被拖慢。

**采用方案**：`picocolors` —— 零依赖、< 1KB、API 与 chalk 子集兼容。

**影响**：
- ✅ CLI cold start 更快
- ✅ 一个不到 1KB 的依赖替代一棵小型依赖树

---

### S4-O9：`examples/smoke` 不进 pnpm workspace、不进 typecheck 矩阵

**原始设计**：smoke 例子和其他包一样进 pnpm workspace。

**问题**：

1. smoke 例子的 deps（vite / @vitejs/plugin-vue）会污染 root `node_modules`。
2. smoke 例子有自己的 `apps/*` 子包结构（用来测试 CLI 的 remote 发现），如果挂在 root workspace 下会和顶层 `packages/*` 命名冲突。
3. typecheck 不需要覆盖 smoke 例子 —— 它的「正确性」由手工 `maho dev` 验证。

**采用方案**：`examples/smoke/` 有独立的 `package.json` 与 `pnpm-workspace.yaml`（仅声明 `apps/*`），不写入 root 的 `pnpm-workspace.yaml`；不提供 `typecheck` script。

**影响**：
- ✅ root `pnpm -r run typecheck` 输出干净，只覆盖 5 个正式包
- ✅ smoke 例子独立 install，互不影响

---

### S4-O10：CLI bin 走 jiti 加载 TS 源，不输出 dist

**原始设计**：CLI 与其他包一样 `tsc --outDir dist`，bin 指向 `dist/index.js`。

**问题**：

1. monorepo 内 `tsconfig.base.json` 用 `moduleResolution: Bundler`，tsc 不在 emit 的 import 后追加 `.js` 后缀 —— Node ESM 严格解析器拒绝加载（`ERR_MODULE_NOT_FOUND`）。
2. 修复方案有两类：(a) CLI 单独切到 `module: NodeNext` 并给所有相对 import 加 `.js` 后缀；(b) 用 ts-loader 在运行时编译。
3. 选 (a) 意味着源码到处出现 `.js` 后缀，与其他 4 个包风格不一致；同时让 CLI 在迭代期每次都要 build 一次才能跑。

**采用方案**（`packages/cli/bin/maho.mjs`）：

```js
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
const jiti = createJiti(fileURLToPath(import.meta.url), { interopDefault: true })
await jiti.import('../src/index.ts')
```

`jiti` 已经是 core 的依赖（用于 `loadPlugin` 加载本地 `.ts` 插件），CLI 复用零额外成本。`package.json.main` / `exports` 也直接指向 `src/index.ts`，与其他包风格统一。

**影响**：
- ✅ 不需要 build 步骤，修改 src/ 即时生效
- ✅ 不需要每个文件加 `.js` 后缀，源码风格与 boot / boot-vue / vite-plugin / core 一致
- ✅ 发布到 npm 时 jiti 会即时转译 TS —— 启动慢约 100ms，可接受（V2 若有性能诉求再切静态 build）

---

### S4-O11：彻底隐藏 vite —— CLI 程序化运行 vite，用户不再写 `vite.config.ts`

**原始决策**（S4-O2）：CLI 直接 `spawn vite` 每个 app 子进程，让用户 `vite.config.ts` 成为社区标准入口。

**重新发现的问题**：

1. 用户工作区里仍然能看到 `vite.config.ts`，与 Maho「config-first / 配置即声明」的初衷相悖；不同 app 的 `vite.config.ts` 几乎是模板复刻（`vue() + await maho({ ... })`），但又必须存在一份，制造心智负担。
2. 让 `vite.config.ts` 成为入口意味着配置的真相被分成两半：`config/config.yml` 声明 maho 的角色 / federation / 路由 / 共享依赖；`vite.config.ts` 仍要手动 import `@vitejs/plugin-vue`、传 `bootAdapter` 字符串等 —— 用户必须在两处理解相同概念。
3. 框架想引入新插件（例如 `@vitejs/plugin-react` 替换、自定义 transform）时，需要让每个用户工程跟进 `vite.config.ts` 模板的演进，迁移成本高。

**采用方案**（`packages/cli/src/core/vite-runner.ts`）：CLI 改为程序化调用 vite。每个 app 启动时：

```ts
const ctx = await createMahoContext({ projectRoot: app.dir, mode })
const bootPlugins = await ctx.boot.getVitePlugins()
const mahoPlugins = await maho({ role, name, federation, exposes, shared, ... })

await createServer({
  root: app.dir,
  configFile: false,                // 显式禁用 vite.config 查找
  plugins: [...bootPlugins, ...mahoPlugins],
  server: { port, strictPort: true, host: '127.0.0.1' },
}).listen()
```

`build` 命令同理走 `vite.build({ configFile: false, plugins, root, mode })`。

**影响**：

- ✅ 用户工作区里不存在任何 `vite.config.*`；`config/config.yml` 是唯一真相源
- ✅ 添加 `boot: "@maho/boot-react"` 即换框架，零文件迁移
- ✅ CLI 不再 `spawn` 子进程，所有日志 / 错误 / HMR 都直接在主进程里捕获，调试链路最短
- ✅ S4-O5（`node_modules/.bin/vite` 查找）整体作废 —— CLI 直接依赖 `vite` 包
- ⚠️ 用户高级定制场景（如插入自定义 vite 插件）暂无 escape hatch，留待 V2 通过 `plugins:` 配置字段或 `maho.config.ts` 解决
- ⚠️ S4-O2 / S4-O3 / S4-O5 中关于 "spawn vite + 环境变量 dev manifest + bin 解析" 的描述与代码不再成立 —— 本节为最新决策

---

### S4-O12：通用 `BootService` —— 一个 cordis 插件托管任意 boot 包

**原始设计**（design-cordis-services.md 草案中曾出现的 "BootManager / 每框架一个 manager" 思路）：为每个 boot 包（boot-vue / boot-react …）写一个对应的 manager 插件。

**问题**：

1. 框架数量 × manager 数量 = 平方级维护成本；大部分 manager 的逻辑（加载 + 暴露 sharedDeps + 暴露 vite plugins）完全同构。
2. boot 与 vite 是两类完全不同的关注点：boot 决定 web app 在浏览器里如何初始化（与 UI 库强相关，与 vite 无关），其构建侧只需要"该 boot 想在 vite 中预置哪些插件 / shared 哪些依赖"两类信息。
3. 让 manager 与 boot 一一对应，会迫使 `@maho/core` 跟着每个新框架升级；这与"core 不依赖具体框架"的设计目标冲突。

**采用方案**：

1. **`@maho/boot` 新增 `BootBuildAdapter` 接口**（`packages/boot/src/interfaces/BootBuildAdapter.ts`），与 `BootAdapter`（浏览器侧）配对，但放在不同子路径：
   - `@maho/boot`（默认入口）：浏览器运行时 + helpers + 所有类型
   - `@maho/boot/build-adapter`：构建侧契约（不含任何 DOM 代码，Node 端可安全 import）
   - `@maho/boot/types`：类型聚合入口（也不含 DOM），供 vite-plugin / cli 使用

2. **boot 包通过 `${pkg}/build` 子路径暴露构建侧适配器**（如 `packages/boot-vue/src/build.ts`）：

```ts
const vueBuildAdapter: BootBuildAdapter = {
  framework: 'vue',
  sharedDeps: { vue: { singleton: true, ... }, ... },
  getVitePlugins() { return [vue()] },
}
export default vueBuildAdapter
```

3. **`@maho/core` 新增通用 `BootService`**（`packages/core/src/services/boot.ts`），消费 `config.yml` 中的 `boot:` 字段，动态加载 `${boot}/build` 并校验 `BootBuildAdapter` 契约。完全不感知具体框架。

4. **用户配置**：

```yaml
# config/config.yml
role: host
boot: "@maho/boot-vue"     # 换成 @maho/boot-react 即切换框架
```

**影响**：

- ✅ 新增框架只需写 `${pkg}/build` 入口，不动 `@maho/core` / `@maho/cli` 一行代码
- ✅ `@maho/core` 通过 `@maho/boot/build-adapter` 单一类型依赖与 boot 生态耦合，避免拉入 DOM 类型
- ✅ vite-runner 通过 `ctx.boot.sharedDeps` / `ctx.boot.getVitePlugins()` 自然消费，无 framework 分支判断
- ⚠️ `@maho/vite-plugin` 现有的 `bootAdapter: string` 参数（运行时 import 拉 `sharedDeps`）在 vite-runner 路径下被绕过 —— CLI 直接把 `ctx.boot.sharedDeps` 作为 `shared` 传入，避免 vite-plugin 在自己的目录尝试解析用户的 boot 包

---

### S4-O13：BootService 显式 `load()` 而非依赖 cordis `Service.start()`

**问题**：cordis 4.x `Service.start()` 的异步完成时机与 `await ctx.plugin()` 返回时机不同步 —— 即使 await，`start()` 内部的异步副作用未必跑完，此时下游代码访问 `ctx.boot.adapter` 会拿到 `undefined`。

**采用方案**（`packages/core/src/services/boot.ts`）：把 adapter 加载从 `start()` 改为显式公开方法 `load()`，由 `createMahoContext` 在 `await ctx.plugin(BootService, ...)` 之后立即 `await ctx.boot.load()`。与 ConfigService 的 `await ctx.config.load(mode)` 同构。

**影响**：

- ✅ 加载完成的时序与构造调用一一对应，下游无需关心 cordis 生命周期细节
- ✅ 将来添加更多 service 时（如 RouteService / FederationService）可沿用「构造 → load → 暴露」三段式模板

---

### S4-O14：originjs federation 自解析失败 → 注入 `resolveId` 别名插件

**问题**：`@originjs/vite-plugin-federation` 在 `resolveId` 钩子里调用 `this.resolve('@originjs/vite-plugin-federation')` 来定位 `satisfy.mjs`。当 CLI 在 smoke 项目目录下程序化调用 vite 时，子项目自己并不直接依赖 originjs（它来自 `@maho/vite-plugin` 的 transitive dep），rollup 从子项目根目录解析失败，`federationId` 变成 `undefined` → `dirname(undefined)` 抛 TypeError。

**采用方案**（`packages/vite-plugin/src/plugins/federation.ts`）：注入一个高优先级 `resolveId` 插件 `federationSelfResolvePlugin`，用 `createRequire(import.meta.url).resolve()` 从 `@maho/vite-plugin` 自身安装目录（总能解析到 originjs）找到 `index.js` / `satisfy.mjs` 的绝对路径，返回给 rollup。`mahoFederationPlugin` 改为返回 `Plugin[]`，将该自解析插件挂在 federation 之前。

**影响**：

- ✅ smoke / 任何使用 CLI 程序化启动 vite 的工程都不需要把 originjs 加为直接依赖
- ✅ 用户自己写 vite.config.ts 的传统流程同样不受影响（彼时 originjs 在 `node_modules/.pnpm` 中可正常解析）
- ⚠️ 若 `@maho/vite-plugin` 自身的安装路径里也找不到 originjs（罕见），不抛错而是放行，让 originjs 报原始错。

---

### S4-O15：跨域 chunk 解析 —— `base` 设为 remote 的完整 dev URL

**问题**：host 通过 `import('http://127.0.0.1:5174/assets/remoteEntry.js')` 跨域加载 remote 入口，但 expose chunk 内部 Vite 生成的 chunk 引用默认使用 `base: '/'` —— 即绝对路径 `/assets/Home-xxx.js`。浏览器在跨域模块内解析绝对路径时以 **document 所在 origin**（host 的 5173）为基准，导致 JS/CSS 被发往错误的端口。

尝试过的方案及其问题：
1. `base: './'`（相对路径）：使 expose chunk 的引用全部变为 `./Home-xxx.js`（正确解析到 remote），但同时会改变 originjs 在 `remoteEntry.js` 中生成的 import 路径 —— 从 `./__federation_expose_xxx.js` 变成 `./assets/__federation_expose_xxx.js`，导致双写 `assets/assets/`。
2. `build.assetsDir = ''`：把所有 chunk 堆到 dist 根目录 —— 污染输出结构。

**采用方案**（`packages/cli/src/core/vite-runner.ts` `startRemotePreviewServer`）：将 `base` 设为 remote 的完整 dev URL（`http://127.0.0.1:<port>/`）。效果：
- `remoteEntry.js` 中 originjs 生成的 `import('./__federation_expose_xxx.js')` **不受 `base` 影响**（originjs 使用 Rollup `emitFile` fileName 的文本拼接，不走 Vite 的 base 前缀）
- expose chunk 中的 `__vite__mapDeps` 路径通过 `assetsURL(dep)` = `'http://127.0.0.1:5174/' + dep` 拼接出完整 URL，绝对路径直接指向 remote
- expose chunk 内的 `import('./Home-xxx.js')` 是相对路径，浏览器解析到 remote origin

CLI 在构造 `ViteTarget` 时已知端口号（`port-manager` 分配），可在 `viteBuild` 调用点直接拼 base。对用户完全透明 —— `maho dev` 一条命令即可。

**影响**：
- ✅ 所有跨域 chunk 解析自动正确，无需用户理解 Vite `base` / Rollup emitFile / originjs path 拼接的内部机制
- ✅ dev 模式下 base 动态跟随端口分配（端口可能因为占用而偏移）
- ✅ 生产构建（`maho build`）的 `base` 也已支持 —— `MFConfig.federation.base` 字段在 `vite-runner.ts` 的 `runBuild` 中被读取并传入 `viteBuild({ base })`，用户可在 `config/config.yml` 中配置 CDN 路径

---

### S4-O16：remote 改 build + preview 替代纯 dev server

**问题**：`@originjs/vite-plugin-federation` 仅在 `vite build`（Rollup `emitFile` 阶段）生成 `remoteEntry.js`；纯 `vite createServer` 模式下 host 拉 `/remoteEntry.js` 永远 404，导致 host 卡在 loading。

**采用方案**（`packages/cli/src/core/vite-runner.ts`）：把 remote 的 dev 模式从 `createServer()` 改为「先 `viteBuild()` 到 dist/，再 `vitePreview()` 静态托管」。host 仍是标准 `createServer()`，保持 HMR；remote 失去 HMR，改源码需重启 `maho dev`。

**影响**：

- ✅ host 能正常加载远端 federation 入口，链路打通
- ⚠️ remote 无 HMR，开发体验下降 —— V2 通过 `vite.build({ build: { watch: {} } })` + 文件监听重启 preview 来恢复
- ⚠️ 启动顺序变成「remote 先 build → host 再 createServer」，dev.ts 中 `orderedTargets` 显式按此序遍历

---

### S4-O17：smoke demo 用 pinia counter 验证 shared singleton

**问题**：本步骤的 federation/shared 链路需要可观察的运行时验证，仅「两个端口都 200」还不能证明 vue / pinia 等被作为 singleton 跨包共享。

**采用方案**（`examples/smoke/apps/module-home/src/{stores/counter.ts, pages/Counter.vue}`）：在 remote 内放一个 pinia counter，host 通过 federation 路由 `/home/counter` 加载。若 shared singleton 工作正常，host 的 pinia 实例与 counter 的 `defineStore` 共用一份；切到其它路由再回来，计数器值保留。

**影响**：

- ✅ 给 reviewer / 用户一个直观验证 federation 是否真正打通的 case
- ✅ smoke 不再仅靠「端口就绪」判定成功，至少 demo 页面可见、可交互

---

### S4-O18：shareScope 版本键与 getter 结构修复

**问题**（两个独立 bug 叠加）：

1. **版本键使用了 semver range 而非具体版本号**：boot-vue 的 `sharedDeps` 含 `requiredVersion: '^3.4.0'`（semver range），初版 `buildShareScopeSource` 的 fallback 链 `dep.version ?? dep.requiredVersion ?? resolvePackageVersion(...)` 会在无 `version` 时把 `'^3.4.0'` 直接填进 shareScope 的版本键。remote runtime 调用 `satisfy(versionKey, requiredVersion)` —— `satisfy('^3.4.0', '^3.4.0')` 把 range 当 version 用，semver 解析失败。

2. **getter 少了一层箭头**：originjs runtime 的调用模式是 `await (await versionValue.get())()` —— 即 `get` 必须返回一个 factory 函数，而非直接返回 `Promise<Module>`。初版 `get: () => import("vue")` 导致 runtime 对 Module namespace 做函数调用，抛 TypeError。

**采用方案**（`packages/vite-plugin/src/plugins/virtual-config.ts` `buildShareScopeSource`）：

1. 版本键跳过 `requiredVersion`，只从 `dep.version ?? resolvePackageVersion(name, projectRoot)` 取。`resolvePackageVersion` 从 `node_modules/<pkg>/package.json` 读实际安装版本（如 `'2.3.1'`），该 version 可被 `satisfy('2.3.1', '^2.1.0')` 正确匹配。
2. `get` 改为双箭头：`get: () => () => import("vue")` —— 外层给 runtime 调 `get()` 拿到 factory，内层 factory 被 runtime 调用时执行 `import()`。

**影响**：
- ✅ shareScope 版本键（如 `'3.5.35'`）可被 semver 验证，满足 remote 的 `requiredVersion`（`^3.4.0`）
- ✅ 双箭头使 originjs 的 `await (await get())()` 模式正确执行
- ✅ vue / vue-router / pinia 在 host 与 remote 间共用同一实例，`inject(routerKey)` 和 `useCounterStore()` 正常工作

---

### S4-O19：生产构建 target 设为 `esnext`

**问题**：`maho build` 在 `vite-runner.ts` 的 `runBuild` 中未设置 `build.target`，Vite 默认 target（`chrome87` 等）不支持 top-level await。originjs 生成的 shared/expose chunk 大量使用 `await importShared('vue')` 顶层 await，esbuild 转换时直接报错。

**采用方案**（`packages/cli/src/core/vite-runner.ts` `runBuild`）：与 dev 模式的 `startRemotePreviewServer` 保持一致 —— `build: { target: 'esnext', minify: false, sourcemap: true }`。

**影响**：
- ✅ `maho build --all` 全量构建通过（2/2）
- ⚠️ 输出不压缩、target 激进，适合当前 MVP 阶段；V2 按需引入 `build.target` / `build.minify` 的可配置项

---

## Step 5：maho init + maho add + 模板系统

### S5-O1：init 不自动 `install`，打印命令让用户自己跑

**原始设计**（`design-cli.md` §maho init）：`maho init` 末尾自动执行 `pnpm install`（或其他检测到的包管理器）。

**问题**：
1. `install` 耗时 30s–2min，用户看着光标闪不知道在干嘛 —— 体验差
2. init 结束后用户可能想检查生成的文件再 install
3. 跨平台 install 错误处理复杂（Windows pnpm 路径、npm 网络超时），不应阻塞 init 成功
4. 与 `create-vue` / `create-react-app` 社区实践一致

**采用方案**（`packages/cli/src/commands/init.ts`）：渲染模板后打印「Next steps」提示，包含 `cd <dir>` → `<pm> install` → `maho dev` 三步指引。`packageManager` 变量传入模板但仅用于提示文案。

**影响**：
- ✅ init 命令瞬间完成，用户可检查生成文件
- ✅ 安装失败不影响 init 成功
- ✅ 用户可按需使用自己的 `--registry` / `--prefer-offline` 等 npm/pnpm flag

---

### S5-O2：模板加载器先只做内置模板，本地/npm 推迟

**原始设计**（`design-cli.md` §模板加载器）：`loadTemplate(source)` 支持三种来源 —— 内置名（`'host-vue'`）、本地路径（`'./my-template'`）、npm 包（`'@org/maho-template-custom'`）。

**问题**：本地路径和 npm 包模板加载需要完整的模板接口（`MahoTemplate` 含 prompts/transform/postInstall）、npm 包解析（jiti 编译入口）、路径校验等一整套基础设施。但 MVP 阶段用户的实际需求为零 —— 内置 host-vue + remote-vue 已覆盖初始场景。

**采用方案**（`packages/cli/src/template/loader.ts`）：Step 5 仅实现内置模板名查找（`BUILT_IN_META` 字典 + `import.meta.url` 定位模板目录）。非内置名抛 `MahoError('template-not-found', ...)` 并提示可用内置模板列表。

**影响**：
- ✅ 减 200+ 行未来才用的代码
- ✅ 模板接口简化（`MahoTemplate` 仅含 `meta` + `templateDir`，无 prompts/transform/postInstall）
- ⚠️ 错误信息指明内置模板名，方便用户发现当前能力边界

---

### S5-O3：`@inquirer/prompts` 替代 `inquirer`

**原始设计**（`design-mvp.md` §关键技术依赖）：`inquirer@9` 用于交互式问答。

**问题**：inquirer v9 是 CJS 模块，依赖链重（含 `rxjs` 等）。项目是 ESM（`"type": "module"`），CJS 导入需要额外的兼容处理。

**采用方案**：`@inquirer/prompts`（inquirer 作者的官方 ESM 重写版）：
- 同作者、同 API 风格（`input()` / `select()` / `confirm()` 等独立导出函数）
- ESM native，零额外依赖
- Step 5 刚好只需要 `input` / `select` / `confirm` 三个

**影响**：
- ✅ 安装体积从 ~500KB 降到 ~80KB
- ✅ ESM import 无兼容问题
- ⚠️ API 从 `inquirer.prompt([...])` 变为独立函数调用（`await input({...})`），但代码更简洁

---

### S5-O4：仅 Vue 模板，React 推迟到 V2

**原始设计**（`design-cli.md` §内置模板清单）：4 个内置模板 —— `host-vue`、`remote-vue`、`host-react`、`remote-react`。

**问题**：`@maho/boot-react` 未实现，React 模板缺少对应的 `createMahoApp` / 路由适配 / 布局组件，无法在生成后运行。

**采用方案**：Step 5 仅创建 `host-vue` 和 `remote-vue` 两个内置模板。React 模板留到 `@maho/boot-react` 成熟后再添加（V2）。

**影响**：
- ✅ 模板维护量减半
- ✅ 生成的项目可立即运行（依赖已存在的 boot-vue）
- ⚠️ `listBuiltinTemplates()` 返回 `['host-vue', 'remote-vue']`

---

### S5-O5：CLI `main` 保持指向 `src/`，不做 dist 构建

**原始设计**（Step 4 plan §`package.json`）：`"main": "./dist/index.js"`，`"bin": { "maho": "./bin/maho.mjs" }`，bin 入口从 dist 导入。

**问题**：模板 `.ejs` 文件不被 tsc 处理，dist 构建需要额外脚本将 `src/template/built-in/**/*.ejs` 复制到 `dist/template/built-in/`。当前没有这个复制步骤，dist 下的 loader 会找不到模板目录。

**采用方案**：CLI 的 `package.json` 已设 `"main": "./src/index.ts"`，运行时通过 `jiti` 直接跑 ts 源码。模板路径基于 `import.meta.url`（`src/template/built-in/`）。dist 构建推迟到 V1 发布前统一处理，届时一并写 `.ejs` 复制脚本。

**影响**：
- ✅ 开发期 (`pnpm exec jiti ...`) 模板正常加载
- ✅ 不需要额外维护 .ejs 复制脚本
- ⚠️ 发布到 npm 前必须完成 dist 构建 + .ejs 搬运

---

### S5-O6：`maho add` 的 workspace 注册仅处理 pnpm

**原始设计**（`design-cli.md` §maho add）：`maho add` 自动注册子包到 workspace 配置。

**问题**：npm/yarn workspaces 的注册机制与 pnpm 不同 —— npm 用 `package.json` 的 `workspaces` 字段，yarn 用 `package.json` 的 `workspaces` 字段但格式略有差异。三者的 workspace glob 语法不完全一致。

**采用方案**（`packages/cli/src/commands/add.ts` `registerToWorkspace`）：仅处理 `pnpm-workspace.yaml`（当前 Maho 生态唯一使用的 workspace 管理方式）。若文件不存在（非 pnpm 项目），静默跳过。npm/yarn 注册逻辑推迟到真正需要时。

**影响**：
- ✅ pnpm 用户开箱即用（`maho add` → 自动追加到 `pnpm-workspace.yaml`）
- ⚠️ npm/yarn 用户需手动注册子包到 workspace（错误信息可后续改进）

---

## M6：测试体系 + V1 打磨

> M6 为 7 个包补齐了单元测试基础设施，同时处理了 V1 遗留的打磨项。

### M6-O1：Vitest 双环境配置 —— node + jsdom

**原始设计**：无测试体系。

**采用方案**：两个 vitest 配置文件覆盖不同运行环境：

- `vitest.node.config.ts`：`environment: 'node'`，覆盖 core / cli / boot 的纯逻辑测试。排除 boot-vue（需要完整 Vue runtime）。
- `vitest.browser.config.ts`：`environment: 'jsdom'`，覆盖需要 DOM API 的测试（loading.ts、boot-vue 组件）。

`vitest@^2.x` 与项目现有的 Vite 5 兼容（vitest 3.x+ 要求 Vite 6+）。

**影响**：
- ✅ 145 个测试覆盖 19 个文件，全部通过
- ✅ 测试与 typecheck 解耦（测试文件不进 tsc 编译矩阵，避免 mock 类型噪音）
- ✅ `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` 三条命令即可开发

---

### M6-O2：测试文件与源码同目录

**原始设想**（部分测试指南）：`__tests__/` 独立目录。

**采用方案**：测试文件放在被测文件的同目录下（`foo.test.ts` 紧邻 `foo.ts`），理由：
1. 导入路径最短（`./foo.js` 而非 `../../src/foo.js`）
2. 删除/移动源码时测试同步消失，避免孤儿测试
3. vitest 默认 include 模式 `*.test.ts` 无需额外配置

**影响**：
- ✅ 所有测试 import 使用相对路径 `'./xxx.js'`
- ✅ 新增/删除模块时测试文件物理邻近，减少遗忘

---

### M6-O3：`vi.mock` 工厂函数的闭包限制

**发现**：vitest 的 `vi.mock` 调用在编译期被 hoist 到文件顶部，早于所有 `import` 语句。这意味着 mock 工厂函数内**不能引用任何外部 import 的变量**（如 `EventEmitter`、路径常量等），否则在 hoist 后的执行时机中变量尚未初始化。

**采用方案**：
1. 需要 mock 的依赖使用模块级可变状态（`let` 变量在 `vi.mock` 工厂外声明，工厂内闭包捕获）
2. 不需要复杂逻辑的 mock 使用内联对象字面量（如 `port-manager.test.ts` 中的 `createServer` mock）
3. `vi.stubGlobal` / `vi.stubEnv` 用于注入全局变量（`document`、`process.env`）

**影响**：
- ✅ `port-manager.test.ts` 的 mock 策略从「依赖 EventEmitter」改为「纯对象 + 模块级回调数组」
- ✅ 测试文件编写规范：mock 工厂保持自包含

---

### M6-O4：`MahoError.code` vs `message` 的差异

**发现**：`MahoError` 将错误码存储在 `code` 属性上，而 `message` 是独立的友好文案。vitest 的 `toThrow('string')` 断言检查的是 `error.message` 属性，而非 `error.code`。

**采用方案**：测试中使用正则 `/pattern/` 匹配 `message` 文本来验证错误类型，而非直接匹配 `code`。

**影响**：
- ✅ `topology.test.ts`：`toThrow(/Run "maho build"/)` 而非 `toThrow('wrong-directory')`
- ✅ `loader.test.ts`：`toThrow(/template-not-found|Template.*not found/)` 覆盖两种文案

---

### M6-O5：S4-O15 生产构建 base 路径补齐

**问题**：`maho build` 的生产构建未读取 `federation.base` 配置，输出的 chunk 引用使用默认的 `/` base 路径。若用户将构建产物部署到 CDN（如 `https://cdn.example.com/my-app/`），所有资源路径将错误。

**采用方案**：
1. `MFConfig.federation` 新增 `base?: string` 字段（`packages/core/src/interfaces/MFConfig.ts`）
2. `vite-runner.ts` 的 `runBuild` 从 `ctx.config.resolved.federation?.base` 读取并传入 `viteBuild({ base })`

```yaml
# config/config.yml
federation:
  base: "https://cdn.example.com/my-app/"
```

**影响**：
- ✅ 用户可在 config YAML 中声明生产构建的 public base 路径
- ✅ CLI 零额外参数，配置即声明
- ✅ dev 模式的 base 仍由 `startRemotePreviewServer` 动态计算（端口分配），不受影响

---

### M6-O6：测试覆盖目标与缺口

**已完成覆盖（19 文件，145 测试）：**

| 包 | 文件 | 测试数 | 难度 |
|---|---|---|---|
| core | merge.test.ts | 19 | 纯函数 |
| core | config-validator.test.ts | 18 | 轻 mock |
| core | env.test.ts | 10 | fs mock |
| core | yaml.test.ts | 8 | fs mock |
| core | mode.test.ts | 5 | cordis mock |
| boot | route-merger.test.ts | 17 | 纯函数 |
| boot | registry.test.ts | 7 | 零 mock |
| boot | layout.test.ts | 9 | registry mock |
| boot | loading.test.ts | 5 | DOM mock |
| boot | routeName.test.ts | 3 | 纯函数 |
| boot | defineLayouts.test.ts | 3 | 纯函数 |
| boot | defineModuleRoutes.test.ts | 2 | 纯函数 |
| boot | defineMFMeta.test.ts | 1 | 纯函数 |
| cli | detector.test.ts | 8 | fs mock |
| cli | topology.test.ts | 9 | workspace mock |
| cli | errors.test.ts | 4 | 零 mock |
| cli | port-manager.test.ts | 6 | net mock |
| cli | loader.test.ts | 5 | fs mock |
| cli | renderer.test.ts | 6 | 真实临时目录 |

**有意推迟的测试（ROI 低 / 需要复杂集成环境）：**

| 模块 | 原因 |
|---|---|
| vite-plugin 全部 | 需要真实 Vite 构建，ROI 低 |
| boot-vue 组件 | 需要 @vue/test-utils + 完整 Vue runtime |
| federation.ts | 需要 mock fetch + 动态 import + share scope |
| route-collect.ts | 依赖 federation 返回值 |
| workspace.ts | 需要真实临时目录 + createMahoContext mock |
| config.service.ts | 依赖 yaml/env/validate 全部 mock |
| boot.service.ts | 依赖 jiti 动态 import mock |
| createMahoContext.ts | 依赖所有 service 初始化 |
| pipeline.ts | 需要真实浏览器/MF runtime |

---

## 待跟踪事项（V2）
