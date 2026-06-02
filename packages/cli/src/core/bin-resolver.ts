import fs from 'node:fs'
import path from 'node:path'
import { MahoError } from '../utils/errors'

/**
 * 沿 cwd 向上查找 `node_modules/.bin/<name>` 可执行文件，
 * 全平台兼容（Windows 优先 .CMD，POSIX 用裸文件）。
 *
 * 不依赖 pnpm/npm/yarn 的特定行为 —— 三种包管理器
 * 都会在 node_modules/.bin 下生成对应 shim。
 */
export function resolveBin(cwd: string, name: string): string {
  const candidates = process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.CMD`, name]
    : [name]

  let dir = path.resolve(cwd)
  while (true) {
    const binDir = path.join(dir, 'node_modules', '.bin')
    for (const candidate of candidates) {
      const full = path.join(binDir, candidate)
      if (fs.existsSync(full)) return full
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new MahoError(
    'bin-not-found',
    `Could not find "${name}" in any node_modules/.bin from "${cwd}" upwards. Run "pnpm install" (or your package manager equivalent).`,
  )
}
