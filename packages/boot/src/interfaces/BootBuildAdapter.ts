/**
 * 构建侧 Boot 适配协议。任何 UI 框架（Vue / React / Solid…）的 boot 包
 * 都通过 `${pkg}/build` 子路径导出符合此契约的对象，供构建侧加载。
 *
 * 与 BootAdapter（浏览器侧 pipeline 协议）配对成完整的 Boot 标准：
 *   - 浏览器侧（`./`）：BootAdapter —— createApp / createRouter / mount 等
 *   - 构建侧（`./build`）：BootBuildAdapter —— framework + sharedDeps + vite plugins
 *
 * 拆成两个接口的原因：浏览器侧不能 import vite，构建侧不能 import vue runtime。
 * 同一个包提供两个子路径，让两侧的依赖图完全隔离。
 */
export interface BootBuildAdapter {
  /** 框架标识，用于诊断日志与未来按框架分支的逻辑（'vue' / 'react' / 自定义）。 */
  framework: string

  /** 框架核心依赖的 singleton 声明，会被 federation 合并到 shared 配置。 */
  sharedDeps: BootSharedDepsMap

  /**
   * 返回需要在 vite 构建中前置注入的插件数组（如 @vitejs/plugin-vue()）。
   * CLI 在 createServer / build 时把这些插件放在 maho() 插件之前。
   */
  getVitePlugins(): VitePluginLike[] | Promise<VitePluginLike[]>
}

/**
 * 共享依赖声明的最小形状。与 vite-plugin 的 SharedDep 字段对齐，
 * 但 @maho/boot 不依赖 vite-plugin，因此独立定义。
 */
export interface BootSharedDep {
  singleton?: boolean
  requiredVersion?: string
  version?: string
}

export type BootSharedDepsMap = Record<string, BootSharedDep>

/**
 * vite Plugin 的鸭子类型。boot 包不依赖 vite，
 * 让 CLI 在使用时 `as Plugin[]` 即可。
 */
export type VitePluginLike = { name: string } & Record<string, unknown>
