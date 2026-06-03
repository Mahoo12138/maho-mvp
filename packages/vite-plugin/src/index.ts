import type { Plugin } from 'vite'
import { resolveOptions } from './utils/resolve-options'
import { mahoVirtualConfigPlugin } from './plugins/virtual-config'
import { mahoFederationPlugin } from './plugins/federation'
import { mahoCSSModulesPlugin } from './plugins/css-modules'
import { mahoLoadingPlugin } from './plugins/loading'
import { mahoTypeRegistryPlugin } from './plugins/type-registry'
import type { MahoPluginOptions } from './types'

/**
 * Maho 主插件：按 role 自动组合所有子插件。
 *
 * 使用示例：
 * ```ts
 * // host vite.config.ts
 * import { maho } from '@maho/vite-plugin'
 * import vue from '@vitejs/plugin-vue'
 *
 * export default {
 *   plugins: [
 *     vue(),
 *     await maho({
 *       role: 'host',
 *       name: 'host',
 *       bootAdapter: '@maho/boot-vue',
 *       federation: {
 *         remotes: ['https://cdn.org.com/module-order/remoteEntry.js'],
 *       },
 *     }),
 *   ],
 * }
 * ```
 *
 * ```ts
 * // remote vite.config.ts
 * export default {
 *   plugins: [
 *     vue(),
 *     await maho({
 *       role: 'remote',
 *       name: 'module-order',
 *       bootAdapter: '@maho/boot-vue',
 *       exposes: ['./pages/OrderList', './utils/formatters'],
 *     }),
 *   ],
 * }
 * ```
 */
export async function maho(options: MahoPluginOptions): Promise<Plugin[]> {
  const resolved = resolveOptions(options)

  const plugins: Plugin[] = [
    mahoVirtualConfigPlugin(resolved),
    ...(await mahoFederationPlugin(resolved)),
    mahoCSSModulesPlugin(resolved),
    mahoTypeRegistryPlugin(resolved),
  ]

  if (resolved.role === 'host') {
    plugins.push(mahoLoadingPlugin(resolved))
  }

  return plugins
}

// 命名导出，供高级用户单独组合
export { mahoVirtualConfigPlugin } from './plugins/virtual-config'
export { mahoFederationPlugin } from './plugins/federation'
export { mahoCSSModulesPlugin } from './plugins/css-modules'
export { mahoLoadingPlugin } from './plugins/loading'
export { mahoTypeRegistryPlugin } from './plugins/type-registry'
export { resolveSharedDeps } from './plugins/shared-deps'
export { resolveExposes } from './plugins/auto-exposes'
export { resolveOptions } from './utils/resolve-options'

export type {
  MahoPluginOptions,
  ResolvedMahoPluginOptions,
  MahoFederationOptions,
  MahoLoadingOptions,
  MahoCSSModulesOptions,
  SharedDep,
  SharedDepsMap,
} from './types'
