import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { writeFileIfChanged } from '../utils/pkg'
import type { ResolvedMahoPluginOptions } from '../types'

/**
 * 类型注册表生成插件。
 *
 * 在 Vite 构建开始时（buildStart 钩子）扫描 node_modules，
 * 找出所有 package.json 含 `maho` 字段的包，
 * 写入 `<projectRoot>/.maho/registry.d.ts` 和 `.maho/virtual.d.ts`。
 *
 * 设计澄清（详见 docs/design-optimizations.md）：
 * 原设计文档把这件事放在 @maho/core 的 TypeService。
 * Step 2 阶段 core 不存在，我们在 vite-plugin 内置一份极简扫描；
 * Step 3 可由 ctx.types 接管，本插件让位。
 */
export function mahoTypeRegistryPlugin(
  options: ResolvedMahoPluginOptions,
): Plugin {
  let emitted = false

  return {
    name: 'maho:type-registry',
    buildStart() {
      if (!options.emitTypes) return
      if (emitted) return
      emitted = true
      try {
        emitRegistry(options)
        emitVirtualConfigDts(options)
      } catch (err) {
        console.warn('[Maho Types] Failed to emit type files:', err)
      }
    },
  }
}

function emitVirtualConfigDts(options: ResolvedMahoPluginOptions): void {
  const file = path.join(options.projectRoot, '.maho', 'virtual.d.ts')
  const content = [
    '// 自动生成，请勿手动编辑（@maho/vite-plugin）',
    '',
    "declare module 'virtual:maho-config' {",
    "  import type { MahoStaticConfig } from '@maho/boot'",
    '  const config: MahoStaticConfig',
    '  export default config',
    '}',
    '',
  ].join('\n')
  writeFileIfChanged(file, content)
}

interface ScannedMahoPackage {
  /** npm 包名，如 '@org/module-order' */
  npmName: string
  /** maho 模块名，如 'module-order' */
  mahoName: string
  /** exposes 路径列表（含 './' 前缀） */
  exposes: string[]
}

function emitRegistry(options: ResolvedMahoPluginOptions): void {
  const packages = scanMahoPackages(options.projectRoot)
  const entries: Array<{ key: string; importPath: string }> = []

  for (const pkg of packages) {
    for (const exposePath of pkg.exposes) {
      // './utils/formatters' → 'module-order/utils/formatters'
      const key = `${pkg.mahoName}${stripDotPrefix(exposePath)}`
      // npm 子路径：'@org/module-order/utils/formatters'
      const importPath = `${pkg.npmName}${stripDotPrefix(exposePath)}`
      entries.push({ key, importPath })
    }
  }

  const lines = entries.map(
    ({ key, importPath }) =>
      `    '${key}': typeof import('${importPath}')`,
  )

  const content = [
    '// 自动生成，请勿手动编辑（@maho/vite-plugin）',
    '// 由扫描 node_modules 中带 maho 字段的 package.json 生成',
    '',
    "import '@maho/boot'",
    '',
    "declare module '@maho/boot' {",
    '  interface ModuleRegistry {',
    ...lines,
    '  }',
    '}',
    '',
  ].join('\n')

  const file = path.join(options.projectRoot, '.maho', 'registry.d.ts')
  writeFileIfChanged(file, content)
}

function stripDotPrefix(p: string): string {
  return p.startsWith('./') ? p.slice(1) : p
}

/**
 * 扫描 node_modules 中所有带 `maho` 字段的包。
 *
 * 不递归内层 node_modules，只看两级：
 *   - node_modules/<pkg>/package.json
 *   - node_modules/@<scope>/<pkg>/package.json
 *
 * pnpm 的 .pnpm 目录也跳过 —— 我们只关心顶层可解析的包。
 */
function scanMahoPackages(projectRoot: string): ScannedMahoPackage[] {
  const nm = path.join(projectRoot, 'node_modules')
  if (!fs.existsSync(nm)) return []

  const result: ScannedMahoPackage[] = []
  const entries = safeReaddir(nm)

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const sub = path.join(nm, entry)
    if (!fs.statSync(sub).isDirectory()) continue

    if (entry.startsWith('@')) {
      // scope 目录
      for (const sub2 of safeReaddir(sub)) {
        tryReadMahoPkg(path.join(sub, sub2), `${entry}/${sub2}`, result)
      }
    } else {
      tryReadMahoPkg(sub, entry, result)
    }
  }
  return result
}

function tryReadMahoPkg(
  dir: string,
  npmName: string,
  out: ScannedMahoPackage[],
): void {
  const pkgFile = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgFile)) return
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))
    const maho = pkg?.maho
    if (!maho?.name || !Array.isArray(maho.exposes)) return
    out.push({
      npmName,
      mahoName: maho.name,
      exposes: maho.exposes.filter((e: unknown): e is string => typeof e === 'string'),
    })
  } catch {
    /* skip malformed package.json */
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
