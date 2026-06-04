import { Context, Fiber, Service } from 'cordis'
import { shallowReactive, ref, type Ref } from 'vue'
import type { Dict } from 'cosmokit'
import type { EntryData, EntryInit } from '@maho/devtools/shared'

declare module 'cordis' {
  interface Context {
    $loader: LoaderService
    $entry: LoadState | undefined
  }
}

export function unwrapExports(mod: unknown): unknown {
  return (mod && typeof mod === 'object' && 'default' in mod)
    ? (mod as { default: unknown }).default
    : mod
}

type LoaderFactory = (ctx: Context, url: string) => Promise<Fiber>

function jsLoader(ctx: Context, exports: unknown): Fiber | undefined {
  const plugin = unwrapExports(exports)
  if (typeof plugin !== 'function' && (typeof plugin !== 'object' || plugin === null)) return
  return ctx.plugin(plugin as never, ctx.$entry!.data.value as never)
}

function cssLoader(ctx: Context, link: HTMLLinkElement): Promise<void> {
  ctx.effect(() => {
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, 'Node.appendChild')
  return new Promise((resolve, reject) => {
    link.onload = () => resolve()
    link.onerror = reject
  })
}

const loaders: Dict<LoaderFactory> = {
  async ['.css'](ctx, url) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    return ctx.plugin(cssLoader as never, link as never)
  },
  async [''](ctx, url) {
    const exports = await import(/* @vite-ignore */ url)
    return ctx.plugin(jsLoader as never, exports as never)
  },
}

export interface LoadState {
  fibers: Dict<Fiber>
  data: Ref<unknown>
  methods: string[]
}

/**
 * Install RPC closures on `target` for each method name. Idempotent:
 * safe to call repeatedly. Methods are defined non-enumerable so panel
 * code can iterate `data` for display without seeing the RPC bridges.
 */
function injectMethods(
  ctx: Context,
  entryId: string,
  target: unknown,
  methods: string[] | undefined,
): void {
  if (!target || typeof target !== 'object' || !methods?.length) return
  for (const name of methods) {
    Object.defineProperty(target, name, {
      value: (...args: unknown[]) => ctx.rpc.call(entryId, name, args),
      enumerable: false,
      configurable: true,
      writable: false,
    })
  }
}

/**
 * Listens for `entry:init` messages and dynamically `import()`s each entry's
 * `files`. Each imported module is loaded as a Cordis plugin (`jsLoader`),
 * receiving `ctx.$entry.data` as its config. CSS files become `<link>` tags.
 *
 * This mirrors `webui-main/packages/client/client/plugins/loader.ts` —
 * minus muon delta sync (we use full-snapshot push).
 */
export class LoaderService extends Service {
  static override name = '$loader'

  public version?: string
  public entries = shallowReactive<Dict<LoadState>>({})
  public ready = ref(false)

  /** Resolves on first `entry:init`. Gates `mount()` so the shell only renders after entries register routes. */
  public initTask: Promise<void>

  private _methods: Dict<string[]> = Object.create(null)

  constructor(public override ctx: Context) {
    super(ctx, '$loader')

    ctx.root['$entry'] = undefined as LoadState | undefined

    this.initTask = new Promise((resolve) => {
      ctx.on('entry:init', async (init: EntryInit) => {
        const { version, entries } = init
        if (this.version && version && this.version !== version) {
          window.location.reload()
          return
        }
        this.version = version

        await Promise.all(
          Object.entries(entries).map(([id, body]) =>
            this._processEntry(id, body),
          ),
        )

        if (!this.ready.value) resolve()
        this.ready.value = true
      })
    })
  }

  private async _processEntry(id: string, body: EntryData | null): Promise<void> {
    if (!body) {
      const $entry = this.entries[id]
      if (!$entry) return
      delete this.entries[id]
      delete this._methods[id]
      for (const fiber of Object.values($entry.fibers)) fiber.dispose()
      return
    }

    const { files, data, methods } = body
    let $entry = this.entries[id]
    if ($entry) {
      for (const url of Object.keys($entry.fibers)) {
        if (files.includes(url)) continue
        $entry.fibers[url].dispose()
        delete $entry.fibers[url]
      }
      $entry.data.value = data
    } else {
      $entry = this.entries[id] = {
        fibers: {},
        data: ref(data),
        methods,
      }
    }
    this._methods[id] = methods ?? []
    injectMethods(this.ctx, id, $entry.data.value, methods)

    const ctx = this.ctx.extend({ $entry })
    const pending = files.filter((url) => !$entry!.fibers[url])
    await Promise.all(pending.map(async (url) => {
      for (const ext in loaders) {
        if (ext && !url.endsWith(ext)) continue
        if (!ext && Object.keys(loaders).some((e) => e && url.endsWith(e))) continue
        try {
          ctx.$entry!.fibers[url] = await loaders[ext]!(ctx, url)
        } catch (e) {
          console.error(`[loader] failed to load ${url}:`, e)
        }
        return
      }
    }))
  }
}
