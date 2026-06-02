import { execa, type ResultPromise } from 'execa'
import { colorize, logger, pickPrefixColor, type PrefixColor } from '../utils/logger'
import { resolveBin } from './bin-resolver'

export interface DevTarget {
  name: string
  role: 'host' | 'remote'
  cwd: string
  port: number
  color: PrefixColor
  /** 额外环境变量，叠加在 process.env 之上 */
  env?: Record<string, string>
}

export interface ReadyTarget extends DevTarget {
  url: string
}

const READY_REGEX = /(?:Local|local):\s+(https?:\/\/\S+)/

/**
 * 多进程 dev server 管理器。
 *
 * 职责单一：spawn vite per target，捕获 stdout/stderr 加前缀输出，
 * 嗅探 "Local: URL" 标记 ready，统一关闭。
 *
 * 不做：进程崩溃自动重启（让用户自己决定）；端口冲突协商
 * （由 port-manager 上游解决）；HMR 桥接。
 */
export class ProcessManager {
  private readonly procs = new Map<string, ResultPromise>()
  private readonly targets = new Map<string, DevTarget>()
  private readonly readyURLs = new Map<string, string>()
  private allReadyCb?: (targets: ReadyTarget[]) => void
  private prefixWidth = 0
  private shutdownRequested = false

  onAllReady(cb: (targets: ReadyTarget[]) => void): void {
    this.allReadyCb = cb
  }

  async start(targets: DevTarget[]): Promise<void> {
    this.prefixWidth = Math.max(...targets.map((t) => t.name.length)) + 2
    for (const t of targets) this.targets.set(t.name, t)
    await Promise.all(targets.map((t) => this.startOne(t)))
  }

  private async startOne(target: DevTarget): Promise<void> {
    const viteBin = resolveBin(target.cwd, 'vite')
    const proc = execa(viteBin, ['--port', String(target.port), '--strictPort'], {
      cwd: target.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        ...target.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      reject: false,
    })
    this.procs.set(target.name, proc)

    const prefix = colorize(target.color, `[${target.name}]`.padEnd(this.prefixWidth))

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        process.stdout.write(`${prefix} ${line}\n`)
        const m = line.match(READY_REGEX)
        if (m) this.markReady(target, stripAnsi(m[1]))
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        process.stderr.write(`${prefix} ${line}\n`)
      }
    })

    proc.on('exit', (code) => {
      this.procs.delete(target.name)
      if (this.shutdownRequested) return
      if (code !== 0 && code !== null) {
        logger.warn(`Process "${target.name}" exited with code ${code}`)
      }
    })
  }

  private markReady(target: DevTarget, url: string): void {
    if (this.readyURLs.has(target.name)) return
    this.readyURLs.set(target.name, url)
    if (this.readyURLs.size === this.targets.size && this.allReadyCb) {
      const ready: ReadyTarget[] = [...this.targets.values()].map((t) => ({
        ...t,
        url: this.readyURLs.get(t.name)!,
      }))
      this.allReadyCb(ready)
    }
  }

  /**
   * 优雅关闭：SIGTERM → 3s 后兜底 SIGKILL（手动定时器，
   * 避免依赖 execa.kill 的第二参数 —— 不同版本 TS 类型行为不一致）。
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true
    const procs = [...this.procs.values()]
    for (const proc of procs) {
      proc.kill('SIGTERM')
      const forceKill = setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
      }, 3000)
      proc.once('exit', () => clearTimeout(forceKill))
    }
    await Promise.allSettled(procs)
  }
}

/**
 * 去除 ANSI 颜色码 —— vite 的 Local URL 行可能带颜色，需要 strip
 * 后再展示在我们自己的统一表格里。
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '')
}

/**
 * 给 dev 命令复用的 helper：按顺序选 prefix 颜色，host 总是 cyan。
 */
export function assignColors(
  hostName: string,
  remoteNames: string[],
): Record<string, PrefixColor> {
  const map: Record<string, PrefixColor> = { [hostName]: 'cyan' }
  let idx = 0
  for (const name of remoteNames) {
    let color = pickPrefixColor(idx++)
    // host 已用 cyan，跳过
    while (color === 'cyan') color = pickPrefixColor(idx++)
    map[name] = color
  }
  return map
}
