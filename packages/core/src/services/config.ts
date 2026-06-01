import fs from 'node:fs'
import path from 'node:path'
import { Service } from 'cordis'
import type { MFContext } from '../context'
import { deepMerge } from '../utils/merge'
import { loadEnvFiles } from '../utils/env'
import { parseYaml } from '../utils/yaml'
import { validateConfig, type ValidationError } from '../utils/config-validator'
import type {
  ParsedConfig,
  ResolvedMFConfig,
} from '../interfaces/MFConfig'

export interface ConfigServiceOptions {
  projectRoot: string
}

/**
 * 校验失败时抛出的错误，带结构化 errors 字段方便 CLI/Devtools 渲染。
 */
export class MahoConfigError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(formatErrors(errors))
    this.name = 'MahoConfigError'
  }
}

function formatErrors(errors: ValidationError[]): string {
  const lines = errors.map((e) => `  - ${e.path}: ${e.message}`)
  return `[Maho] Invalid config:\n${lines.join('\n')}`
}

/**
 * 配置服务：负责从 `config/config.yml` + `config/config.{mode}.yml`
 * 读取并合并配置，校验后通过 events 广播给其他服务。
 *
 * 三个公共字段：
 *   - `base`     — `config.yml` 原始解析
 *   - `current`  — `config.{mode}.yml` 原始解析（缺省为 {}）
 *   - `resolved` — base + current deepMerge 后的最终配置
 *
 * `local` 第三层（Devtools 回写）按 S3-O2 推迟到 V2。
 */
export class ConfigService extends Service {
  base: ParsedConfig = {}
  current: ParsedConfig = {}
  resolved: ResolvedMFConfig = { role: 'host' } as ResolvedMFConfig

  declare protected ctx: MFContext

  constructor(ctx: MFContext, private options: ConfigServiceOptions) {
    super(ctx, 'config')
  }

  /**
   * 加载并合并配置。由 `createMahoContext` 在启动时调用，
   * 也会由（将来的）WatchService 在文件变更时重新触发。
   */
  async load(mode: string): Promise<void> {
    const { projectRoot } = this.options
    const envVars = loadEnvFiles(projectRoot, mode)

    const basePath = path.join(projectRoot, 'config', 'config.yml')
    if (!fs.existsSync(basePath)) {
      throw new Error(`[Maho] config/config.yml not found at ${basePath}`)
    }
    this.base = (await parseYaml(basePath, envVars)) as ParsedConfig ?? {}

    const modePath = path.join(projectRoot, 'config', `config.${mode}.yml`)
    this.current = fs.existsSync(modePath)
      ? ((await parseYaml(modePath, envVars)) as ParsedConfig) ?? {}
      : {}

    this.recompute()

    const { valid, errors } = validateConfig(this.resolved, projectRoot)
    if (!valid) throw new MahoConfigError(errors)

    this.ctx.emit('config:ready', this.resolved)
  }

  /**
   * 重新执行 load 流程。Step 3 提供同步签名占位，实际由 WatchService（Step 4）触发。
   */
  async reload(mode: string): Promise<void> {
    await this.load(mode)
  }

  private recompute(): void {
    this.resolved = deepMerge(this.base, this.current) as ResolvedMFConfig
    this.ctx.emit('config:resolved', this.resolved)
  }
}
