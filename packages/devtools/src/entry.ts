import type { Context } from 'cordis'
import type { EntryData, EntryFiles } from '../shared/index.js'
import { extractMethods, stripMethods } from './utils.js'

export class Entry<T extends object = object> {
  public id = Math.random().toString(36).slice(2, 10)
  public dispose: () => void

  private _disposed = false

  constructor(
    public ctx: Context,
    public files: EntryFiles,
    public data: T,
  ) {
    ctx.devtools.entries[this.id] = this as unknown as Entry
    queueMicrotask(() => {
      if (this._disposed) return
      this.broadcast()
    })

    this.dispose = ctx.effect(() => () => {
      this._disposed = true
      delete ctx.devtools.entries[this.id]
      ctx.devtools.broadcast('entry:init', {
        version: ctx.devtools.version,
        entries: { [this.id]: null },
      })
    }, 'ctx.devtools.addEntry()')
  }

  /** Full-snapshot push. devtools updates are low-frequency, so no delta. */
  update(fn?: (data: T) => void): void {
    if (this._disposed) return
    if (fn) fn(this.data)
    this.broadcast()
  }

  toJSON(): EntryData {
    return {
      files: this.ctx.devtools.getEntryFiles(this),
      data: stripMethods(this.data),
      methods: extractMethods(this.data),
    }
  }

  private broadcast(): void {
    this.ctx.devtools.broadcast('entry:init', {
      version: this.ctx.devtools.version,
      entries: { [this.id]: this.toJSON() },
    })
  }
}
