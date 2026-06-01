import { Service } from 'cordis'
import type { MFContext } from '../context'

/**
 * 极简模式服务。保存当前 mode 字符串，方便插件做 dev/prod 分支判断。
 *
 * mode 由 CLI 决定（默认 `dev`），运行期不变 —— 切换 mode 等价于
 * 重启进程，所以不提供 setter。
 */
export class ModeService extends Service {
  readonly current: string

  constructor(ctx: MFContext, mode: string) {
    super(ctx, 'mode')
    this.current = mode
  }

  get isDev(): boolean {
    return this.current === 'dev'
  }

  get isProd(): boolean {
    return this.current === 'prod'
  }
}
