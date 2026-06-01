import type { ResolvedMahoPluginOptions, SharedDepsMap } from '../types'

/**
 * 解析最终共享依赖配置。
 *
 * 来源（按优先级递增，后者覆盖前者）：
 *   1. bootAdapter（如 '@maho/boot-vue'）的 sharedDeps 导出
 *   2. options.shared（用户在 config.yml 中追加的）
 *
 * 注：原设计文档提到 `eager: true` 是 webpack 概念，
 * @originjs/vite-plugin-federation 不支持，已在 resolveSharedForFederation 中忽略。
 * 详见 docs/design-optimizations.md。
 */
export async function resolveSharedDeps(
  options: ResolvedMahoPluginOptions,
): Promise<SharedDepsMap> {
  let bootShared: SharedDepsMap = {}

  if (options.bootAdapter) {
    bootShared = await readBootAdapterSharedDeps(options.bootAdapter)
  }

  return { ...bootShared, ...options.shared }
}

async function readBootAdapterSharedDeps(
  adapterName: string,
): Promise<SharedDepsMap> {
  try {
    const mod: any = await import(adapterName)
    const exported = mod?.sharedDeps ?? mod?.default?.sharedDeps
    if (!exported || typeof exported !== 'object') {
      console.warn(
        `[Maho] "${adapterName}" does not export a "sharedDeps" object; ` +
          `host/remote will be built without framework shared deps.`,
      )
      return {}
    }
    return normalizeSharedShape(exported)
  } catch (err) {
    console.warn(
      `[Maho] Failed to import "${adapterName}" for sharedDeps:`,
      err,
    )
    return {}
  }
}

/**
 * 适配包导出的形态可能包含 eager / version 等额外字段，
 * 此处统一为框架内部使用的形状。
 */
function normalizeSharedShape(input: Record<string, any>): SharedDepsMap {
  const result: SharedDepsMap = {}
  for (const [name, dep] of Object.entries(input)) {
    if (!dep || typeof dep !== 'object') continue
    result[name] = {
      singleton: dep.singleton,
      requiredVersion: dep.requiredVersion ?? dep.version,
      version: dep.version,
    }
  }
  return result
}
