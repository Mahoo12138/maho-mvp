import path from 'node:path'
import fs from 'node:fs'
import { input, select, confirm } from '@inquirer/prompts'
import { detectPackageManager, type PackageManager } from '../core/detector'
import { loadTemplate } from '../template/loader'
import { renderTemplate } from '../template/renderer'
import { logger } from '../utils/logger'
import { MahoError } from '../utils/errors'

export async function initCommand(nameArg?: string): Promise<void> {
  // 1. 收集用户输入
  const projectName = nameArg ?? (await input({
    message: 'Project name',
    default: 'my-app',
  }))

  const targetDir = path.resolve(process.cwd(), projectName)
  if (fs.existsSync(targetDir)) {
    throw new MahoError(
      'dir-exists',
      `Directory "${projectName}" already exists in ${process.cwd()}.`,
    )
  }

  const detected = detectPackageManager(process.cwd())
  const packageManager = await select<PackageManager>({
    message: 'Package manager',
    choices: [
      { name: 'pnpm', value: 'pnpm' },
      { name: 'npm', value: 'npm' },
      { name: 'yarn', value: 'yarn' },
    ],
    default: detected,
  })

  const createFirstApp = await confirm({
    message: 'Create first remote app?',
    default: true,
  })

  let firstAppName = 'module-home'
  let routePrefix = '/home'
  if (createFirstApp) {
    firstAppName = await input({
      message: 'Remote app name',
      default: 'module-home',
    })
    routePrefix = await input({
      message: 'Route prefix',
      default: `/${firstAppName}`,
    })
  }

  // 2. 渲染 host 模板
  logger.step('Creating project...')
  const hostTemplate = loadTemplate('host-vue')
  await renderTemplate(hostTemplate, targetDir, {
    projectName,
    packageManager,
  })

  // 3. 确保 apps/ 目录存在
  const appsDir = path.join(targetDir, 'apps')
  if (!createFirstApp) {
    await fs.promises.mkdir(appsDir, { recursive: true })
    // 在空 apps/ 下放一个 .gitkeep 确保目录被 git 跟踪
    await fs.promises.writeFile(path.join(appsDir, '.gitkeep'), '', 'utf-8')
  }

  // 4. 可选：创建首个子包
  if (createFirstApp) {
    logger.step('Creating first remote app...')
    const remoteTemplate = loadTemplate('remote-vue')
    await renderTemplate(remoteTemplate, path.join(appsDir, firstAppName), {
      appName: firstAppName,
      routePrefix,
    })
  }

  // 5. 输出下一步提示
  process.stdout.write('\n')
  logger.success(`${projectName} created!\n`)
  logger.info('Next steps:')
  logger.info(`  cd ${projectName}`)
  logger.info(`  ${packageManager} install`)
  const mahoCmd = packageManager === 'npm' ? 'npx maho' : 'maho'
  logger.info(`  ${mahoCmd} dev`)
}
