import type { Plugin } from 'vite'
import type { MahoStaticConfig } from '@maho/boot/types'
import type { ResolvedMahoPluginOptions } from '../types'

const VIRTUAL_ID = 'virtual:maho-config'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * 提供 `virtual:maho-config` 虚拟模块。
 *
 * - dev：remotes 用 devRemotes 覆盖（CLI ProcessManager 注入），
 *        若 devRemote 中有对应 name 但静态 remotes 没有，则追加
 * - prod：直接使用静态 remotes
 *
 * 实际内容随 options 解析后生成，dev 模式下 viteServer.watcher
 * 监听 config 变更可触发 HMR（Step 3 由 ConfigService 接管，本步直接静态返回）。
 */
export function mahoVirtualConfigPlugin(
  options: ResolvedMahoPluginOptions,
): Plugin {
  return {
    name: 'maho:virtual-config',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      const config = buildStaticConfig(options)
      return `export default ${JSON.stringify(config, null, 2)}\n`
    },
    handleHotUpdate() {
      // Step 2 不实现配置热更新；Step 3 接入 WatchService 后由其驱动。
      return
    },
  }
}

function buildStaticConfig(
  options: ResolvedMahoPluginOptions,
): MahoStaticConfig {
  const isDev = options.mode === 'dev'

  // remotes 合并：静态 + dev 覆盖（dev 模式）
  let remotes = options.federation.remotes
  if (isDev && Object.keys(options.federation.devRemotes).length > 0) {
    remotes = mergeDevRemotes(remotes, options.federation.devRemotes)
  }

  return {
    role: options.role,
    mode: options.mode,
    federation: {
      remotes,
      manifestUrl: options.federation.manifestUrl,
    },
    inlineRoutes: options.inlineRoutes,
    shared: normalizeSharedForRuntime(options.shared),
    loading:
      options.loading.disabled
        ? undefined
        : {
            ...(options.loading.html != null
              ? { html: options.loading.html }
              : {}),
            background: options.loading.background,
            color: options.loading.color,
          },
  }
}

function mergeDevRemotes(
  staticRemotes: string[],
  devRemotes: Record<string, string>,
): string[] {
  const replaced = new Set<string>()
  const result = staticRemotes.map((url) => {
    for (const [name, devUrl] of Object.entries(devRemotes)) {
      if (urlMatchesName(url, name)) {
        replaced.add(name)
        return devUrl
      }
    }
    return url
  })
  for (const [name, devUrl] of Object.entries(devRemotes)) {
    if (!replaced.has(name)) result.push(devUrl)
  }
  return result
}

function urlMatchesName(url: string, name: string): boolean {
  return url.includes(`/${name}/`) || url.includes(`/${name}.`)
}

/**
 * `virtual:maho-config` 中的 shared 形态仅保留运行时关心的两个字段。
 */
function normalizeSharedForRuntime(
  shared: Record<string, { singleton?: boolean; requiredVersion?: string }>,
): MahoStaticConfig['shared'] {
  const result: MahoStaticConfig['shared'] = {}
  for (const [name, dep] of Object.entries(shared)) {
    result[name] = {
      singleton: dep.singleton ?? false,
      requiredVersion: dep.requiredVersion ?? '*',
    }
  }
  return result
}
