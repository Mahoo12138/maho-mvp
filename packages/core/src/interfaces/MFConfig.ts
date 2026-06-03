/**
 * 用户在 `config/config.yml` 中可以声明的字段。
 *
 * 通过 TypeScript 声明合并（`declare module '@maho/core' { interface MFConfig { ... } }`）
 * 可以让插件追加自己的配置字段。
 */
export interface MFConfig {
  /** 当前包角色 */
  role: 'host' | 'remote'

  /** 当前包名。remote 必填；host 可省略（取 package.json name） */
  name?: string

  /**
   * Boot 包名。声明该字段后，core 在 createMahoContext 中会动态加载
   * `${boot}/build`，并把返回的 BootBuildAdapter 注册到 ctx.boot。
   *
   * ```yaml
   * boot: "@maho/boot-vue"
   * ```
   */
  boot?: string

  /** 联邦配置（host 专用） */
  federation?: {
    remotes?: string[]
    manifestUrl?: string | null
    dev?: {
      overrides?: Record<string, string>
    }
  }

  /** 路由前缀（remote 专用） */
  prefix?: string

  /** 暴露模块路径（remote 专用） */
  exposes?: string[]

  /** 布局映射（host 专用） */
  layouts?: Record<string, string>

  /** 共享依赖手动追加（基础依赖由 boot-xxx 注入） */
  shared?: Record<string, {
    singleton: boolean
    version: string
  }>

  /** 全局 Loading 配置（host 专用） */
  loading?: {
    html?: string
    background?: string
    color?: string
  }

  /** 插件声明 */
  plugins?: PluginDeclaration[]

  /** 模板（add 命令用） */
  templates?: Record<string, string>

  /** 插件自定义字段（声明合并扩展） */
  [key: string]: unknown
}

/**
 * `config.yml` 中 plugins 数组的元素形态。
 *
 * ```yaml
 * plugins:
 *   - use: "@org/my-plugin"
 *     with:
 *       apiKey: "xxx"
 * ```
 */
export interface PluginDeclaration {
  /** npm 包名 或 以 `./` 开头的本地相对路径 */
  use: string
  /** 插件选项，对应插件 apply(ctx, options) 的第二参数 */
  with?: Record<string, unknown>
}

/**
 * YAML 文件解析后的原始结构。所有字段可选，因为 `config.dev.yml` 这种
 * 覆盖文件通常只包含部分字段。
 */
export type ParsedConfig = Partial<MFConfig> & Record<string, unknown>

/**
 * base + current 合并后的最终配置。结构上与 `MFConfig` 相同，
 * 名字独立是为了在 API 层面区分「已 deepMerge」和「单层声明」。
 */
export type ResolvedMFConfig = MFConfig
