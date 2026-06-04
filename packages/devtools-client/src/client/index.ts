import { Context, Service } from 'cordis'
import { createApp, defineComponent, h, markRaw, type App } from 'vue'
import { SocketService, type SocketOptions } from './socket.js'
import { RpcService } from './rpc.js'
import { LoaderService } from './loader.js'
import { RouterService } from './router.js'
import { kContext } from './context.js'

declare module 'cordis' {
  interface Context {
    client: ClientService
  }
}

markRaw(Context.prototype)
markRaw(Service.prototype)

export interface ClientOptions {
  socket?: SocketOptions
  /** Root component for the app shell. */
  root: ReturnType<typeof defineComponent>
}

/**
 * Top-level client service. Owns the Vue app and the sub-services
 * (socket / rpc / loader / router). Plugins access it through
 * `ctx.client` and `ctx.router.page(...)`.
 */
export class ClientService extends Service {
  static override name = 'client'

  public app: App
  public socket!: SocketService
  public rpc!: RpcService
  public loader!: LoaderService
  public router!: RouterService

  constructor(public override ctx: Context, options: ClientOptions) {
    super(ctx, 'client')

    this.app = createApp(options.root)
    this.app.provide(kContext, ctx as Context)

    this.socket = new SocketService(ctx, options.socket)
    this.rpc = new RpcService(ctx)
    this.loader = new LoaderService(ctx)
    this.router = new RouterService(ctx)

    this.router.router.install(this.app)
    this.router.router.ready().catch((e) => {
      console.warn('[client] initial navigation failed:', e)
    })
  }

  mount(selector: string | Element = '#app'): void {
    this.app.mount(selector as never)
  }
}

/**
 * Bootstraps the devtools client runtime: builds a Cordis root context,
 * installs ClientService, returns the root so callers can register
 * panel plugins before mounting.
 *
 *     const root = createClient(App)
 *     root.plugin(configPanelClient)
 *     await root.client.loader.initTask
 *     root.client.mount('#app')
 */
export function createClient(root: ReturnType<typeof defineComponent>, options?: Omit<ClientOptions, 'root'>): Context {
  const ctx = new Context()
  ctx.plugin(ClientService, { ...options, root })
  return ctx
}

export { defineComponent, h }
export * from './context.js'
export * from './loader.js'
export * from './router.js'
export * from './rpc.js'
export * from './socket.js'
