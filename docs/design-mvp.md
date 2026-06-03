# Maho V1 MVP 实现计划

> 本文档涵盖：V1 范围定义、包边界与依赖关系、实现顺序、各阶段里程碑、验收标准、V2 规划。

---

## 目录

1. [V1 范围定义](#v1-范围定义)
2. [包清单与边界](#包清单与边界)
3. [包间依赖关系](#包间依赖关系)
4. [实现顺序](#实现顺序)
5. [各阶段详细计划](#各阶段详细计划)
6. [验收标准](#验收标准)
7. [关键技术依赖](#关键技术依赖)
8. [风险与对策](#风险与对策)
9. [V2 规划](#v2-规划)
10. [里程碑总览](#里程碑总览)

---

## V1 范围定义

### 包含

| 能力 | 所属包 | 优先级 |
|---|---|---|
| Boot 协议层 + 运行时 pipeline | `@maho/boot` | P0 |
| Vue 适配（vue-router + pinia）| `@maho/boot-vue` | P0 |
| 联邦加载（静态 remotes + manifestUrl）| `@maho/boot` | P0 |
| 路由收集与合并（prefix + priority + 子树替换）| `@maho/boot` | P0 |
| 多布局系统（含联邦布局懒加载）| `@maho/boot-vue` | P0 |
| 全局 Loading（HTML 注入 + Boot 时序控制）| `@maho/vite-plugin` + `@maho/boot` | P0 |
| `virtual:maho-config` 桥 | `@maho/vite-plugin` | P0 |
| 共享依赖由 boot-vue 统一声明 | `@maho/boot-vue` + `@maho/vite-plugin` | P0 |
| CSS Modules 强制开启 | `@maho/vite-plugin` | P1 |
| YAML 配置 + 多 mode 分层合并 | `@maho/core` | P1 |
| Cordis 服务体系（ConfigService 等）| `@maho/core` | P1 |
| 跨模块类型注册表自动生成 | `@maho/core` | P1 |
| `mf-routes.ts` 协议（defineModuleRoutes）| `@maho/boot` | P0 |
| `mf-meta.ts` 协议（defineMFMeta）| `@maho/boot` | P1 |
| remoteEntry 失败跳过 + 重试 | `@maho/boot` | P1 |
| CLI：init / add / dev / build | `@maho/cli` | P1 |
| 内置模板：host-vue / remote-vue | `@maho/cli` | P1 |
| 进程管理器（dev 多进程）| `@maho/cli` | P1 |
| 版本漂移检测（dev 模式 warn）| `@maho/boot` | P2 |
| 模板插件系统（本地 / npm 模板）| `@maho/cli` | P2 |

### 不包含（V2）

| 能力 | 原因 |
|---|---|
| React 适配（`@maho/boot-react`）| V1 聚焦 Vue，React 适配接口已设计好，实现可并行 |
| Devtools（`@maho/devtools`）| 独立迭代，不影响核心流程 |
| 独立脚手架（`@maho/create`）| V1 用 `maho init` 代替 |
| 权限工具包（`@maho/auth`）| 可选包，用户自行实现守卫 |
| 灰度发布 / manifest 热更新 | 部署层能力，V2 完善 |
| HMR 跨模块消息通道 | 复杂度高，收益有限 |

---

## 包清单与边界

### `@maho/boot`

**职责**：框架无关的运行时核心，Boot 协议层。

```
对外导出：
  - runBootPipeline()          启动流水线
  - loadFederation()           联邦加载
  - collectRoutes()            路由收集
  - RouteMerger                路由合并算法
  - defineModuleRoutes()       子包路由声明辅助
  - defineMFMeta()             子包元数据声明辅助
  - defineLayouts()            布局映射辅助
  - routeName()                跨模块路由名辅助

类型导出：
  - BootAdapter<TApp, TRouter> 适配层协议接口
  - MahoOptions                createMahoApp 入参类型
  - MahoRoute                  规范路由格式
  - MahoRouteMeta              路由元数据（可声明合并扩展）
  - RouteInterceptor           路由拦截器类型
  - MahoStaticConfig           virtual:maho-config 内容类型
  - ModuleRegistry             mf.load() 注册表（可声明合并扩展）
  - MFMeta                     子包元数据类型

不依赖：任何 UI 框架、Vite、Node.js 专有 API
运行环境：浏览器（及 Node.js 测试环境）
```

### `@maho/boot-vue`

**职责**：Vue 生态的 Boot 适配实现。

```
对外导出：
  - createMahoApp()            Vue 应用创建入口（对外唯一 API）
  - sharedDeps                 Vue 生态共享依赖声明
  - LayoutOutlet               布局出口组件
  - useMenu()                  响应式菜单 composable
  - useUserStore()             用户状态 store（Pinia）

重新导出（透传 @maho/boot 的常用工具）：
  - defineModuleRoutes
  - defineLayouts
  - routeName
  - RouteInterceptor 等类型

依赖：@maho/boot, vue, vue-router, pinia
运行环境：浏览器
```

### `@maho/vite-plugin`

**职责**：Vite 构建层的插件集合，桥接 Cordis 配置和 Boot 运行时。

```
对外导出：
  - maho()                     主插件入口，按角色自动组合子插件

内部子插件：
  - mahoFederationPlugin       federation 构建配置生成
  - mahoVirtualConfigPlugin    virtual:maho-config 虚拟模块
  - mahoCSSModulesPlugin       CSS Modules 强制开启
  - mahoLoadingPlugin          HTML 模板注入全局 Loading
  - mahoSharedDepsPlugin       从 boot-xxx 读取共享依赖

依赖：@maho/core（可选，dev 模式），vite，@originjs/vite-plugin-federation
运行环境：Node.js（Vite 构建期）
```

### `@maho/core`

**职责**：Cordis 构建侧服务体系，管理配置、构建流水线和插件生命周期。

```
对外导出：
  - MFContext                  Cordis Context 扩展
  - definePlugin()             插件定义辅助

内部服务（通过 ctx.xxx 访问）：
  - ctx.config                 ConfigService
  - ctx.mode                   ModeService
  - ctx.watch                  WatchService
  - ctx.vite                   ViteService
  - ctx.routes                 RouteService
  - ctx.federation             FederationService
  - ctx.types                  TypeService
  - ctx.devPipeline            DevPipelineService
  - ctx.buildPipeline          BuildPipelineService

依赖：cordis，@maho/boot（类型），@maho/vite-plugin
运行环境：Node.js
```

### `@maho/cli`

**职责**：命令行工具，提供 init / add / dev / build 命令。

```
命令：
  maho init [name]
  maho add [name]
  maho dev [--filter] [--host-only]
  maho build [--filter] [--all] [--mode]

依赖：@maho/core，@maho/boot（类型），commander，inquirer，chalk，ejs，chokidar
运行环境：Node.js
```

---

## 包间依赖关系

```
                    ┌─────────────────┐
                    │   @maho/boot    │  (无框架依赖)
                    └────────┬────────┘
                             │ implements BootAdapter
              ┌──────────────┴──────────────┐
              │                             │
   ┌──────────▼──────────┐      ┌──────────▼──────────┐
   │   @maho/boot-vue    │      │  @maho/boot-react   │
   │  (Vue + Pinia)      │      │  (React + Zustand)  │
   └─────────────────────┘      └─────────────────────┘ (V2)

   ┌─────────────────────────────────────────────────┐
   │              @maho/vite-plugin                  │
   │  (读取 @maho/core 配置，生成 Vite 插件)           │
   └──────────────────────┬──────────────────────────┘
                          │ 依赖
   ┌──────────────────────▼──────────────────────────┐
   │                  @maho/core                     │
   │  (Cordis 服务体系 + 构建流水线)                   │
   └──────────────────────┬──────────────────────────┘
                          │ 调用
   ┌──────────────────────▼──────────────────────────┐
   │                  @maho/cli                      │
   │  (命令行工具，调度 @maho/core 执行)               │
   └─────────────────────────────────────────────────┘
```

---

## 实现顺序

采用**从运行时往构建侧推进**的策略，每一步都有可独立验证的产出。

```
Step 1  @maho/boot + @maho/boot-vue
        先跑通浏览器运行时，不依赖 Cordis

Step 2  @maho/vite-plugin
        virtual:maho-config + CSS Modules + 类型注册表

Step 3  @maho/core
        Cordis 服务接管配置解析和构建流程

Step 4  @maho/cli
        init / dev / build，依赖前三步全部就绪
```

---

## 各阶段详细计划

### Step 1：`@maho/boot` + `@maho/boot-vue`

**目标**：不依赖任何构建工具，能在浏览器里加载 remote、合并路由、渲染页面。

#### `@maho/boot` 实现清单

```
interfaces/
  ✅ BootAdapter.ts
  ✅ MahoRoute.ts + MahoRouteMeta.ts
  ✅ RouteInterceptor.ts
  ✅ LayoutConfig.ts
  ✅ MahoStaticConfig.ts
  ✅ MFMeta.ts
  ✅ ModuleRegistry.ts（空接口，等待 registry.d.ts 扩展）

core/
  ✅ pipeline.ts          runBootPipeline（10 步流水线）
  ✅ federation.ts        loadFederation / collectRoutes / loadSingleRemote
  ✅ route-merger.ts      RouteMerger（展平 → 竞争 → 重组树）
  ✅ layout.ts            resolveLayout（三种来源的解析逻辑）
  ✅ loading.ts           MahoLoading（show/hide）

helpers/
  ✅ defineModuleRoutes.ts
  ✅ defineMFMeta.ts
  ✅ defineLayouts.ts
  ✅ routeName.ts
```

**阶段验收**：单测覆盖 RouteMerger 的所有 case（无冲突 / priority 竞争 / 子树替换 / 孤儿节点）。

#### `@maho/boot-vue` 实现清单

```
adapter.ts
  ✅ convertRoutes()      MahoRoute → RouteRecordRaw，含 defineAsyncComponent 包装
  ✅ createRouter()       createWebHistory 路由器
  ✅ applyInterceptors()  beforeEach 串行执行拦截器链
  ✅ applyLayouts()       provide/inject 注入布局映射
  ✅ createApp()          createApp + pinia + router
  ✅ mount()
  ✅ waitForFirstRender() router.isReady()

components/
  ✅ LayoutOutlet.vue     Suspense + component :is + RouterView
  ✅ MahoRemoteError.vue  组件加载失败展示
  ✅ MahoRemoteLoading.vue 组件加载中占位

index.ts
  ✅ createMahoApp()      runBootPipeline(options, vueAdapter)
  ✅ sharedDeps           Vue 生态共享依赖声明
  ✅ useMenu()            响应式菜单 composable
  ✅ 重新导出 @maho/boot 常用工具
```

**阶段验收**：用硬编码的 remoteEntry URL 和配置，能在浏览器中完成：加载 remote → 合并路由 → 渲染页面 → 布局切换 → 拦截器执行。

---

### Step 2：`@maho/vite-plugin`

**目标**：提供 Vite 插件集合，使 `createMahoApp` 能通过 `virtual:maho-config` 获取配置，并完成构建时的类型生成。

#### 实现清单

```
plugins/
  ✅ virtual-config.ts    virtual:maho-config 虚拟模块（dev 热更新 + prod 静态）
  ✅ federation.ts        mahoFederationPlugin（host/remote 两种角色配置）
  ✅ shared-deps.ts       从 boot-xxx 读取 sharedDeps 并注入 federation
  ✅ css-modules.ts       强制开启 CSS Modules（cssModules scoped name 规范）
  ✅ loading.ts           HTML 模板注入全局 Loading（spinner + CSS 动画）
  ✅ types.ts             触发 TypeService.syncRegistry / emitDeclarations

index.ts
  ✅ maho()               主入口，按 role 自动组合子插件
```

**阶段验收**：

```
1. 子包 maho build → dist/ 包含 remoteEntry.js 和 dist/types/*.d.ts
2. Host maho build → dist/ 包含正确的 federation 配置
3. virtual:maho-config 在 dev 模式下包含 localhost 地址
4. virtual:maho-config 在 prod 模式下包含 CDN 地址
5. .maho/registry.d.ts 正确生成，mf.load() 类型推导正常
```

---

### Step 3：`@maho/core`

**目标**：用 Cordis 服务体系接管配置解析和构建编排，替换 Step 2 中的硬编码配置读取。

#### 实现清单

```
services/
  ✅ config.ts         ConfigService（YAML 读取 + 多 mode 合并 + Devtools 回写）
  ✅ mode.ts           ModeService
  ✅ watch.ts          WatchService（chokidar 监听 config/ 目录）
  ✅ vite.ts           ViteService（dev server + build）
  ✅ routes.ts         RouteService（inline 子包路由扫描）
  ✅ federation.ts     FederationService（manifest 解析）
  ✅ types.ts          TypeService（注册表生成 + .d.ts 输出）

pipelines/
  ✅ dev.ts            DevPipelineService（dev 全流程编排）
  ✅ build.ts          BuildPipelineService（build 全流程编排）

context.ts
  ✅ MFContext          扩展 Cordis Context，注册所有服务类型

utils/
  ✅ yaml.ts           YAML 解析（!env / !env? / !mergeArray 自定义 tag）
  ✅ merge.ts          deepMerge + mergeArray 工具
  ✅ config-validator.ts 配置 Schema 验证
  ✅ plugin-loader.ts  本地 TS 插件加载（jiti）
```

**阶段验收**：

```
1. maho dev（通过 Cordis Context 启动）与 Step 2 行为完全一致
2. config.dev.yml 变更后，federation / routes 精确热重载
3. config 验证失败时，输出清晰的错误信息并拒绝启动
4. 本地 TS 插件通过 jiti 正确加载并执行
```

---

### Step 4：`@maho/cli`

**目标**：提供开发者可直接使用的命令行工具，完成工作区初始化和日常开发构建。

#### 实现清单

```
commands/
  ✅ init.ts           工作区初始化（交互 + 模板渲染 + 依赖安装）
  ✅ add.ts            子包新建（交互 + 模板 + workspace 注册）
  ✅ dev.ts            多进程启动 + dev manifest 注入
  ✅ build.ts          拓扑顺序构建（并行 remote + 串行 host）

core/
  ✅ context.ts        WorkspaceContext（工作区探测）
  ✅ detector.ts       包管理器检测
  ✅ process-manager.ts 多进程管理（启动 / 输出前缀 / 就绪检测 / 优雅退出）
  ✅ port-manager.ts   端口自动分配

template/
  ✅ loader.ts         模板加载（内置 / 本地 / npm）
  ✅ renderer.ts       EJS 渲染
  built-in/
    ✅ host-vue/       Vue Host 内置模板
    ✅ remote-vue/     Vue Remote 内置模板

utils/
  ✅ logger.ts         彩色日志
  ✅ prompt.ts         交互式问答
  ✅ errors.ts         MahoError 类型体系
```

**阶段验收**：

```
1. maho init my-app → 完整工作区生成 + pnpm install 成功
2. maho add module-order → apps/module-order 正确生成 + workspace 注册
3. maho dev --filter order,user → 三个进程并行启动，带前缀日志输出
4. maho build --all → remote 并行构建 + host 串行构建，输出摘要
5. 在 apps/module-order 目录下 maho dev → 自动委托到根目录
```

---

## 验收标准

### 功能验收

```
Federation
  ✅ 静态 remotes 配置，remoteEntry 并行加载
  ✅ 动态 manifestUrl，与静态配置合并（动态优先）
  ✅ 单个 remoteEntry 失败，跳过该模块，其余正常运行
  ✅ 重试机制（最多 3 次，间隔递增）

路由
  ✅ prefix 默认取模块名，支持自定义
  ✅ priority 相同 path 竞争，高优先级整棵子树胜出
  ✅ 相同 priority 时 warn + 按加载顺序取最后一个
  ✅ 父节点无冲突但子节点有冲突，孤儿节点正确挂载
  ✅ mf-routes 加载失败，路由跳过，不阻断启动

布局
  ✅ meta.layout 指向本地组件，同步渲染
  ✅ meta.layout 指向懒加载函数，Suspense fallback 展示
  ✅ meta.layout 指向联邦路径，运行时加载后渲染
  ✅ 找不到 layout ID，降级使用 default + warn

Loading
  ✅ HTML 模板中 Loading 先于框架 JS 展示
  ✅ 首屏路由渲染完成后 Loading 淡出消失
  ✅ 自定义 loading.html / background / color 生效

配置
  ✅ config.yml + config.dev.yml 深合并
  ✅ !env 必填变量未设置时启动报错
  ✅ !env? 可选变量未设置时返回 null
  ✅ !mergeArray 数组追加，普通数组替换
  ✅ config.local.yml 存在时优先级最高

类型系统
  ✅ maho build 生成 dist/types/*.d.ts
  ✅ npm install 后 .maho/registry.d.ts 自动生成
  ✅ mf.load('module-order/utils/formatters') 类型正确推导
  ✅ 未注册路径退化为 any

共享依赖
  ✅ boot-vue 的 sharedDeps 自动注入 host 和所有 remote
  ✅ 子包无需声明 vue / vue-router / pinia
  ✅ 自定义追加共享依赖生效

CSS
  ✅ 子包手写样式自动开启 CSS Modules
  ✅ 生成的 class 名包含 hash，避免全局污染
```

### 性能验收

```
Dev 启动
  □ 冷启动（3 个子包）< 5s
  □ config 热重载 < 500ms

Build
  □ 单个 remote 构建 < 30s
  □ --all（3 个 remote + host）< 2min

运行时
  □ 首屏 remoteEntry 并行加载，总耗时 = max(各 remote) 而非 sum
  □ 布局懒加载使用 Suspense，不阻塞主线程
```

### DX 验收

```
  □ maho init 到第一个页面渲染 < 3 分钟
  □ 新增子包（maho add）到可在 Host 中访问 < 2 分钟
  □ TypeScript 报错信息指向具体字段，不是泛型报错
  □ 配置验证失败时，错误信息包含字段路径和修复提示
```

---

## 关键技术依赖

| 依赖 | 版本 | 用途 | 备注 |
|---|---|---|---|
| `cordis` | `^3.x` | 构建侧元框架 | 仅 Node.js 侧 |
| `vite` | `^5.x` | 构建工具 | peerDependency |
| `@originjs/vite-plugin-federation` | `^1.x` | Module Federation 实现 | 核心构建依赖 |
| `vue` | `^3.4` | UI 框架（boot-vue）| peerDependency |
| `vue-router` | `^4.3` | 路由（boot-vue）| peerDependency |
| `pinia` | `^2.1` | 状态管理（boot-vue）| peerDependency |
| `js-yaml` | `^4.x` | YAML 解析 | 自定义 tag 支持 |
| `jiti` | `^2.x` | 运行时 TS 编译 | 本地插件加载 |
| `vite-plugin-dts` | `^3.x` | .d.ts 生成 | TypeService |
| `chokidar` | `^3.x` | 文件监听 | WatchService |
| `commander` | `^12.x` | CLI 参数解析 | @maho/cli |
| `inquirer` | `^9.x` | 交互式问答 | @maho/cli |
| `chalk` | `^5.x` | 终端颜色 | @maho/cli |
| `ejs` | `^3.x` | 模板渲染 | @maho/cli |

---

## 风险与对策

### R1：`@originjs/vite-plugin-federation` 的局限

**风险**：该插件在某些场景下（如 SSR、热更新）存在已知问题，可能影响 dev 体验。

**对策**：
- V1 明确不支持 SSR（文档注明）
- 封装一层 `mahoFederationPlugin`，将底层实现隐藏在 Maho 内部
- 若底层插件无法满足需求，可替换为 `@module-federation/vite` 等替代方案，用户无感知

### R2：共享依赖版本协商的边界情况

**风险**：多个 remote 使用不同 minor 版本的 vue（如 3.4.0 vs 3.5.0），singleton 机制降级行为不可预测。

**对策**：
- `requiredVersion` 使用宽松范围（`^3.4.0`）允许 patch/minor 兼容
- dev 模式下输出共享依赖协商日志，便于排查
- 文档明确说明：所有子包应与 Host 使用相同 minor 版本的框架

### R3：YAML 配置的 TypeScript 类型覆盖

**风险**：YAML 是弱类型的，插件扩展的 `MFConfig` 字段在运行时无法强制约束。

**对策**：
- `ConfigService` 在加载后执行 Schema 验证，捕获拼写错误等常见问题
- 插件可声明自己的 zod schema，框架统一调用验证
- 提供 VS Code 插件（V2）支持 YAML 文件的类型提示

### R4：`jiti` 加载本地插件的兼容性

**风险**：本地插件使用了 jiti 暂不支持的语法（如某些装饰器）。

**对策**：
- 文档说明插件的语法限制（ES2022 + TypeScript 5.x）
- `dev` 模式禁用 jiti 缓存，支持即时修改即时生效
- 后备方案：用户可预先用 `tsx` 编译为 JS，再引用 JS 文件

---

## V2 规划

### `@maho/boot-react`

React 适配层，复用 `@maho/boot` 的全部协议和 pipeline。

```
实现重点：
  - convertRoutes: MahoRoute → react-router RouteObject（lazy + Suspense）
  - applyInterceptors: loader 函数模式的守卫
  - createApp: ReactDOM.createRoot
  - sharedDeps: react + react-dom + react-router-dom + zustand
  - LayoutOutlet: React 版布局出口组件
```

### `@maho/devtools`

参考 Koishi Console 实现，Cordis 插件形式注入。

```
功能规划：
  - 配置面板（Base / Current / Merged 三层视图，可视化编辑回写）
  - 路由面板（合并结果可视化，冲突报告）
  - 联邦面板（remote 加载状态、耗时、版本信息）
  - 依赖面板（共享依赖版本协商结果）
  - 插件面板（Cordis 服务依赖图）

技术栈：
  - 服务端：Cordis 插件 + WebSocket（@maho/devtools-server）
  - 前端：本身就是一个 Maho 应用（自举验证框架能力）
```

### `@maho/auth`

可选的权限工具包，不绑定任何状态库。

```
提供：
  - createPermissionGuard()   生成权限拦截器
  - createAuthGuard()         生成登录检查拦截器
  - 与 Pinia / Zustand 的集成示例
```

### `@maho/create`

独立脚手架，不需要在项目中安装 Maho 即可使用。

```bash
npm create maho@latest my-app
# 等价于 npx @maho/create my-app
```

---

## 里程碑总览

```
M1  @maho/boot + @maho/boot-vue 核心可用
    验收：浏览器可以加载 remote，合并路由，渲染页面

M2  @maho/vite-plugin 接入
    验收：maho build 输出正确的联邦产物和类型声明

M3  @maho/core Cordis 服务体系
    验收：配置系统和构建流水线完整运行

M4  @maho/cli 工具可用
    验收：maho init → maho dev → maho build 全流程跑通

M5  V1 Feature Complete
    验收：所有 P0 / P1 功能通过验收标准

M6  V1 Release
    - 完整文档网站
    - 内置模板（host-vue / remote-vue）完善
    - 单测覆盖率 > 80%（核心模块）
    - 示例仓库（monorepo 结构，3 个子包）

── V2 迭代 ────────────────────────────────────

M7  @maho/boot-react
M8  @maho/devtools（参考 Koishi Console）
M9  @maho/create 独立脚手架
M10 @maho/auth 可选权限工具包
```

---

*文档系列完结。设计文档索引详见 [maho-overview.md](./maho-overview.md)。*
