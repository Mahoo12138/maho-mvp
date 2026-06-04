import { Context, Service } from 'cordis'
import { Entry } from './entry.js'
import { Client } from './client.js'
import type { EntryFiles } from '../shared/index.js'
import type { WebSocket } from 'ws'

declare module 'cordis' {
  interface Context {
    devtools: Devtools
  }

  interface Events {
    'devtools/connection'(this: Devtools, client: Client): void
  }
}

export abstract class Devtools extends Service {
  static override name = 'devtools'

  public version = '0.0.1'

  readonly entries: Record<string, Entry> = Object.create(null)
  readonly clients: Record<string, Client> = Object.create(null)

  constructor(public override ctx: Context) {
    super(ctx, 'devtools')
  }

  /** Subclass entry point — given a registered entry, return concrete URLs the client should import. */
  abstract getEntryFiles(entry: Entry): string[]

  /**
   * Per-panel registration. Returned object has `update()` for full-snapshot
   * push and `dispose()` (wired via ctx.effect). `data`'s function members
   * become RPC methods (extracted via `extractMethods`).
   */
  addEntry<T extends object = object>(
    files: EntryFiles,
    data: T,
  ): Entry<T> {
    return new Entry<T>(this.ctx, files, data)
  }

  protected accept(socket: WebSocket): void {
    const client = new Client(this.ctx, socket)
    socket.on('close', () => {
      delete this.clients[client.id]
      this.ctx.emit(this, 'devtools/connection', client)
    })
    this.clients[client.id] = client
    this.ctx.emit(this, 'devtools/connection', client)
  }

  broadcast(type: string, body: unknown): void {
    const payload = JSON.stringify({ type, body })
    for (const client of Object.values(this.clients)) {
      if (client.socket.readyState !== 1) continue
      client.socket.send(payload)
    }
  }
}
