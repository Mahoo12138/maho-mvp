import federation from '@originjs/vite-plugin-federation'
import type { Plugin } from 'vite'
import type { ResolvedMahoPluginOptions, SharedDepsMap } from '../types'
import { resolveSharedDeps } from './shared-deps'
import { resolveExposes } from './auto-exposes'

/**
 * Maho 联邦插件：包装 @originjs/vite-plugin-federation。
 *
 * 设计取舍（详见 docs/design-optimizations.md）：
 *
 * 1. Host 角色下，本插件传给底层的 `remotes` 为空对象 —— Maho 的
 *    `loadFederation` 在运行时通过 `virtual:maho-config` 拿到 URL 列表，
 *    用动态 `<script>` 注入 + container.init/get 直接驱动 federation runtime。
 *    优势：dynamic manifest 完全运行时生效，Host 无需重新构建。
 *
 * 2. shared 字段仅传 `singleton` + `requiredVersion`（webpack 的 `eager`
 *    在 vite-plugin-federation 里没有对应概念，已剥除）。
 *
 * 3. Remote 角色下，exposes 在 `auto-exposes.ts` 中按文件存在性自动追加
 *    `./mf-meta` 和 `./mf-routes`，子包源码侧无需手写 vite.config。
 */
export async function mahoFederationPlugin(
  options: ResolvedMahoPluginOptions,
): Promise<Plugin> {
  const shared = await resolveSharedDeps(options)
  const sharedForFederation = toFederationShared(shared)

  if (options.role === 'host') {
    return federation({
      name: options.name,
      remotes: {},
      shared: sharedForFederation,
    }) as Plugin
  }

  const exposes = resolveExposes(options)

  return federation({
    name: options.name,
    filename: 'remoteEntry.js',
    exposes,
    shared: sharedForFederation,
  }) as Plugin
}

/**
 * 转换为 @originjs/vite-plugin-federation 接受的形态。
 * 只保留 singleton 与 requiredVersion，其余字段忽略。
 */
function toFederationShared(
  shared: SharedDepsMap,
): Record<string, { singleton?: boolean; requiredVersion?: string }> {
  const result: Record<string, { singleton?: boolean; requiredVersion?: string }> = {}
  for (const [name, dep] of Object.entries(shared)) {
    result[name] = {
      singleton: dep.singleton ?? false,
      requiredVersion: dep.requiredVersion ?? dep.version ?? '*',
    }
  }
  return result
}
