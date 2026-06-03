import path from 'node:path'
import fs from 'node:fs'
import { input } from '@inquirer/prompts'
import { resolveWorkspaceContext } from '../core/workspace'
import { loadTemplate } from '../template/loader'
import { renderTemplate } from '../template/renderer'
import { logger } from '../utils/logger'
import { MahoError } from '../utils/errors'

export async function addCommand(nameArg?: string): Promise<void> {
  const ctx = await resolveWorkspaceContext()

  if (ctx.role !== 'host') {
    throw new MahoError(
      'wrong-directory',
      '"maho add" must be run from the workspace root.',
    )
  }

  // 1. 收集输入
  const appName =
    nameArg ??
    (await input({
      message: 'Remote app name',
      validate: (v: string) => {
        if (!v.trim()) return 'Name cannot be empty.'
        if (ctx.apps.some((a) => a.name === v)) return `"${v}" already exists.`
        return true
      },
    }))

  const routePrefix = await input({
    message: 'Route prefix',
    default: `/${appName}`,
  })

  // 2. 渲染模板
  const targetDir = path.join(ctx.root, 'apps', appName)
  if (fs.existsSync(targetDir)) {
    throw new MahoError(
      'dir-exists',
      `Directory "apps/${appName}" already exists.`,
    )
  }

  logger.step(`Creating remote app "${appName}"...`)
  const template = loadTemplate('remote-vue')
  await renderTemplate(template, targetDir, { appName, routePrefix })

  // 3. 注册到 pnpm-workspace.yaml（若存在）
  await registerToWorkspace(ctx.root, `apps/${appName}`)

  process.stdout.write('\n')
  logger.success(`${appName} created!\n`)
  logger.info('Run "maho dev" to start.')
}

/**
 * 追加 appPath 到 pnpm-workspace.yaml 的 packages 列表。
 * 仅处理 pnpm；npm/yarn workspaces 推迟。
 */
async function registerToWorkspace(
  root: string,
  appPath: string,
): Promise<void> {
  const wsPath = path.join(root, 'pnpm-workspace.yaml')
  if (!fs.existsSync(wsPath)) return

  const content = fs.readFileSync(wsPath, 'utf-8')
  if (content.includes(appPath)) return

  const updated = content.trimEnd() + `\n  - '${appPath}'\n`
  fs.writeFileSync(wsPath, updated, 'utf-8')
  logger.info(`Registered "${appPath}" in pnpm-workspace.yaml.`)
}
