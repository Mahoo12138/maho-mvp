import path from 'node:path'
import { createJiti } from 'jiti'
import { Service } from 'cordis'
import type { MFContext } from '../context'
import type {
  BootBuildAdapter,
  BootSharedDepsMap,
  VitePluginLike,
} from '@maho/boot/build-adapter'

export interface BootServiceOptions {
  projectRoot: string
  /** 用户在 config.yml 声明的 boot 包名，如 `@maho/boot-vue`。 */
  bootPkg: string
}

/**
 * 通过 `${bootPkg}/build` 子路径加载任意 boot 包的构建侧适配器，
 * 解耦框架（vue / react / solid…）与 core / cli 主流程。
 *
 * 浏览器侧 BootAdapter 由 boot 包自己在 runBootPipeline 内消费；
 * 构建侧 BootBuildAdapter 在这里通过 ctx.boot 暴露给 CLI / vite-runner。
 */
export class BootService extends Service {
  declare protected ctx: MFContext

  framework!: string
  sharedDeps!: BootSharedDepsMap

  private adapter!: BootBuildAdapter
  private pluginsPromise?: Promise<VitePluginLike[]>

  constructor(ctx: MFContext, private options: BootServiceOptions) {
    super(ctx, 'boot')
  }

  /**
   * 加载 `${bootPkg}/build` 并赋值 framework/sharedDeps/adapter。
   * 由 createMahoContext 在 plugin 注册后显式 await，
   * 避免依赖 cordis Service.start 的异步完成时序。
   */
  async load(): Promise<void> {
    const { projectRoot, bootPkg } = this.options
    const specifier = `${bootPkg}/build`

    let mod: { default?: BootBuildAdapter } & Partial<BootBuildAdapter>
    try {
      mod = (await loadBuildModule(specifier, projectRoot)) as typeof mod
    } catch (err) {
      throw new Error(
        `[Maho] failed to load boot build adapter "${specifier}": ${(err as Error).message}`,
      )
    }

    const adapter = (mod.default ?? mod) as BootBuildAdapter
    if (
      !adapter ||
      typeof adapter.framework !== 'string' ||
      typeof adapter.getVitePlugins !== 'function'
    ) {
      throw new Error(
        `[Maho] "${specifier}" did not export a valid BootBuildAdapter ` +
          `(expected { framework, sharedDeps, getVitePlugins() }).`,
      )
    }

    this.adapter = adapter
    this.framework = adapter.framework
    this.sharedDeps = adapter.sharedDeps ?? {}
  }

  /** 懒计算并缓存 vite plugin 列表 —— 多次 dev/build 调用复用。 */
  getVitePlugins(): Promise<VitePluginLike[]> {
    if (!this.pluginsPromise) {
      this.pluginsPromise = Promise.resolve(this.adapter.getVitePlugins())
    }
    return this.pluginsPromise
  }
}

/**
 * 优先用动态 `import()` 解析（npm 包名走 Node 解析）；
 * 失败时退回到 jiti（兼容 workspace 内未发布的 ts 源码）。
 */
async function loadBuildModule(
  specifier: string,
  projectRoot: string,
): Promise<unknown> {
  try {
    return await import(specifier)
  } catch {
    const jiti = createJiti(path.join(projectRoot, 'noop.js'), {
      interopDefault: true,
    })
    return await jiti.import(specifier)
  }
}
