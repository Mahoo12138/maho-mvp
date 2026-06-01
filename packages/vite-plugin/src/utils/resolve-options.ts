import path from 'node:path'
import { readPackageJsonSafe } from './pkg'
import type {
  MahoPluginOptions,
  ResolvedMahoPluginOptions,
} from '../types'

export function resolveOptions(
  options: MahoPluginOptions,
): ResolvedMahoPluginOptions {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const pkg = readPackageJsonSafe(projectRoot)

  const name =
    options.name ?? pkg.maho?.name ?? pkg.name ?? defaultName(options.role)

  if (options.role === 'remote' && !options.name && !pkg.maho?.name) {
    console.warn(
      `[Maho] role=remote without "name" option — falling back to package.json name "${name}". ` +
        `Set MahoPluginOptions.name explicitly to silence this warning.`,
    )
  }

  const version = options.version ?? pkg.version ?? '0.0.0'
  const mode = options.mode ?? inferMode()

  return {
    role: options.role,
    name,
    version,
    mode,
    federation: {
      remotes: options.federation?.remotes ?? [],
      manifestUrl: options.federation?.manifestUrl ?? null,
      devRemotes: options.federation?.devRemotes ?? readDevRemotesFromEnv(),
    },
    exposes: options.exposes ?? [],
    shared: options.shared ?? {},
    bootAdapter: options.bootAdapter ?? null,
    inlineRoutes: options.inlineRoutes ?? [],
    loading: {
      html: options.loading?.html ?? null,
      background: options.loading?.background ?? '#ffffff',
      color: options.loading?.color ?? '#6366f1',
      disabled: options.loading?.disabled ?? false,
    },
    cssModules: {
      generateScopedName:
        options.cssModules?.generateScopedName ?? '[local]__[hash:base64:5]',
      disabled: options.cssModules?.disabled ?? false,
    },
    emitTypes: options.emitTypes ?? true,
    projectRoot,
  }
}

function defaultName(role: 'host' | 'remote'): string {
  return role === 'host' ? 'host' : 'remote'
}

function inferMode(): string {
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
}

/**
 * 从 MAHO_DEV_REMOTES 环境变量读取 CLI ProcessManager 注入的开发地址。
 * 格式：JSON 数组 `[{"name":"module-x","entry":"http://localhost:5174/remoteEntry.js"}]`
 */
function readDevRemotesFromEnv(): Record<string, string> {
  const raw = process.env.MAHO_DEV_REMOTES
  if (!raw) return {}
  try {
    const arr = JSON.parse(raw) as Array<{ name: string; entry: string }>
    return Object.fromEntries(arr.map((r) => [r.name, r.entry]))
  } catch (err) {
    console.warn('[Maho] Failed to parse MAHO_DEV_REMOTES env var:', err)
    return {}
  }
}
