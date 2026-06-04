import { Context, Service } from 'cordis'
import { watch } from 'vue'
import type { RpcResponse } from '@maho/devtools/shared'

declare module 'cordis' {
  interface Context {
    rpc: RpcService
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Client-side RPC. `call(entryId, method, args)` returns a Promise that
 * resolves with the server method's return value. Sn-based correlation.
 */
export class RpcService extends Service {
  static override name = 'rpc'

  private _sn = 0
  private _pending = new Map<number, Pending>()

  constructor(public override ctx: Context) {
    super(ctx, 'rpc')

    ctx.on('rpc:response', (body: RpcResponse) => {
      const pending = this._pending.get(body.sn)
      if (!pending) return
      this._pending.delete(body.sn)
      if (body.ok) pending.resolve(body.value)
      else pending.reject(new Error(body.message ?? 'rpc error'))
    })

    ctx.effect(() => watch(ctx.socket.socket, (value) => {
      if (value) return
      const error = new Error('socket disconnected')
      for (const [, pending] of this._pending) pending.reject(error)
      this._pending.clear()
    }))
  }

  call(entryId: string, method: string, args: unknown[]): Promise<unknown> {
    const ws = this.ctx.socket.socket.value
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('socket not connected'))
    }
    const sn = ++this._sn
    return new Promise<unknown>((resolve, reject) => {
      this._pending.set(sn, { resolve, reject })
      ws.send(JSON.stringify({
        type: 'rpc:request',
        body: { sn, entryId, method, args },
      }))
    })
  }
}
