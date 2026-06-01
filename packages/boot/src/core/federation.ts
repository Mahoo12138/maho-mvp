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
  const fromStatic: ManifestRemoteEntry[] = (config.remotes ?? []).map(
    (url) => ({ name: inferNameFromUrl(url), entry: url }),
  )

  if (!config.manifestUrl) return fromStatic

  let manifest: FederationManifest | null = null
  try {
    const res = await fetch(config.manifestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest = (await res.json()) as FederationManifest
  } catch (err) {
    console.warn(
      `[Maho] Failed to fetch manifest ${config.manifestUrl}, falling back to static remotes:`,
      err,
    )
    return fromStatic
  }

  const byName = new Map<string, ManifestRemoteEntry>()
  for (const entry of fromStatic) byName.set(entry.name, entry)
  for (const entry of manifest.remotes ?? []) byName.set(entry.name, entry)
  return [...byName.values()]
}

/**
 * 从 URL 推断模块名：取倒数第二段（典型 .../module-order/remoteEntry.js → module-order）。
 * 推断失败则用 entry.js 前缀，再失败则用整个 URL 哈希作为兜底 key。
 */
function inferNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      const candidate = parts[parts.length - 2]
      if (candidate) return candidate
    }
    const file = parts[parts.length - 1] ?? ''
    if (file && file !== 'remoteEntry.js') {
      return file.replace(/\.[mc]?js$/, '')
    }
  } catch {
    /* fall through */
  }
  return `remote_${hashString(url)}`
}

function hashString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

/**
 * 加载单个 remoteEntry.js：脚本注入 → 等待 container 暴露 → init shareScope → 返回 RemoteModule。
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
  if (typeof window === 'undefined') {
    throw new Error('[Maho] loadRemoteEntry requires a browser environment')
  }

  await injectScript(entry.entry, entry.integrity)

  const container = (window as any)[entry.name] as FederationContainer | undefined
  if (!container || typeof container.get !== 'function') {
    throw new Error(
      `[Maho] Remote container "${entry.name}" not found on window after loading ${entry.entry}`,
    )
  }

  const shareScope = (window as any).__federation_shared__ ?? {}
  if (typeof container.init === 'function') {
    try {
      await container.init(shareScope)
    } catch {
      /* 多次 init 在某些实现里会抛错，忽略即可 */
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
  init?(shareScope: unknown): unknown
  get(exposePath: string): Promise<() => unknown> | (() => unknown)
}

function injectScript(src: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('[Maho] document is not available'))
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-maho-remote="${cssEscape(src)}"]`,
    )
    if (existing) {
      if (existing.dataset.mahoLoaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error(`[Maho] Script load error: ${src}`)),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.type = 'text/javascript'
    script.async = true
    script.dataset.mahoRemote = src
    if (integrity) script.integrity = integrity
    script.addEventListener(
      'load',
      () => {
        script.dataset.mahoLoaded = 'true'
        resolve()
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => reject(new Error(`[Maho] Script load error: ${src}`)),
      { once: true },
    )
    document.head.appendChild(script)
  })
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
