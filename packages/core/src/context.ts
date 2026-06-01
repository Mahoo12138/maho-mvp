import { Context } from 'cordis'
import type { ConfigService } from './services/config'
import type { ModeService } from './services/mode'
import type { ResolvedMFConfig } from './interfaces/MFConfig'

/**
 * Maho 专用 Context。当前只是 cordis `Context` 的语义别名；
 * 后续若需要在 ctx 上挂载特定属性（如 ctx.projectRoot），
 * 在这里扩展即可，无需改动所有 service 的类型签名。
 */
export class MFContext extends Context {}

declare module 'cordis' {
  interface Context {
    config: ConfigService
    mode: ModeService
  }

  interface Events {
    'config:ready'(resolved: ResolvedMFConfig): void
    'config:resolved'(resolved: ResolvedMFConfig): void
    'config:changed'(payload: { filePath: string }): void
  }
}
