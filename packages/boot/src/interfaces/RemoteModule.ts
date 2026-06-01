/**
 * 运行时联邦模块抽象。
 * 由 loadRemoteEntry 创建，内部桥接到具体的联邦插件运行时
 * （如 @originjs/vite-plugin-federation 的 window container 模式）。
 */
export interface RemoteModule {
  name: string
  entry: string
  isReady: boolean
  /**
   * 加载该 remote 的某个 expose 路径。
   * - exposePath 形如 './mf-routes' 或 './pages/Order'
   * - 返回模块对象（含 default / 命名导出）。
   */
  load(exposePath: string): Promise<any>
}

/**
 * 动态 manifest 的单条目（用于 manifestUrl 解析）。
 */
export interface ManifestRemoteEntry {
  name: string
  entry: string
  integrity?: string
  meta?: {
    version?: string
    typesVersion?: string
  }
}

export interface FederationManifest {
  version: string
  remotes: ManifestRemoteEntry[]
}
