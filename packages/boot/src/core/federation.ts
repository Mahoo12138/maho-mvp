import { shareScope as mahoShareScope } from 'virtual:maho-config'
import type { FederationConfig } from '../interfaces/MahoOptions'
import type {
  FederationManifest,
  ManifestRemoteEntry,
  RemoteModule,
} from '../interfaces/RemoteModule'
import { registerRemote } from './registry'

/**
 * 加载所有联邦远端。
 * - 静态 remotes 与动态 manifest 合并（动态优先，按 name 覆盖）
 * - 并行加载，单个失败不阻断整体
 * - 加载成功的 remote 自动注册到模块级 registry
 */
export async function loadFederation(
  config: FederationConfig,
): Promise<RemoteModule[]> {
  const entries = await resolveManifest(config)

  const results = await Promise.allSettled(
    entries.map((entry) => loadRemoteEntry(entry)),
  )

  const loaded: RemoteModule[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      registerRemote(r.value)
      loaded.push(r.value)
    } else {
      console.warn('[Maho] Failed to load remote:', r.reason)
    }
  }
  return loaded
}

/**
 * 合并静态 remotes 与可选 manifest。动态条目按 name 覆盖同名静态条目。
 */
async function resolveManifest(
  config: FederationConfig,
): Promise<ManifestRemoteEntry[]> {
  const byName = new Map<string, ManifestRemoteEntry>()
  for (const entry of (config.remotes ?? [])) {
    byName.set(entry.name, entry)
  }

  if (config.manifestUrl) {
    try {
      const res = await fetch(config.manifestUrl)
      if (res.ok) {
        const manifest = (await res.json()) as FederationManifest
        for (const entry of manifest.remotes ?? []) {
          byName.set(entry.name, entry)
        }
      } else {
        console.warn(
          `[Maho] Manifest fetch returned HTTP ${res.status} for ${config.manifestUrl}`,
        )
      }
    } catch (err) {
      console.warn(
        `[Maho] Failed to fetch manifest ${config.manifestUrl}, falling back to static remotes:`,
        err,
      )
    }
  }

  return [...byName.values()]
}

/**
 * 加载单个 remoteEntry：动态 import() → 获取 { get, init } 导出 → init shareScope → 返回 RemoteModule。
 * 带 3 次重试（500/1000/1500ms 间隔）。
 */
async function loadRemoteEntry(
  entry: ManifestRemoteEntry,
): Promise<RemoteModule> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await loadRemoteEntryOnce(entry)
    } catch (err) {
      lastErr = err
      if (attempt < 3) await sleep(attempt * 500)
    }
  }
  throw lastErr ?? new Error(`Remote unreachable: ${entry.entry}`)
}

async function loadRemoteEntryOnce(
  entry: ManifestRemoteEntry,
): Promise<RemoteModule> {
  // originjs 的 remoteEntry.js 是 ES module，exports { get, init }，
  // 不注册 window 上的 container。直接用 import() 获取。
  // 动态 URL（http://...）不会被 Vite 解析，直接走浏览器原生 import()
  const container: FederationContainer = await import(entry.entry)

  if (typeof container.get !== 'function') {
    throw new Error(
      `[Maho] Remote "${entry.name}" entry did not export "get" — ` +
        `expected an @originjs/vite-plugin-federation remote entry`,
    )
  }

  if (typeof container.init === 'function') {
    try {
      container.init(mahoShareScope)
    } catch {
      /* 重复 init 可能抛错，忽略 */
    }
  }

  return {
    name: entry.name,
    entry: entry.entry,
    isReady: true,
    async load(exposePath: string) {
      const factory = await container.get(exposePath)
      if (typeof factory !== 'function') {
        throw new Error(
          `[Maho] Expose "${exposePath}" in remote "${entry.name}" did not return a factory`,
        )
      }
      return factory()
    },
  }
}

interface FederationContainer {
  init?(shareScope: unknown): void
  get(exposePath: string): Promise<() => unknown> | (() => unknown)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
