import path from 'node:path'
import { fileExists } from '../utils/pkg'
import type { ResolvedMahoPluginOptions } from '../types'

/**
 * 解析最终 exposes 映射：
 * - 用户在 options.exposes 中声明的入口（如 './pages/OrderList'）
 *   映射到 './src/pages/OrderList'（支持 .ts/.tsx/.vue 后缀自动识别）
 * - 框架追加 './mf-meta' 和 './mf-routes'（仅当对应源文件存在）
 *
 * 返回值形态：{ './pages/OrderList': './src/pages/OrderList.vue', ... }
 */
export function resolveExposes(
  options: ResolvedMahoPluginOptions,
): Record<string, string> {
  if (options.role !== 'remote') return {}

  const result: Record<string, string> = {}

  for (const exposePath of options.exposes) {
    const relSrc = exposePath.replace(/^\.\//, 'src/')
    const resolved = resolveSourceFile(options.projectRoot, relSrc)
    if (resolved) {
      // 用绝对路径而非项目内相对路径 —— 当 vite 由 CLI 在其他 cwd 下程序化
      // 调起（vite-runner），rollup 用 process.cwd() 解析相对路径会找错。
      result[exposePath] = resolved.replace(/\\/g, '/')
    } else {
      console.warn(
        `[Maho] Expose "${exposePath}" declared but no source file found under "${relSrc}.*"`,
      )
    }
  }

  // 自动追加约定出口（源文件存在才加）
  for (const conventional of ['./mf-meta', './mf-routes']) {
    if (conventional in result) continue
    const relSrc = `src/${conventional.replace('./', '')}`
    const resolved = resolveSourceFile(options.projectRoot, relSrc)
    if (resolved) {
      result[conventional] = resolved.replace(/\\/g, '/')
    }
  }

  return result
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.vue', '.jsx', '.js', '.mts']

function resolveSourceFile(
  projectRoot: string,
  relPath: string,
): string | null {
  const base = path.join(projectRoot, relPath)
  // 已带后缀
  if (path.extname(relPath) && fileExists(base)) return base
  // 尝试常见后缀
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = base + ext
    if (fileExists(candidate)) return candidate
  }
  // 目录 index 文件
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = path.join(base, 'index' + ext)
    if (fileExists(candidate)) return candidate
  }
  return null
}
