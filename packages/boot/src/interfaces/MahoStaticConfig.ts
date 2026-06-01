import type { MahoRoute } from './MahoRoute'

/**
 * `virtual:maho-config` 暴露的静态配置。
 * 内容由 @maho/vite-plugin 在构建期生成（dev 用 localhost，prod 用 CDN）。
 */
export interface MahoStaticConfig {
  role: 'host' | 'remote'
  mode: string
  federation: {
    remotes: string[]
    manifestUrl: string | null
  }
  /**
   * inline 子包的路由（构建时内联，无需运行时联邦加载）。
   */
  inlineRoutes: MahoRoute[]
  shared: Record<
    string,
    {
      singleton: boolean
      requiredVersion: string
    }
  >
  loading?: {
    html?: string
    background?: string
    color?: string
  }
}
