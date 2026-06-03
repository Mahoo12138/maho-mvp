import { readFileSync } from 'node:fs'
import { cac } from 'cac'
import { devCommand } from './commands/dev'
import { buildCommand } from './commands/build'
import { initCommand } from './commands/init'
import { addCommand } from './commands/add'
import { logger } from './utils/logger'
import { MahoError } from './utils/errors'

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }

const cli = cac('maho')

cli
  .command('dev', 'Start dev servers for host + selected remotes')
  .option('--filter <names>', 'Comma-separated app names, or "all"')
  .option('--host-only', 'Start host only')
  .action((options) => {
    return devCommand({
      filter: options.filter,
      hostOnly: options['hostOnly'],
    }).catch(handleError)
  })

cli
  .command('build', 'Build current package, filtered apps, or all')
  .option('--filter <names>', 'Comma-separated app names')
  .option('--all', 'Build all remotes + host (remotes parallel, host serial)')
  .option('--mode <mode>', 'Build mode (default: prod)')
  .action((options) => {
    return buildCommand({
      filter: options.filter,
      all: options['all'],
      mode: options['mode'],
    }).catch(handleError)
  })

cli
  .command('init [name]', 'Create a new Maho workspace')
  .action((name) => {
    return initCommand(name).catch(handleError)
  })

cli
  .command('add [name]', 'Add a new remote app to the workspace')
  .action((name) => {
    return addCommand(name).catch(handleError)
  })

cli.help()
cli.version(pkg.version)

cli.parse()

function handleError(err: unknown): never {
  if (err instanceof MahoError) {
    logger.error(err.message)
    process.exit(1)
  }
  // 未预期的错误：打完整 stack 方便排查
  console.error(err)
  process.exit(1)
}

process.on('unhandledRejection', handleError)
