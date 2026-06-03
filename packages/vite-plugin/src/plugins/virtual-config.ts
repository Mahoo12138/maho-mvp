import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import type { MahoStaticConfig } from '@maho/boot/types'
import type { ResolvedMahoPluginOptions } from '../types'

const require_ = createRequire(import.meta.url)

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
      const shareScopeSource = buildShareScopeSource(options.shared, options.projectRoot)
      return [
        `export const shareScope = ${shareScopeSource}`,
        `export default ${JSON.stringify(config, null, 2)}`,
      ].join('\n') + '\n'
    },
    handleHotUpdate() {
      // Step 2 不实现配置热更新；Step 3 接入 WatchService 后由其驱动。
      return
    },
  }
}

interface RemoteEntry {
  name: string
  entry: string
}

function buildStaticConfig(
  options: ResolvedMahoPluginOptions,
): MahoStaticConfig {
  const isDev = options.mode === 'dev'
  const remotes = resolveRemotes(options, isDev)

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

function resolveRemotes(
  options: ResolvedMahoPluginOptions,
  isDev: boolean,
): RemoteEntry[] {
  const byName = new Map<string, string>()

  // 静态 remotes — 从 URL 推断 name（prod URL 形如 …/module-x/remoteEntry.js）
  for (const url of (options.federation.remotes ?? [])) {
    const name = inferNameFromUrl(url)
    byName.set(name, url)
  }

  // dev 覆盖 / 追加（dev 模式下 CLI 注入）
  if (isDev) {
    for (const [name, url] of Object.entries(options.federation.devRemotes)) {
      byName.set(name, url)
    }
  }

  return [...byName.entries()].map(([name, entry]) => ({ name, entry }))
}

function inferNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    // 典型 URL：…/module-order/remoteEntry.js → module-order
    if (parts.length >= 2) {
      const candidate = parts[parts.length - 2]
      // 排除常见子目录名
      if (candidate && !['assets', 'dist'].includes(candidate)) {
        return candidate
      }
    }
    const file = parts[parts.length - 1] ?? ''
    if (file && file !== 'remoteEntry.js') {
      return file.replace(/\.[mc]?js$/, '')
    }
  } catch {
    /* fall through */
  }
  return `remote_${Math.abs(hashString(url)).toString(36)}`
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return h
}

/**
 * 生成 host shareScope 源代码，用于在 runtime 传给 remote 的 init()。
 *
 * 格式遵循 originjs 联邦运行时期望：
 *   { 'pkg': { '<version>': { get: () => import('pkg') } } }
 *
 * import() 中的裸说明符会经过 Vite transform 管线重写为预打包 dep URL，
 * 因此 remote init 后使用的 shared singleton 会指向 host 端的同一实例。
 */
function buildShareScopeSource(
  shared: Record<string, { singleton?: boolean; requiredVersion?: string; version?: string }>,
  projectRoot: string,
): string {
  const entries = Object.entries(shared)
  if (entries.length === 0) return '{}'

  const lines = entries.map(([name, dep]) => {
    // 始终解析实际安装版本作为 shareScope key。requiredVersion 是 semver
    // range（如 ^2.1.0），不能直接当版本键用 —— remote runtime 调用
    // satisfy(versionKey, requiredVersion) 要求 versionKey 是具体版本号。
    const version =
      dep.version ?? resolvePackageVersion(name, projectRoot)
    return [
      `  "${name}": {`,
      `    "${version}": {`,
      `      get: () => () => import("${name}")`,
      `    }`,
      `  }`,
    ].join('\n')
  })

  return '{\n' + lines.join(',\n') + '\n}'
}

function resolvePackageVersion(name: string, projectRoot: string): string {
  try {
    const pkgPath = require_.resolve(`${name}/package.json`, {
      paths: [projectRoot],
    })
    const pkg = require_(pkgPath) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
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
