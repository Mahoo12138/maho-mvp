import type { MahoRoute } from '@maho/boot'

export interface SharedDep {
  singleton?: boolean
  requiredVersion?: string
  version?: string
  generate?: boolean
  shareScope?: string
}

export type SharedDepsMap = Record<string, SharedDep>

export interface MahoLoadingOptions {
  /** 自定义 HTML 片段（替换默认 spinner） */
  html?: string
  /** 背景色 CSS 变量值 */
  background?: string
  /** 主色（spinner 颜色） */
  color?: string
  /** 跳过注入 */
  disabled?: boolean
}

export interface MahoCSSModulesOptions {
  /** scopedName 模式，默认 '[local]__[hash:base64:5]' */
  generateScopedName?: string
  /** 关闭配置（不修改 Vite 默认行为） */
  disabled?: boolean
}

export interface MahoFederationOptions {
  /** Host：要加载的 remote URL 列表（生产 CDN 地址） */
  remotes?: string[]
  /** Host：动态 manifest URL */
  manifestUrl?: string | null
  /**
   * Host：dev 模式 remote 地址覆盖（name → URL）。
   * 通常由 CLI ProcessManager 注入；Step 2 接收为显式参数。
   */
  devRemotes?: Record<string, string>
}

export interface MahoPluginOptions {
  /** 当前包角色 */
  role: 'host' | 'remote'

  /**
   * 当前包名。
   * - role=remote：必填，作为 federation container name 与 mf-meta.name
   * - role=host：可选，仅用于日志
   */
  name?: string

  /**
   * 当前包版本（mf-meta 用）。不填则尝试从 package.json 读取。
   */
  version?: string

  /** 构建 mode（'dev' | 'prod' | 自定义），默认从 env 推断 */
  mode?: string

  /** 联邦配置 */
  federation?: MahoFederationOptions

  /**
   * Remote：暴露的模块路径数组。
   * 不需要包含 './mf-meta'、'./mf-routes'，框架自动追加（如对应源文件存在）。
   */
  exposes?: string[]

  /** 用户追加的共享依赖（与 bootAdapter 提供的合并；用户优先） */
  shared?: SharedDepsMap

  /**
   * boot 适配包名（如 '@maho/boot-vue'）。
   * 设置后，vite-plugin 在 configResolved 时动态 import 该包读取 sharedDeps 导出。
   */
  bootAdapter?: string

  /**
   * inline 子包路由声明（构建时静态收集）。
   * Step 2 显式传入；Step 3 由 RouteService 自动扫描。
   */
  inlineRoutes?: MahoRoute[]

  /** 全局 Loading 自定义（仅 host 角色生效） */
  loading?: MahoLoadingOptions

  /** CSS Modules scopedName 配置 */
  cssModules?: MahoCSSModulesOptions

  /**
   * 是否在项目根写入 .maho/{virtual,registry}.d.ts。
   * 默认 true。Step 3 接入 core 后由 TypeService 接管。
   */
  emitTypes?: boolean

  /**
   * 项目根目录，默认 process.cwd()。
   */
  projectRoot?: string
}

/**
 * 内部规范化后的选项。所有可选字段都填充了默认值。
 */
export interface ResolvedMahoPluginOptions {
  role: 'host' | 'remote'
  name: string
  version: string
  mode: string
  federation: {
    remotes: string[]
    manifestUrl: string | null
    devRemotes: Record<string, string>
  }
  exposes: string[]
  shared: SharedDepsMap
  bootAdapter: string | null
  inlineRoutes: MahoRoute[]
  loading: Required<Omit<MahoLoadingOptions, 'html'>> & { html: string | null }
  cssModules: { generateScopedName: string; disabled: boolean }
  emitTypes: boolean
  projectRoot: string
}
