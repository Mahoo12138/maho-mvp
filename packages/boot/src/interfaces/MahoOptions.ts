import type { LayoutConfig } from './LayoutConfig'
import type { RouteInterceptor } from './RouteInterceptor'

export interface FederationConfig {
  /** remoteEntry.js 完整 URL 列表 */
  remotes: Array<{ name: string; entry: string }>
  /** 动态 manifest URL；若提供，将与静态 remotes 合并（动态优先） */
  manifestUrl?: string | null
}

/**
 * createMahoApp 的入参（boot-vue 等适配包对外的唯一 API 入口）。
 *
 * - federation 不填时，完全使用 virtual:maho-config 中的配置。
 * - federation 填写时，与 virtual:maho-config 合并（options 优先级更高）。
 */
export interface MahoOptions {
  root: unknown
  mount?: string
  federation?: Partial<FederationConfig>
  layouts?: LayoutConfig
  interceptors?: RouteInterceptor[]
}
