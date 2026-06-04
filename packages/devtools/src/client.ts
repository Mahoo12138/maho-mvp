import type { Context } from 'cordis'
import type { WebSocket } from 'ws'
import type { ClientMessage, EntryInit, RpcRequest, RpcResponse } from '../shared/index.js'

export class Client {
  readonly id = Math.random().toString(36).slice(2, 10)

  constructor(public ctx: Context, public socket: WebSocket) {
    socket.on('message', this.receive)

    const body: EntryInit = {
      version: ctx.devtools.version,
      entries: Object.fromEntries(
        Object.entries(ctx.devtools.entries).map(([id, e]) => [id, e.toJSON()]),
      ),
    }
    this.send('entry:init', body)
  }

  send(type: string, body: unknown): void {
    if (this.socket.readyState !== 1) return
    this.socket.send(JSON.stringify({ type, body }))
  }

  private receive = async (raw: Buffer): Promise<void> => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (msg.type) {
      case 'ping':
        this.send('pong', {})
        return
      case 'rpc:request':
        await this.handleRpc(msg.body)
        return
    }
  }

  private async handleRpc(body: RpcRequest): Promise<void> {
    const { sn, entryId, method, args } = body
    const entry = this.ctx.devtools.entries[entryId]
    const fn = entry?.data?.[method as keyof typeof entry.data]

    if (typeof fn !== 'function') {
      this.send('rpc:response', {
        sn,
        ok: false,
        message: `no such method: ${entryId}.${method}`,
      } satisfies RpcResponse)
      return
    }

    try {
      const value = await Reflect.apply(fn as (...a: unknown[]) => unknown, entry, args)
      this.send('rpc:response', { sn, ok: true, value } satisfies RpcResponse)
    } catch (err: unknown) {
      this.send('rpc:response', {
        sn,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      } satisfies RpcResponse)
    }
  }
}
