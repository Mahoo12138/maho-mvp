import ejs from 'ejs'
import fs from 'node:fs'
import path from 'node:path'
import type { MahoTemplate } from './loader'

/**
 * 将模板渲染到目标目录。
 * - 目录递归遍历
 * - `.ejs` 文件经 EJS 渲染后写入（去掉 .ejs 后缀）
 * - 其他文件原样复制
 */
export async function renderTemplate(
  template: MahoTemplate,
  targetDir: string,
  variables: Record<string, unknown>,
): Promise<void> {
  await renderDir(template.templateDir, targetDir, variables)
}

async function renderDir(
  srcDir: string,
  destDir: string,
  vars: Record<string, unknown>,
): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true })

  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destName = entry.name.replace(/\.ejs$/, '')
    const destPath = path.join(destDir, destName)

    if (entry.isDirectory()) {
      await renderDir(srcPath, destPath, vars)
    } else if (entry.name.endsWith('.ejs')) {
      const content = await fs.promises.readFile(srcPath, 'utf-8')
      const rendered = ejs.render(content, vars)
      await fs.promises.writeFile(destPath, rendered, 'utf-8')
    } else {
      await fs.promises.copyFile(srcPath, destPath)
    }
  }
}
