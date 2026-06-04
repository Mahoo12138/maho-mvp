import type { Context } from 'cordis'
import type {} from '@maho/core'
import type { ConfigPanelData } from '../../shared/index.js'

export type { ConfigPanelData }

/**
 * Server-side Config panel plugin. Registers an entry whose `data` exposes:
 *  - reactive snapshot of `ctx.config.{base,current,resolved}`
 *  - `mode`
 *  - `reload()` RPC method
 *
 * Client `source` lives in `@maho/devtools-client/src/panels/config.ts` —
 * loaded by the client's LoaderService and registers a Vue page via
 * `ctx.router.addRoute('/config', ...)`.
 */
export const configPanel = {
  name: 'configPanel',
  inject: ['devtools', 'config', 'mode'],
  apply(ctx: Context): void {
    const entry = ctx.devtools.addEntry<ConfigPanelData>(
      {
        baseUrl: import.meta.url,
        // Cross-package relative path — server is packages/devtools/src/panels/,
        // client is packages/devtools-client/src/panels/.
        source: '../../../devtools-client/src/panels/config.ts',
        routes: ['/config'],
      },
      {
        base: ctx.config.base,
        current: ctx.config.current,
        resolved: ctx.config.resolved,
        mode: ctx.mode.current,
        async reload() {
          await ctx.config.reload(ctx.mode.current)
          entry.update((d) => {
            d.base = ctx.config.base
            d.current = ctx.config.current
            d.resolved = ctx.config.resolved
          })
        },
      },
    )

    ctx.on('config:resolved', () => {
      entry.update((d) => {
        d.base = ctx.config.base
        d.current = ctx.config.current
        d.resolved = ctx.config.resolved
      })
    })
  },
}
