import fs from 'node:fs'
import path from 'node:path'
import type { MFConfig, PluginDeclaration } from '../interfaces/MFConfig'

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * 校验合并后的最终配置。仅做结构性 / 语义性的硬性检查，
 * 不做风格性建议（那是 lint 的事）。
 *
 * @param projectRoot 用于解析本地插件路径（`./xxx`）；不传则跳过该校验
 */
export function validateConfig(
  config: Partial<MFConfig>,
  projectRoot?: string,
): ValidationResult {
  const errors: ValidationError[] = []

  if (config.role !== 'host' && config.role !== 'remote') {
    errors.push({
      path: 'role',
      message: `role must be 'host' or 'remote', got ${JSON.stringify(config.role)}`,
    })
  }

  if (config.role === 'remote' && !config.name) {
    errors.push({
      path: 'name',
      message: 'name is required when role is "remote"',
    })
  }

  if (config.boot !== undefined && typeof config.boot !== 'string') {
    errors.push({
      path: 'boot',
      message: `boot must be a package specifier string, got ${JSON.stringify(config.boot)}`,
    })
  }

  if (config.role === 'host' && config.federation?.remotes) {
    config.federation.remotes.forEach((url, i) => {
      if (!isValidUrl(url)) {
        errors.push({
          path: `federation.remotes[${i}]`,
          message: `not a valid URL: ${JSON.stringify(url)}`,
        })
      }
    })
  }

  if (config.plugins && Array.isArray(config.plugins)) {
    config.plugins.forEach((decl, i) => {
      validatePluginDeclaration(decl, i, projectRoot, errors)
    })
  }

  return { valid: errors.length === 0, errors }
}

function validatePluginDeclaration(
  decl: PluginDeclaration,
  index: number,
  projectRoot: string | undefined,
  errors: ValidationError[],
): void {
  if (!decl || typeof decl !== 'object' || typeof decl.use !== 'string') {
    errors.push({
      path: `plugins[${index}]`,
      message: 'plugin declaration must be { use: string, with?: object }',
    })
    return
  }

  if (!projectRoot) return
  if (!decl.use.startsWith('.')) return

  const abs = path.resolve(projectRoot, decl.use)
  // 允许显式扩展名或常见 fallback；不存在才报错
  const candidates = [abs, `${abs}.ts`, `${abs}.js`, `${abs}.mjs`, `${abs}.cjs`]
  if (!candidates.some((p) => fs.existsSync(p))) {
    errors.push({
      path: `plugins[${index}].use`,
      message: `local plugin file not found: ${decl.use}`,
    })
  }
}

function isValidUrl(s: unknown): boolean {
  if (typeof s !== 'string') return false
  try {
    // eslint-disable-next-line no-new
    new URL(s)
    return true
  }
  catch {
    return false
  }
}
