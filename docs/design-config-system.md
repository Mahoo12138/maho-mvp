# Maho 配置系统详细设计

> 本文档涵盖：配置目录结构、YAML 格式规范、多 mode 分层合并、环境变量读取、深合并策略、Devtools 回写闭环、本地插件加载。

---

## 目录

1. [设计原则](#设计原则)
2. [目录结构](#目录结构)
3. [YAML 格式规范](#yaml-格式规范)
4. [完整配置 Schema](#完整配置-schema)
5. [多 mode 分层合并](#多-mode-分层合并)
6. [深合并策略](#深合并策略)
7. [环境变量读取](#环境变量读取)
8. [本地 TS 插件加载](#本地-ts-插件加载)
9. [Devtools 回写闭环](#devtools-回写闭环)
10. [配置验证](#配置验证)

---

## 设计原则

**配置即契约，不写逻辑**

`config/` 目录下所有文件均为纯声明性 YAML，描述意图而非实现。任何需要编写代码的扩展需求，统一通过 `plugins/` 目录下的本地 TS 插件处理，在 `config.yml` 中以相对路径引用。

**环境差异显式表达**

不同运行环境的配置差异通过 `config.{mode}.yml` 文件显式声明，而非依赖 `process.env.NODE_ENV` 的隐式判断。所有敏感值通过 `!env` YAML tag 显式读取，不自动注入。

**合并结果只读**

`config.yml` + `config.{mode}.yml` 的合并产物 `ResolvedConfig` 仅存在于内存，不落地为文件。Devtools 回写时，只写入对应的源文件，合并由 `ConfigService` 自动重新计算。

---

## 目录结构

```
project-root/
  config/
    config.yml           必须存在，基础配置（所有 mode 共用）
    config.dev.yml       dev mode 覆盖（可选）
    config.prod.yml      prod mode 覆盖（可选）
    config.staging.yml   自定义 mode（可选，用户自由命名）
    config.test.yml      测试 mode（可选）

  plugins/               本地 TS 插件目录（唯一允许写代码的扩展点）
    upload-oss.ts
    custom-vite.ts

  .env                   所有 mode 共用的敏感值（提交 git）
  .env.dev               dev 专用敏感值（建议 gitignore）
  .env.prod              prod 专用敏感值（gitignore）
  .env.local             本地开发覆盖（始终 gitignore）

  apps/
    module-order/
      config/
        config.yml       子包基础配置
        config.dev.yml   子包 dev 覆盖
```

### `.gitignore` 约定

```gitignore
# 提交到 git
config/config.yml
config/config.dev.yml
config/config.prod.yml
config/config.staging.yml

# 不提交（个人本地覆盖）
.env.local
.env.*.local
config/config.local.yml   # 可选的第三层覆盖（最高优先级）
.maho/                    # 框架生成的临时文件（registry.d.ts 等）
```

---

## YAML 格式规范

### 基础结构

```yaml
# config/config.yml

# 当前包的角色：host（父包）或 remote（子包）
role: host

# 联邦配置
federation:
  remotes:
    - https://cdn.org.com/module-order/remoteEntry.js
    - https://cdn.org.com/module-user/remoteEntry.js
  manifestUrl: !env MF_MANIFEST_URL

# 路由布局映射
layouts:
  default: "./src/layouts/DefaultLayout.vue"
  blank:   "./src/layouts/BlankLayout.vue"
  admin:   "module-admin/layouts/AdminLayout"

# 共享依赖（通常由 boot-xxx 自动注入，此处为手动追加）
shared:
  lodash-es: { singleton: true, version: "^4.17" }

# 全局 loading 配置
loading:
  background: "#ffffff"
  color:      "#6366f1"

# 插件列表（按声明顺序加载）
plugins:
  - use: "@maho/boot-vue"           # npm 包
  - use: "@maho/plugin-federation"
  - use: "@maho/plugin-router"
  - use: "@maho/plugin-types"
  - use: "./plugins/upload-oss"     # 本地 TS 插件（相对路径）
    with:
      bucket: "my-assets"
      region: "cn-hangzhou"
```

### 子包配置结构

```yaml
# apps/module-order/config/config.yml

role: remote
name: module-order       # 模块唯一标识，不填则取目录名
prefix: /order           # 路由前缀，不填则取 /module-order

# 子包暴露的出口
exposes:
  - ./pages/OrderList
  - ./pages/OrderDetail
  - ./components/OrderCard
  - ./utils/formatters
  - ./mf-routes            # 框架约定出口，自动追加，无需手动声明

plugins:
  - use: "@maho/plugin-routes"
  - use: "@maho/plugin-types"
```

### dev mode 覆盖示例

```yaml
# config/config.dev.yml

federation:
  # 覆盖生产 remotes，指向本地 dev server
  remotes:
    - http://localhost:5174/remoteEntry.js
    - http://localhost:5175/remoteEntry.js
  # dev 模式不需要 manifestUrl
  manifestUrl: ~

plugins:
  # dev 模式追加 devtools 插件
  - !mergeArray
    - use: "@maho/plugin-devtools"
```

---

## 完整配置 Schema

```ts
// @maho/core 内部类型定义

interface MFConfig {
  // ── 基础 ─────────────────────────────────────────
  role:   'host' | 'remote'
  name?:  string          // remote 模式必填，host 模式可选（取 package.json name）

  // ── 联邦（host 专用）────────────────────────────
  federation?: {
    remotes:      string[]       // remoteEntry.js URL 列表
    manifestUrl?: string | null  // 动态 manifest URL
    dev?: {
      overrides?: Record<string, string>  // name → 本地 dev server URL
    }
  }

  // ── 子包暴露（remote 专用）──────────────────────
  prefix?:   string          // 路由前缀
  exposes?:  string[]        // 相对于 src/ 的暴露路径列表

  // ── 布局（host 专用）─────────────────────────────
  layouts?: Record<string, string>

  // ── 共享依赖（手动追加，基础依赖由 boot-xxx 自动注入）
  shared?: Record<string, {
    singleton:  boolean
    version:    string
  }>

  // ── 全局 Loading ───────────────────────────────
  loading?: {
    html?:        string   // 自定义 loading HTML 片段
    background?:  string   // 背景色
    color?:       string   // 主色
  }

  // ── Vite 逃生舱口（只能通过本地 TS 插件使用）────
  // 注意：此字段不在 YAML 中声明，由本地插件通过 ctx.on('vite:config') 实现

  // ── 插件列表 ────────────────────────────────────
  plugins?: PluginDeclaration[]

  // ── 模板（add 命令用）───────────────────────────
  templates?: Record<string, string>

  // ── 插件自定义字段（通过声明合并扩展）─────────────
  [key: string]: unknown
}

interface PluginDeclaration {
  use:   string              // npm 包名或本地相对路径
  with?: Record<string, unknown>  // 插件配置项
}
```

---

## 多 mode 分层合并

### 合并层次

```
优先级（高 → 低）

config.local.yml    可选第三层，gitignore，个人本地覆盖
      +
config.{mode}.yml   当前 mode 的覆盖（如 config.dev.yml）
      +
config.yml          基础配置，必须存在
      ↓
ResolvedConfig      内存中的只读合并结果
```

### Mode 解析规则

```
maho dev                  → mode = 'dev'
maho dev --mode staging   → mode = 'staging'
maho build                → mode = 'prod'
maho build --mode test    → mode = 'test'
```

框架不维护 mode 枚举——`config.{mode}.yml` 文件存在即有效，不存在则静默跳过，无需注册。

### ConfigService 加载逻辑

```ts
// @maho/core/services/config.ts

async function loadConfig(mode: string): Promise<void> {
  const dir = findConfigDir()

  // 1. 加载基础层（必须存在）
  const basePath = path.join(dir, 'config', 'config.yml')
  if (!fs.existsSync(basePath)) {
    throw new Error('[Maho] config/config.yml is required but not found')
  }
  this.base = await parseYaml(basePath)

  // 2. 加载 mode 覆盖层（可选）
  const modePath = path.join(dir, 'config', `config.${mode}.yml`)
  this.current = fs.existsSync(modePath)
    ? await parseYaml(modePath)
    : {}

  // 3. 加载本地覆盖层（可选，gitignore）
  const localPath = path.join(dir, 'config', 'config.local.yml')
  this.local = fs.existsSync(localPath)
    ? await parseYaml(localPath)
    : {}

  this.recompute()
}

private recompute() {
  // 三层合并，local 优先级最高
  this.resolved = deepMerge(
    deepMerge(this.base, this.current),
    this.local
  ) as ResolvedMFConfig

  this.ctx.emit('config:resolved', this.resolved)
}
```

---

## 深合并策略

### 基本规则

| 字段类型 | 合并行为 |
|---|---|
| 基础类型（string / number / boolean）| override 值直接覆盖 base 值 |
| 普通对象 | 递归深合并，override 的 key 覆盖 base 的同名 key |
| 数组（默认）| override 数组**替换** base 数组（不追加）|
| 数组（`!mergeArray` 标记）| override 数组**追加**到 base 数组之后 |
| `null` / `~` | 将对应 base 字段置为 `null`（显式清除）|

### `deepMerge` 实现

```ts
// @maho/core/utils/merge.ts

const MERGE_ARRAY_SYMBOL = Symbol('maho:mergeArray')

/**
 * 标记数组为"追加语义"，而非默认的"替换语义"
 * 在 YAML 中通过 !mergeArray tag 声明
 */
export function mergeArray<T>(items: T[]): T[] {
  Object.defineProperty(items, MERGE_ARRAY_SYMBOL, {
    value: true, enumerable: false,
  })
  return items
}

export function deepMerge(base: unknown, override: unknown): unknown {
  // override 为 undefined → 保留 base
  if (override === undefined) return base

  // override 为 null → 显式清除（返回 null）
  if (override === null) return null

  // 数组处理
  if (Array.isArray(override)) {
    if ((override as any)[MERGE_ARRAY_SYMBOL] && Array.isArray(base)) {
      return [...base, ...override]   // 追加
    }
    return override                   // 替换（默认）
  }

  // 对象递归合并
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base }
    for (const key of Object.keys(override)) {
      result[key] = deepMerge(
        (base as Record<string, unknown>)[key],
        (override as Record<string, unknown>)[key],
      )
    }
    return result
  }

  // 其余情况：override 直接覆盖
  return override
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null &&
    Object.getPrototypeOf(v) === Object.prototype
}
```

### 数组语义示例

```yaml
# config/config.yml
plugins:
  - use: "@maho/boot-vue"
  - use: "@maho/plugin-federation"

# config/config.dev.yml（默认替换语义）
plugins:
  - use: "@maho/plugin-devtools"
# 合并结果：只有 devtools，boot-vue 和 federation 被替换掉 ❌ 通常不是期望行为

# config/config.dev.yml（追加语义）
plugins: !mergeArray
  - use: "@maho/plugin-devtools"
# 合并结果：boot-vue + federation + devtools ✅
```

---

## 环境变量读取

### `!env` 自定义 YAML Tag

框架在解析 YAML 时注册两个自定义 tag，实现显式环境变量读取：

```ts
// @maho/core/utils/yaml.ts
import { load, DEFAULT_SCHEMA, Type } from 'js-yaml'

function buildSchema(envVars: Record<string, string>) {
  return DEFAULT_SCHEMA.extend([

    // !env KEY：必填，不存在则启动报错
    new Type('!env', {
      kind: 'scalar',
      construct(key: string) {
        const val = envVars[key]
        if (val === undefined) {
          throw new Error(
            `[Maho] Required env variable "${key}" is not set.\n` +
            `Add it to .env or .env.${currentMode}`
          )
        }
        return val
      },
    }),

    // !env? KEY：可选，不存在返回 null
    new Type('!env?', {
      kind: 'scalar',
      construct(key: string) {
        return envVars[key] ?? null
      },
    }),

    // !mergeArray：标记数组为追加语义
    new Type('!mergeArray', {
      kind: 'sequence',
      construct(data: unknown[]) {
        return mergeArray(data)
      },
    }),
  ])
}

export async function parseYaml(
  filePath: string,
  mode:     string,
): Promise<unknown> {
  // 按优先级加载 .env 文件
  const envVars = loadEnvFiles(mode)
  const schema  = buildSchema(envVars)
  const content = await fs.readFile(filePath, 'utf-8')
  return load(content, { schema })
}
```

### `.env` 文件加载顺序

```ts
// 优先级：高 → 低
function loadEnvFiles(mode: string): Record<string, string> {
  const files = [
    '.env.local',          // 最高优先级，始终 gitignore
    `.env.${mode}.local`,  // mode 专用本地覆盖
    `.env.${mode}`,        // mode 专用（如 .env.dev）
    '.env',                // 兜底，所有 mode 共用
  ]

  const result: Record<string, string> = {}
  for (const file of files.reverse()) {   // reverse 使高优先级后处理（覆盖低优先级）
    if (fs.existsSync(file)) {
      Object.assign(result, parseEnvFile(file))
    }
  }
  return result
}
```

### 使用示例

```yaml
# config/config.yml
federation:
  manifestUrl: !env MF_MANIFEST_URL          # 必填，未设置则报错

# config/config.dev.yml
federation:
  manifestUrl: !env? MF_DEV_MANIFEST_URL     # 可选，未设置则为 null
  remotes:
    - !env? DEV_ORDER_ENTRY                  # 支持数组元素使用 !env?
```

```ini
# .env.dev
MF_DEV_MANIFEST_URL=http://localhost:9000/manifest.json
DEV_ORDER_ENTRY=http://localhost:5174/remoteEntry.js
```

---

## 本地 TS 插件加载

`config.yml` 中用相对路径（`./plugins/xxx`）引用本地 TS 插件。框架在加载时使用 `jiti` 或 `tsx` 进行运行时编译，无需预先构建。

### 加载流程

```ts
// @maho/core/utils/plugin-loader.ts
import { createJiti } from 'jiti'

const jiti = createJiti(process.cwd(), {
  interopDefault: true,
  cache: false,       // dev 模式禁用缓存，支持热重载
})

async function loadPlugin(
  declaration: PluginDeclaration,
): Promise<{ apply: (ctx: MFContext, opts: unknown) => void }> {

  const { use, with: options } = declaration

  // 本地路径（以 ./ 或 / 开头）
  if (use.startsWith('.') || path.isAbsolute(use)) {
    const absPath = path.resolve(process.cwd(), use)
    // 支持 .ts / .js / 无扩展名（自动补全）
    const plugin = await jiti.import(absPath)
    return { apply: plugin.apply ?? plugin.default }
  }

  // npm 包
  return await import(use)
}
```

### 本地插件规范

```ts
// plugins/custom-vite.ts
import type { MFContext } from '@maho/core'
import type { UserConfig } from 'vite'

// 插件名（用于日志和 Devtools 显示）
export const name = 'custom-vite'

// 插件选项类型（对应 config.yml 中 with 字段）
interface Options {
  target?: string
  sourcemap?: boolean
}

// 主入口，与 Cordis 插件格式完全一致
export function apply(ctx: MFContext, options: Options = {}) {
  ctx.on('vite:config', (config: UserConfig) => {
    config.build ??= {}
    config.build.target    = options.target    ?? 'es2020'
    config.build.sourcemap = options.sourcemap ?? false
    return config
  })
}
```

```yaml
# config/config.yml
plugins:
  - use: "./plugins/custom-vite"
    with:
      target: "es2020"
      sourcemap: false
```

---

## Devtools 回写闭环

### 三层视图与写入目标

| Devtools 视图 | 对应文件 | 可写入 | git 跟踪 |
|---|---|---|---|
| **Base** | `config/config.yml` | ✅ | ✅ 提交 |
| **Current（mode）** | `config/config.{mode}.yml` | ✅ | ✅ 提交 |
| **Local（可选）** | `config/config.local.yml` | ✅ | ❌ gitignore |
| **Merged（只读）** | 仅存在于内存 | ❌ | — |

### 回写 API

`ConfigService` 提供三个独立的写入方法，Devtools 按用户选择的视图调用：

```ts
class ConfigService extends Service {

  // 写入 Base 层（影响所有 mode）
  async updateBase(patch: DeepPartial<MFConfig>): Promise<void> {
    this.base    = deepMerge(this.base, patch) as ParsedConfig
    await writeYaml('config/config.yml', this.base)
    this.recompute()
    this.ctx.emit('config:base-changed', this.base)
  }

  // 写入 Current 层（只影响当前 mode）
  async updateCurrent(patch: DeepPartial<MFConfig>): Promise<void> {
    const mode   = this.ctx.mode.current
    this.current = deepMerge(this.current, patch) as ParsedConfig
    await writeYaml(`config/config.${mode}.yml`, this.current)
    this.recompute()
    this.ctx.emit('config:current-changed', this.current)
  }

  // 写入 Local 层（个人临时覆盖，不提交）
  async updateLocal(patch: DeepPartial<MFConfig>): Promise<void> {
    this.local   = deepMerge(this.local, patch) as ParsedConfig
    await writeYaml('config/config.local.yml', this.local)
    this.recompute()
    this.ctx.emit('config:local-changed', this.local)
  }

  // 清除 Current 层的某个字段（让 Base 值透出）
  async clearCurrentField(keyPath: string): Promise<void> {
    deleteByPath(this.current, keyPath)
    const mode = this.ctx.mode.current
    await writeYaml(`config/config.${mode}.yml`, this.current)
    this.recompute()
  }
}
```

### 完整回写闭环时序

```
Devtools 用户修改某字段
  ↓ 用户选择写入层（Base / Current / Local）
  ↓
ConfigService.updateBase() / updateCurrent() / updateLocal()
  ↓ 写入对应 YAML 文件
  ↓ recompute() → 重新深合并
  ↓ emit config:resolved
  ↓
DevPipelineService 监听 config:resolved
  ↓ 精确判断哪些服务需要重启
  ↓ 按需重启 FederationService / RouteService / ViteService
  ↓ emit manifest:updated
  ↓
Devtools WebSocket 收到 manifest:updated
  ↓ Merged 视图实时刷新
  ↓ 浏览器页面收到 HMR 通知（如需）
```

### 字段来源追踪

Devtools Merged 视图需要标注每个字段的来源层，由 `deepMergeWithSource` 在合并时同步生成：

```ts
// @maho/core/utils/merge.ts

type FieldSource = 'base' | 'current' | 'local'

export function deepMergeWithSource(
  base:     unknown,
  current:  unknown,
  local:    unknown,
): {
  result:  unknown
  sources: Map<string, FieldSource>
} {
  const sources = new Map<string, FieldSource>()

  function walk(b: unknown, c: unknown, l: unknown, path: string): unknown {
    // local 优先
    if (l !== undefined && l !== null) {
      sources.set(path, 'local')
      if (isPlainObject(b) && isPlainObject(l)) {
        const merged = deepMerge(b, l)
        return merged
      }
      return l
    }
    // current 次之
    if (c !== undefined && c !== null) {
      sources.set(path, 'current')
      if (isPlainObject(b) && isPlainObject(c)) {
        // 递归跟踪子字段
        const result: Record<string, unknown> = { ...(b as object) }
        for (const key of Object.keys(c as object)) {
          result[key] = walk(
            (b as any)?.[key],
            (c as any)[key],
            (l as any)?.[key],
            path ? `${path}.${key}` : key,
          )
        }
        return result
      }
      return c
    }
    // base 兜底
    sources.set(path, 'base')
    return b
  }

  const result = walk(base, current, local, '')
  return { result, sources }
}
```

Devtools 使用 `sources` Map 为每个字段附加来源标记：

```
federation.remotes  ← current （dev 模式覆盖）
federation.shared   ← base
plugins[0]          ← base
plugins[3]          ← current  （devtools 插件仅 dev 加载）
```

---

## 配置验证

### 启动时验证

`ConfigService` 加载完成后，对 `resolved` 执行 Schema 验证：

```ts
// @maho/core/utils/config-validator.ts

interface ValidationResult {
  valid:  boolean
  errors: ValidationError[]
}

interface ValidationError {
  path:    string    // 如 "federation.remotes[0]"
  message: string
}

function validateConfig(config: ResolvedMFConfig): ValidationResult {
  const errors: ValidationError[] = []

  // role 必填
  if (!config.role) {
    errors.push({ path: 'role', message: '"role" is required (host | remote)' })
  }

  // remote 角色必须有 name
  if (config.role === 'remote' && !config.name) {
    errors.push({ path: 'name', message: '"name" is required for remote role' })
  }

  // host 角色的 remotes 必须是合法 URL
  if (config.role === 'host') {
    config.federation?.remotes?.forEach((url, i) => {
      try { new URL(url) } catch {
        errors.push({
          path:    `federation.remotes[${i}]`,
          message: `"${url}" is not a valid URL`,
        })
      }
    })
  }

  // plugins 声明的路径必须存在
  config.plugins?.forEach((plugin, i) => {
    if (plugin.use.startsWith('.')) {
      const abs = path.resolve(process.cwd(), plugin.use)
      // 支持 .ts / .js 扩展名自动补全
      const exists = [abs, `${abs}.ts`, `${abs}.js`].some(fs.existsSync)
      if (!exists) {
        errors.push({
          path:    `plugins[${i}].use`,
          message: `Local plugin "${plugin.use}" not found`,
        })
      }
    }
  })

  return { valid: errors.length === 0, errors }
}
```

验证失败时的错误输出：

```
[Maho] Config validation failed (3 errors):

  ✗ federation.remotes[0]
    "not-a-url" is not a valid URL

  ✗ plugins[2].use
    Local plugin "./plugins/missing-plugin" not found

  ✗ name
    "name" is required for remote role
```

### 插件 Schema 验证

插件可声明自己的配置 Schema，框架在加载插件时自动校验 `with` 字段：

```ts
// plugins/upload-oss.ts

// 声明配置 schema（使用 zod 或 JSON Schema）
export const schema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1),
  prefix: z.string().optional().default(''),
})

export function apply(ctx: MFContext, options: z.infer<typeof schema>) {
  // options 已经过验证，类型安全
}
```

---

*下一篇：[design-type-system.md](./design-type-system.md) — 跨模块类型生成、注册表、virtual:maho-config 类型声明*
