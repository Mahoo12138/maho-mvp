import { createRequire } from 'node:module'
import federation from '@originjs/vite-plugin-federation'
import type { Plugin } from 'vite'
import type { ResolvedMahoPluginOptions, SharedDepsMap } from '../types'
import { resolveSharedDeps } from './shared-deps'
import { resolveExposes } from './auto-exposes'

const require_ = createRequire(import.meta.url)

/**
 * `@originjs/vite-plugin-federation` 在 resolveId 钩子里会自己 resolve
 * `@originjs/vite-plugin-federation` 来定位 `satisfy.mjs`。当 CLI 在 smoke
 * 项目目录下程序化调用 vite 时，子项目自己并不直接依赖 originjs（它来自
 * @maho/vite-plugin 的 transitive dep），rollup 从子项目根目录解析失败，
 * federationId 变成 undefined → `dirname(undefined)` 抛 TypeError。
 *
 * 修复：注入一个高优先级 `resolveId` 插件，把这两个裸名解析为本进程能找到
 * 的绝对路径（@maho/vite-plugin 安装目录下的 node_modules 总能解析到）。
 */
function federationSelfResolvePlugin(): Plugin {
  let federationPkgPath: string | null = null
  try {
    federationPkgPath = require_.resolve('@originjs/vite-plugin-federation')
  } catch {
    /* 极端情况：构建环境里 vite-plugin 自己也找不到 originjs。让 rollup 报原错。 */
  }

  return {
    name: 'maho:federation-self-resolve',
    enforce: 'pre',
    resolveId(id) {
      if (!federationPkgPath) return null
      if (id === '@originjs/vite-plugin-federation') return federationPkgPath
      if (id === '__federation_fn_satisfy') {
        return federationPkgPath.replace(/index\.(m?js)$/, 'satisfy.mjs')
      }
      return null
    },
  }
}

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
): Promise<Plugin[]> {
  const shared = await resolveSharedDeps(options)
  const sharedForFederation = toFederationShared(shared)

  const selfResolve = federationSelfResolvePlugin()

  if (options.role === 'host') {
    return [
      selfResolve,
      federation({
        name: options.name,
        remotes: {},
        shared: sharedForFederation,
      }) as Plugin,
    ]
  }

  const exposes = resolveExposes(options)

  return [
    selfResolve,
    federation({
      name: options.name,
      filename: 'remoteEntry.js',
      exposes,
      shared: sharedForFederation,
    }) as Plugin,
  ]
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
