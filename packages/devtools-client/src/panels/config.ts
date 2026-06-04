import type { Context } from 'cordis'
import type {} from '../client/router.js'
import ConfigPanel from './config.vue'

/**
 * Client-side Config panel plugin. Loaded dynamically by
 * `LoaderService` once the server sends `entry:init`; registers a
 * route + sidebar entry through `ctx.router.page`.
 *
 * The Vue component reads server-pushed data through
 * `useRpc<ConfigPanelData>()` (which reads `ctx.$entry!.data`).
 */
export default function (ctx: Context): void {
  ctx.router.page({
    path: '/config',
    name: 'Config',
    component: ConfigPanel,
    order: 0,
  })
}
