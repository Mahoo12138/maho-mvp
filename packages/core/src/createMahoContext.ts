import { MFContext } from './context'
import { ModeService } from './services/mode'
import { ConfigService } from './services/config'
import { loadPlugin } from './utils/plugin-loader'

export interface CreateMahoContextOptions {
  /** 项目根目录，默认 `process.cwd()` */
  projectRoot?: string
  /** 当前模式，默认 `dev` */
  mode?: string
}

/**
 * Maho 启动入口。返回的 ctx 已经：
 *   1. 注册 ModeService / ConfigService
 *   2. 完成 config 加载与校验
 *   3. 按 `config.plugins` 顺序加载并安装用户插件
 *
 * 失败会原样抛出 —— CLI 层负责友好打印。
 */
export async function createMahoContext(
  opts: CreateMahoContextOptions = {},
): Promise<MFContext> {
  const projectRoot = opts.projectRoot ?? process.cwd()
  const mode = opts.mode ?? 'dev'

  const ctx = new MFContext()
  ctx.plugin(ModeService, mode)
  ctx.plugin(ConfigService, { projectRoot })

  await ctx.config.load(mode)

  for (const decl of ctx.config.resolved.plugins ?? []) {
    const plugin = await loadPlugin(decl, projectRoot)
    const apply = plugin.apply ?? plugin.default
    if (typeof apply === 'function') {
      // 用户插件签名由插件作者决定，core 这里只把声明的 `with` 透传给 apply。
      ;(ctx.plugin as (p: unknown, c?: unknown) => unknown)(apply, decl.with)
    }
  }

  return ctx
}
