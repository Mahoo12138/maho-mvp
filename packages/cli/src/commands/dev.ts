import pc from 'picocolors'
import { NodeDevtools, configPanel } from '@maho/devtools'
import { resolveWorkspaceContext, type AppInfo } from '../core/workspace'
import { allocatePort } from '../core/port-manager'
import {
  startHostDevServer,
  startRemotePreviewServer,
  type ViteTarget,
} from '../core/vite-runner'
import {
  pickPrefixColor,
  colorize,
  logger,
  type PrefixColor,
} from '../utils/logger'

export interface DevOptions {
  filter?: string
  hostOnly?: boolean
  /** Enable in-browser devtools panel. Default true. */
  devtools?: boolean
  /** Devtools server port. Default 9123 (auto-allocates if taken). */
  devtoolsPort?: number
  /** Auto-open devtools in browser. Default false. */
  open?: boolean
}

interface RunningTarget extends ViteTarget {
  color: PrefixColor
  url: string
  close: () => Promise<void>
}

export async function devCommand(opts: DevOptions = {}): Promise<void> {
  const ctx = await resolveWorkspaceContext()

  // remote 子包目录中执行 → 自动 filter 到当前 app（同进程，无需 spawn）
  let filter = opts.filter
  if (ctx.role === 'remote' && ctx.currentAppName && !filter && !opts.hostOnly) {
    filter = ctx.currentAppName
    logger.info(`Detected remote "${ctx.currentAppName}", limiting dev to this app + host.`)
  }

  const apps = resolveApps(ctx.apps, filter, opts.hostOnly)

  const hostPort = await allocatePort(5173)
  const hostName = ctx.hostConfig.name ?? 'host'

  const remoteTargets: ViteTarget[] = []
  let nextPort = hostPort + 1
  for (const app of apps) {
    const port = await allocatePort(nextPort)
    nextPort = port + 1
    remoteTargets.push({
      name: app.name,
      role: 'remote',
      cwd: app.dir,
      port,
    })
  }

  const devRemotes: Record<string, string> = {}
  for (const t of remoteTargets) {
    // originjs federation 输出到 `${assetsDir}/${filename}`，默认 assetsDir=assets
    devRemotes[t.name] = `http://127.0.0.1:${t.port}/assets/remoteEntry.js`
  }

  const hostTarget: ViteTarget = {
    name: hostName,
    role: 'host',
    cwd: ctx.root,
    port: hostPort,
    devRemotes,
  }

  // 启动顺序：remote 优先（build + preview 出 remoteEntry.js），
  // 再起 host —— host 一加载就能解析 federation 入口，不会卡 loading。
  const orderedTargets: ViteTarget[] = [...remoteTargets, hostTarget]
  const prefixWidth = Math.max(...orderedTargets.map((t) => t.name.length)) + 2

  logger.step(`Building ${remoteTargets.length} remote(s), then starting host...\n`)

  const running: RunningTarget[] = []
  const colorMap = new Map<string, PrefixColor>()
  colorMap.set(hostName, 'cyan')
  remoteTargets.forEach((t, i) => colorMap.set(t.name, pickPrefixColor(i + 1)))

  for (const t of orderedTargets) {
    const color = colorMap.get(t.name) ?? 'green'
    const label = colorize(color, `[${t.name}]`.padEnd(prefixWidth))
    try {
      const handle =
        t.role === 'host'
          ? await startHostDevServer(t)
          : await startRemotePreviewServer(t)
      running.push({ ...t, color, url: handle.url, close: handle.close })
      process.stdout.write(`${label} ready: ${handle.url}\n`)
    }
    catch (err) {
      logger.error(`Failed to start "${t.name}": ${(err as Error).message}`)
      await shutdownAll(running)
      process.exit(1)
    }
  }

  process.stdout.write('\n')
  logger.success('All services ready:')
  for (const t of running) {
    const label = colorize(t.color, `  ${t.name.padEnd(prefixWidth)}`)
    process.stdout.write(`${label} ${pc.dim('→')} ${t.url}\n`)
  }

  let devtoolsCleanup: (() => Promise<void>) | undefined
  if (opts.devtools !== false) {
    const port = await allocatePort(opts.devtoolsPort ?? 9123)
    try {
      await ctx.mahoCtx.plugin(NodeDevtools, { port, open: opts.open, devMode: true })
      await ctx.mahoCtx.plugin(configPanel)
      const devtoolsLabel = colorize('magenta', `  ${'devtools'.padEnd(prefixWidth)}`)
      process.stdout.write(`${devtoolsLabel} ${pc.dim('→')} http://127.0.0.1:${port}/\n`)
      devtoolsCleanup = async (): Promise<void> => {
        await ctx.mahoCtx.fiber.dispose()
      }
    } catch (err) {
      logger.warn(`Devtools failed to start: ${(err as Error).message}`)
    }
  }
  process.stdout.write('\n')

  installShutdownHandlers(running, devtoolsCleanup)
}

function resolveApps(
  apps: AppInfo[],
  filter: string | undefined,
  hostOnly: boolean | undefined,
): AppInfo[] {
  if (hostOnly) return []
  if (!filter || filter === 'all') return apps
  const names = filter.split(',').map((s) => s.trim()).filter(Boolean)
  const found = apps.filter((a) => names.includes(a.name))
  const missing = names.filter((n) => !apps.some((a) => a.name === n))
  if (missing.length) logger.warn(`Apps not found in workspace: ${missing.join(', ')}`)
  return found
}

async function shutdownAll(running: RunningTarget[]): Promise<void> {
  await Promise.allSettled(running.map((r) => r.close()))
}

function installShutdownHandlers(
  running: RunningTarget[],
  devtoolsCleanup?: () => Promise<void>,
): void {
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('\nShutting down...')
    if (devtoolsCleanup) {
      await devtoolsCleanup().catch(() => undefined)
    }
    await shutdownAll(running)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
