import { Context, Service } from 'cordis'
import { shallowRef, type Ref } from 'vue'
import type { ServerMessage } from '@maho/devtools/shared'

declare module 'cordis' {
  interface Context {
    socket: SocketService
  }

  interface Events {
    'entry:init'(body: ServerMessage extends { type: 'entry:init'; body: infer B } ? B : never): void
    'rpc:response'(body: ServerMessage extends { type: 'rpc:response'; body: infer B } ? B : never): void
  }
}

export interface SocketOptions {
  /** Devtools server URL, e.g. `ws://127.0.0.1:9123`. Defaults to `ws://${location.host}`. */
  endpoint?: string
  /** Reconnect delay ms. Default 2000. */
  reconnectDelay?: number
  /** Ping interval ms. Default 30000. */
  pingInterval?: number
}

/**
 * Owns the WebSocket connection to the devtools server.
 *
 * Emits cordis events (`entry:init`, `rpc:response`, etc.) for each server
 * message, so other services (LoaderService, RpcService) just listen instead
 * of holding their own socket reference.
 */
export class SocketService extends Service {
  static override name = 'socket'

  public socket: Ref<WebSocket | undefined> = shallowRef()

  private _options: Required<SocketOptions>
  private _pingTimer?: ReturnType<typeof setInterval>
  private _reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(public override ctx: Context, options: SocketOptions = {}) {
    super(ctx, 'socket')
    this._options = {
      endpoint: options.endpoint ?? `ws://${location.host}`,
      reconnectDelay: options.reconnectDelay ?? 2000,
      pingInterval: options.pingInterval ?? 30000,
    }

    this.connect()

    ctx.effect(() => () => {
      if (this._pingTimer) clearInterval(this._pingTimer)
      if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
      this.socket.value?.close()
    }, 'SocketService.connect()')
  }

  send(type: string, body: unknown): void {
    const ws = this.socket.value
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type, body }))
  }

  private connect(): void {
    const ws = new WebSocket(this._options.endpoint)
    this.socket.value = ws

    ws.addEventListener('open', () => {
      this._pingTimer = setInterval(() => {
        ws.send(JSON.stringify({ type: 'ping' }))
      }, this._options.pingInterval)
    })

    ws.addEventListener('message', (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }
      // Cast: cordis events tightly typed for known message types; falls back
      // for unknown server message names (e.g. future additions).
      this.ctx.emit(msg.type as 'entry:init', msg.body as never)
    })

    ws.addEventListener('close', () => {
      if (this._pingTimer) {
        clearInterval(this._pingTimer)
        this._pingTimer = undefined
      }
      this.socket.value = undefined
      this._reconnectTimer = setTimeout(() => this.connect(), this._options.reconnectDelay)
    })

    ws.addEventListener('error', () => {
      ws.close()
    })
  }
}
