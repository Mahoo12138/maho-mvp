import { execa } from 'execa'
import { resolveWorkspaceContext } from '../core/workspace'
import { resolveBin } from '../core/bin-resolver'
import { buildBuildPlan } from '../core/topology'
import { logger } from '../utils/logger'

export interface BuildOptions {
  filter?: string
  all?: boolean
  mode?: string
}

interface BuildResult {
  name: string
  ok: boolean
  err?: unknown
}

export async function buildCommand(opts: BuildOptions = {}): Promise<void> {
  const mode = opts.mode ?? 'prod'
  const ctx = await resolveWorkspaceContext(process.cwd(), mode)

  const filter: 'all' | string[] | null = opts.all
    ? 'all'
    : opts.filter
      ? opts.filter.split(',').map((s) => s.trim()).filter(Boolean)
      : null
  const plan = buildBuildPlan(ctx, filter)

  const results: BuildResult[] = []

  // Stage 1: remote 并行
  if (plan.remotes.length) {
    logger.step(`Building ${plan.remotes.length} remote(s) in parallel...`)
    const settled = await Promise.allSettled(
      plan.remotes.map((a) => runViteBuild(a.dir, mode)),
    )
    settled.forEach((r, i) => {
      const name = plan.remotes[i].name
      if (r.status === 'fulfilled') {
        results.push({ name, ok: true })
      }
      else {
        results.push({ name, ok: false, err: r.reason })
        logger.error(`Build failed: ${name}: ${formatError(r.reason)}`)
      }
    })
  }

  // Stage 2: host 串行（host 失败整体退出 1）
  if (plan.host) {
    logger.step('Building host...')
    try {
      await runViteBuild(ctx.root, mode)
      results.push({ name: 'host', ok: true })
    }
    catch (err) {
      results.push({ name: 'host', ok: false, err })
      logger.error(`Build failed: host: ${formatError(err)}`)
      printSummary(results)
      process.exit(1)
    }
  }

  printSummary(results)
  if (results.some((r) => !r.ok)) process.exit(1)
}

async function runViteBuild(cwd: string, mode: string): Promise<void> {
  const viteBin = resolveBin(cwd, 'vite')
  await execa(viteBin, ['build', '--mode', mode], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      NODE_ENV: mode === 'prod' ? 'production' : mode,
    },
  })
}

function printSummary(results: BuildResult[]): void {
  const ok = results.filter((r) => r.ok).length
  process.stdout.write('\n')
  if (ok === results.length) {
    logger.success(`Build complete: ${ok}/${results.length}`)
  }
  else {
    logger.warn(`Build finished with errors: ${ok}/${results.length} succeeded`)
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
