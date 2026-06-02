import { execa } from 'execa'
import { resolveWorkspaceContext } from '../core/workspace'
import { allocatePort } from '../core/port-manager'
import { buildDevManifestEnv } from '../core/dev-manifest'
import {
  ProcessManager,
  assignColors,
  type DevTarget,
} from '../core/process-manager'
import { resolveDevApps } from '../core/topology'
import { logger } from '../utils/logger'

export interface DevOptions {
  filter?: string
  hostOnly?: boolean
}

export async function devCommand(opts: DevOptions = {}): Promise<void> {
  const ctx = await resolveWorkspaceContext()

  // 在 remote 子包目录中执行 → 重新以 root 为 cwd 执行
  // `maho dev --filter <self>`。spawn 子进程而非内部转发，
  // 避免重复 ConfigService 初始化产生的状态污染。
  if (ctx.role === 'remote' && ctx.currentAppName && ctx.cwd !== ctx.root) {
    logger.info(
      `Detected remote "${ctx.currentAppName}", delegating to workspace root...`,
    )
    const args = ['dev', '--filter', ctx.currentAppName]
    await execa(process.execPath, [process.argv[1], ...args], {
      cwd: ctx.root,
      stdio: 'inherit',
      reject: false,
    })
    return
  }

  const apps = resolveDevApps(ctx, opts)

  const hostPort = await allocatePort(5173)
  const remoteTargets: Omit<DevTarget, 'color'>[] = []
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

  const colors = assignColors(
    'host',
    remoteTargets.map((t) => t.name),
  )
  const manifest = buildDevManifestEnv(
    remoteTargets.map((t) => ({ name: t.name, port: t.port })),
  )

  const targets: DevTarget[] = [
    {
      name: 'host',
      role: 'host',
      cwd: ctx.root,
      port: hostPort,
      color: colors['host'],
      env: { MAHO_DEV_REMOTES: manifest },
    },
    ...remoteTargets.map((t) => ({
      ...t,
      color: colors[t.name],
    })),
  ]

  logger.step(`Starting ${targets.length} process(es)...\n`)

  const pm = new ProcessManager()
  pm.onAllReady((ready) => {
    logger.success('\nAll services ready:')
    for (const t of ready) {
      logger.info(`  ${t.name.padEnd(16)} → ${t.url}`)
    }
    process.stdout.write('\n')
  })
  await pm.start(targets)

  installShutdownHandlers(pm)
}

function installShutdownHandlers(pm: ProcessManager): void {
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('\nShutting down...')
    await pm.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
