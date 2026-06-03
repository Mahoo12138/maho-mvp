# Maho 框架设计概览

> **Maho**（魔法）—— 基于 Vite 和 Cordis 的模块联邦微前端框架，以魔法之名颠覆 Web 开发。

---

## 目录

1. [设计哲学](#设计哲学)
2. [核心概念](#核心概念)
3. [包生态结构](#包生态结构)
4. [整体架构](#整体架构)
5. [构建模式](#构建模式)
6. [配置系统](#配置系统)
7. [模块联邦](#模块联邦)
8. [路由系统](#路由系统)
9. [Boot 体系](#boot-体系)
10. [CLI](#cli)
11. [Devtools](#devtools)
12. [V1 MVP 边界](#v1-mvp-边界)

---

## 设计哲学

Maho 围绕三个核心原则构建：

**配置即契约**
`config/config.yml` 是用户与框架的唯一接触面。Vite 配置是框架的内部产物，用户不感知、不维护。所有环境差异通过配置分层表达，不允许在配置文件中编写代码逻辑。

**插件平权**
官方插件（`mf-federation`、`mf-router`）与用户插件使用完全相同的 API，官方插件没有任何特权。用户可以 fork 任意官方插件局部修改，无需等待框架发版。

**IoC 替换优于 fork**
框架内部每个有意义的模块都通过 Cordis 的服务容器注册，替换是一等公民。换掉路由合并器和换掉一个工具函数的成本相同。

---

## 核心概念

### Host（父包）

应用的入口，提供 Shell 布局、全局路由容器。负责：

- 启动 Maho 应用（`createMahoApp`）
- 声明联邦远端配置（哪些 Remote 参与联邦）
- 提供默认布局组件
- 导出全局共享依赖

物理位置：Monorepo **根目录** 的 `src/` 即为 Host 源码。

### Remote（子包）

业务功能模块，独立开发、独立部署。负责：

- 声明自身路由（`mf-routes.ts`）
- 暴露页面、组件、工具库（`exposes`）
- 构建为独立的 `remoteEntry.js` 发布到 CDN

物理位置：Monorepo `apps/` 目录下每个子目录为一个 Remote。

### Boot

浏览器运行时引导层。负责：

- 加载所有 `remoteEntry.js`
- 收集并合并各模块路由
- 创建框架路由器、挂载应用
- 提供路由拦截钩子

Boot **不包含**任何业务概念（用户状态、权限逻辑、UI 组件）。
具体实现由 `@maho/boot-vue`、`@maho/boot-react` 等适配包提供。

### Cordis

构建侧的元框架，管理所有构建期逻辑。负责：

- 读取、解析、合并配置文件
- 编排构建流水线（Vite dev server / build）
- 管理插件生命周期
- 向 Boot 注入静态配置（通过 `virtual:maho-config`）

Cordis **不进入浏览器**，仅运行在 Node.js 侧。

---

## 包生态结构

```
@maho/core              Cordis 服务体系（构建侧核心）
@maho/boot              Boot 协议层 + 运行时纯逻辑
@maho/boot-vue          Vue 适配实现
@maho/boot-react        React 适配实现（V2）
@maho/vite-plugin       Vite 插件集合
@maho/cli               命令行工具
@maho/create            独立脚手架（V2）
@maho/devtools          Devtools 服务（V2）
@maho/devtools-ui       Devtools 页面（V2）
@maho/auth              可选权限工具包（V2）
```

### 依赖关系

```
用户代码（app.ts）
    └── @maho/boot-vue
            ├── @maho/boot（协议 + pipeline）
            └── vue / vue-router / pinia

构建侧（Cordis Context）
    └── @maho/core
            ├── @maho/vite-plugin
            └── cordis

CLI
    └── @maho/cli
            └── @maho/core
```

---

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                  用户配置层                           │
│            config/config.yml                         │
│        config.dev.yml / config.prod.yml              │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│              Cordis 构建层（Node.js）                 │
│  ConfigService → ViteService → RouteService          │
│  FederationService → TypeService → Pipeline          │
│                   │                                  │
│         生成 virtual:maho-config                      │
└──────────────────┬──────────────────────────────────┘
                   │ Vite 构建产物
┌──────────────────▼──────────────────────────────────┐
│             Boot 运行时层（Browser）                  │
│  loadFederation → collectRoutes → mergeRoutes        │
│  createRouter → applyLayouts → mount                 │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│              运行中的应用                             │
│  Host Shell + 动态加载的 Remote 页面                 │
└─────────────────────────────────────────────────────┘
```

---

## 构建模式

每个子包都有独立的构建模式声明，在 `config.yml` 中配置。

| 模式 | 声明方 | 产物 | 运行时行为 |
|---|---|---|---|
| `remote` | 子包 | 独立 `remoteEntry.js` | 运行时动态加载 |
| `inline` | 子包 | 无独立产物，并入 Host | 编译时内联，同步加载 |
| `host:federation` | Host | Shell bundle | 动态加载所有 Remote |
| `host:monolith` | Host | 单体 bundle | 包含选定 inline 子包 |

Host 每次构建都会输出共享依赖（由 `@maho/boot-vue` 等适配包统一声明），保持全局单例。

---

## 配置系统

### 目录结构

```
config/
  config.yml          基础配置（所有 mode 生效）
  config.dev.yml      dev mode 覆盖
  config.prod.yml     生产 mode 覆盖
  config.staging.yml  自定义 mode（用户自由扩展）
.env                  所有 mode 共用的敏感值
.env.dev              dev 专用敏感值（不提交 git）
```

### 合并策略

```
config.yml（base）
    + config.{mode}.yml（override，深合并）
    ——————————————————————————
    = ResolvedConfig（内存中只读，不落地文件）
```

- **对象字段**：递归深合并
- **数组字段**：默认替换；用 `mergeArray()` 标记则追加
- **敏感值**：通过 `!env KEY_NAME` YAML tag 显式读取

### 配置格式示例

```yaml
# config/config.yml
role: host

federation:
  manifestUrl: !env MF_MANIFEST_URL
  shared:
    vue:        { singleton: true, version: "^3.4" }
    vue-router: { singleton: true }

plugins:
  - use: "@maho/boot-vue"
  - use: "@maho/plugin-federation"
  - use: "@maho/plugin-router"
  - use: "./plugins/custom-plugin"   # 本地 TS 插件，唯一允许写代码的地方
```

### Devtools 与配置的关系

Devtools 展示三个独立视图：**Base**、**Current Mode**、**Merged（只读）**。
每个视图独立编辑、独立回写到对应文件，合并结果实时更新。
所有配置修改通过 Devtools 操作，杜绝手工编辑配置文件。

---

## 模块联邦

### 子包自描述

每个 Remote 必须暴露以下固定出口：

```
remoteEntry.js
  ├── ./mf-routes     路由声明（boot 自动发现）
  ├── ./mf-meta       模块元信息（版本、兼容性）
  └── ./pages/xxx     业务页面（按需加载）
  └── ./components/xx 可复用组件
  └── ./utils/xxx     工具函数
```

### 联邦配置

```yaml
# 父包 config.yml
federation:
  # 静态 remotes（直接配置 CDN 地址）
  remotes:
    - https://cdn.org.com/module-order/remoteEntry.js
    - https://cdn.org.com/module-user/remoteEntry.js
  # 可选：动态 manifest（优先级高于静态列表，支持多团队独立发布）
  manifestUrl: !env MF_MANIFEST_URL
```

### 动态 Manifest 格式

```json
{
  "version": "2025-01-01T00:00:00Z",
  "remotes": [
    {
      "name": "module-order",
      "entry": "https://cdn.org.com/module-order/v2.1.0/remoteEntry.js",
      "integrity": "sha384-xxxxx"
    }
  ]
}
```

动态 Manifest 中同名条目优先级高于静态配置，支持多团队独立发版而无需重新构建 Host。

### 共享依赖策略

共享依赖由 `@maho/boot-vue`（或对应适配包）统一声明，子包零配置：

- `vue`、`vue-router`、`pinia` 自动全局单例
- 子包无需在任何地方重复声明
- 版本契约由适配包的 `peerDependencies` 约束

---

## 路由系统

### 子包路由声明

```ts
// apps/module-order/src/mf-routes.ts
import { defineModuleRoutes } from '@maho/boot'

export default defineModuleRoutes({
  prefix: '/order',          // 路由前缀，不填默认用模块名
  routes: [
    {
      path: '/list',         // 最终路径：/order/list
      name: 'order-list',
      priority: 0,           // 默认 0，越大越优先
      component: () => import('./pages/OrderList.vue'),
      meta: {
        layout: 'default',
        auth: true,
        permissions: ['order:read'],
        title: '订单列表',
        menu: { group: '业务', order: 10 },
      },
    },
  ],
})
```

### 路由合并规则

| 场景 | 处理方式 |
|---|---|
| 不同 path | 各自独立注册 |
| 相同 path，不同 priority | 高 priority 完全胜出，低 priority 整棵子树消失 |
| 相同 path，相同 priority | `warn` 日志，按模块加载顺序取最后一个 |
| remote 加载失败 | 跳过该模块路由，不阻断启动 |

### 多布局支持

布局通过路由 `meta.layout` 声明，支持本地组件和联邦组件：

```yaml
# 父包 config.yml
layouts:
  default: "./src/layouts/DefaultLayout.vue"
  blank:   "./src/layouts/BlankLayout.vue"
  admin:   "module-admin/layouts/AdminLayout"   # 联邦布局，运行时懒加载
```

---

## Boot 体系

### 适配协议

Boot 定义六个抽象方法，任何框架只需实现此接口即可接入 Maho：

```ts
interface BootAdapter<TApp, TRouter> {
  convertRoutes(routes: MahoRoute[]): unknown[]
  createRouter(routes: unknown[]): TRouter
  applyInterceptors(router: TRouter, interceptors: RouteInterceptor[]): void
  applyLayouts(router: TRouter, layouts: ResolvedLayoutMap): void
  createApp(root: unknown, router: TRouter): TApp
  mount(app: TApp, target: string): void
}
```

### 启动流水线

```
① loadFederation      并行拉取所有 remoteEntry.js，跳过失败项
② collectRoutes       从各 remote 加载 ./mf-routes，合并路由表
③ convertRoutes       框架路由格式转换（由适配层处理）
④ createRouter        创建框架路由器实例
⑤ applyInterceptors   注入路由拦截器链
⑥ applyLayouts        注册布局映射
⑦ createApp           创建框架应用实例
⑧ mount               挂载，全局 loading 消失
```

### 宿主调用入口

```ts
// src/app.ts（Host 的唯一入口）
import { createMahoApp, defineLayouts } from '@maho/boot-vue'

createMahoApp({
  root:  AppShell,
  mount: '#app',
  layouts: defineLayouts({
    default: () => import('./layouts/DefaultLayout.vue'),
    blank:   () => import('./layouts/BlankLayout.vue'),
  }),
  interceptors: [
    async (ctx) => {
      // 路由拦截逻辑完全由宿主控制
      if (ctx.to.meta.auth && !store.isLoggedIn) {
        return `/login?redirect=${ctx.to.path}`
      }
    },
  ],
})
```

### `virtual:maho-config` 桥

Cordis 在构建侧通过虚拟模块向 Boot 注入静态配置，Boot 消费时无需感知构建环境：

```ts
// boot 内部
import mahoConfig from 'virtual:maho-config'
// dev 模式：federation.remotes 指向 localhost dev server
// prod 模式：federation.remotes 指向 CDN 地址
// 切换完全由 Cordis 在生成虚拟模块时处理
```

### 全局 Loading

由 `@maho/vite-plugin` 在 HTML 模板中注入纯 CSS loading 节点，框架无关，优先级最高：

- 在任何 JS 加载前即显示
- Boot 完成 `mount` 并首屏渲染完成后由 Boot 控制淡出
- 样式可通过配置自定义

---

## CLI

### 工作区结构（Monorepo 优先）

```
my-app/                    ← 根目录 = Host
  config/
    config.yml
    config.dev.yml
  src/                     ← Host 源码（Shell、Layout）
  plugins/                 ← 本地 TS 插件（唯一允许写代码的扩展点）
  apps/
    module-order/          ← Remote 子包
      config/config.yml
      src/
      package.json
    module-user/
  package.json
  pnpm-workspace.yaml
```

目录约定：`apps/*` 下每个子目录即为一个 Remote，无需手动注册。

### 核心命令

```bash
maho init [name]                  # 初始化项目（交互式）
maho add [name]                   # 新建子包
  --template <name|path|pkg>      # 指定模板

maho dev                          # 启动 Host + 所有 apps/* 子包
  --filter module-order,user      # 只启动指定子包
  --host-only                     # 只启动 Host Shell

maho build                        # 构建当前包
  --filter module-order           # 只构建指定子包
```

### 模板系统

内置模板 + 用户自定义模板，统一接口：

```yaml
# config.yml 中声明自定义模板
templates:
  custom-remote: "./templates/custom-remote"     # 本地路径
  org-host:      "@org/maho-template-host"       # npm 包
```

---

## Devtools

> **方向定义，V2 迭代实现**，参考 Koishi Console 的实现模式。

Devtools 作为 Cordis 插件注入，通过 WebSocket 向浏览器页面实时推送构建侧状态：

**核心面板规划：**

- **配置面板**：Base / Current / Merged 三层视图，可视化编辑并回写
- **路由面板**：路由合并结果，冲突可视化，priority 竞争报告
- **联邦面板**：各 Remote 加载状态、耗时、版本信息
- **依赖面板**：共享依赖版本协商结果，单例状态
- **插件面板**：Cordis 插件依赖图，服务注册状态

---

## V1 MVP 边界

### 必须包含

| 能力 | 说明 |
|---|---|
| 路由合并 | prefix + priority + 子树替换 |
| 联邦加载 | 静态 remotes + 可选 manifestUrl |
| 多布局 | 含联邦布局懒加载 |
| 全局 Loading | HTML 注入 + Boot 时序控制 |
| 共享依赖 | 由 boot-vue 统一声明，子包零配置 |
| YAML 配置 | 多 mode 分层合并 |
| virtual:maho-config | dev/prod 自动切换 |
| CSS Modules | vite-plugin 强制开启 |
| 跨模块类型 | 注册表自动生成 |
| mf-routes 协议 | defineModuleRoutes + 加载容错 |

### 实现顺序

```
Step 1  @maho/boot + @maho/boot-vue
        先跑通运行时：加载 remote → 合并路由 → 渲染页面

Step 2  @maho/vite-plugin
        virtual:maho-config + CSS Modules + 类型注册表

Step 3  @maho/core
        Cordis 服务接管配置解析和构建流程

Step 4  @maho/cli
        init / dev / build，依赖前三步就绪
```

### V2 规划

```
@maho/boot-react     React 适配
@maho/devtools       Devtools 服务端
@maho/devtools-ui    Devtools 浏览器页面
@maho/create         独立脚手架
@maho/auth           可选权限工具包
灰度发布              manifest 版本管理
HMR 跨模块           子包向 Host 发送热更新消息
```

---

## 附录：设计细节文档索引

> 以下各文档对概览中每个模块进行深入展开。

| 文档 | 内容 |
|---|---|
| `design-route-system.md` | 路由合并算法、priority 规则、mf-routes 协议 |
| `design-boot.md` | Boot 适配协议、pipeline、布局系统 |
| `design-cordis-services.md` | Cordis 服务地图、事件时序、插件 API |
| `design-config-system.md` | YAML 配置、多 mode 合并、Devtools 回写 |
| `design-type-system.md` | 跨模块类型生成、virtual:maho-config 类型 |
| `design-cli.md` | 命令设计、模板系统、工作区结构 |
| `design-federation.md` | remoteEntry 协议、manifest、共享依赖 |
| `design-mvp.md` | V1 实现计划、包边界、里程碑 |
