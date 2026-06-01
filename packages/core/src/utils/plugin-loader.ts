import path from 'node:path'
import { createJiti } from 'jiti'
import type { PluginDeclaration } from '../interfaces/MFConfig'

/**
 * 插件模块期望导出的形态。`apply` 与 `default` 都是可选的，
 * 解析时优先 `apply`，否则取 `default`。
 *
 * 注意：`ctx` 类型在 utils 层故意保留 `unknown`，避免 utils 反向依赖 context。
 */
export interface LoadedPlugin {
  name?: string
  apply?: (ctx: unknown, options: unknown) => unknown
  default?: unknown
  inject?: readonly string[] | Record<string, unknown>
}

/**
 * jiti 实例延迟创建：仅在加载本地 TS 插件时才付出代价。
 * 单例避免重复初始化（jiti 自带模块缓存）。
 */
let jitiInstance: ReturnType<typeof createJiti> | null = null

function getJiti(): ReturnType<typeof createJiti> {
  if (!jitiInstance) {
    jitiInstance = createJiti(process.cwd(), { interopDefault: true })
  }
  return jitiInstance
}

/**
 * 根据 `PluginDeclaration.use` 决定加载方式：
 * - `./xxx` / 绝对路径 → 通过 jiti 加载（支持 TS / ESM 互操作）
 * - 否则视为 npm 包名 → 标准 `import()`
 */
export async function loadPlugin(
  decl: PluginDeclaration,
  projectRoot: string,
): Promise<LoadedPlugin> {
  if (decl.use.startsWith('.') || path.isAbsolute(decl.use)) {
    const abs = path.resolve(projectRoot, decl.use)
    return (await getJiti().import(abs)) as LoadedPlugin
  }
  return (await import(decl.use)) as LoadedPlugin
}
