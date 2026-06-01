import fs from 'node:fs'
import yaml from 'js-yaml'
import { mergeArray } from './merge'

/**
 * 构建支持 Maho 自定义 tag 的 YAML schema。
 *
 * 自定义 tag：
 *   - `!env KEY`        — 必填环境变量，缺失抛错
 *   - `!env? KEY`       — 可选环境变量，缺失返回 null
 *   - `!mergeArray [..]`— 数组以「追加」语义参与 deepMerge
 *
 * 每次调用都生成新的 schema 实例，因为 `!env*` tag 闭包了 envVars。
 */
export function buildSchema(envVars: Record<string, string>): yaml.Schema {
  const envRequired = new yaml.Type('!env', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string' && data.length > 0,
    construct: (key: string) => {
      const value = envVars[key]
      if (value === undefined || value === '') {
        throw new Error(
          `[Maho] Required env variable "${key}" is not set. ` +
            `Check your .env files or set it in the shell.`,
        )
      }
      return value
    },
  })

  const envOptional = new yaml.Type('!env?', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string' && data.length > 0,
    construct: (key: string) => {
      const value = envVars[key]
      return value === undefined || value === '' ? null : value
    },
  })

  const mergeArrayTag = new yaml.Type('!mergeArray', {
    kind: 'sequence',
    resolve: (data) => Array.isArray(data),
    construct: (data: unknown[]) => mergeArray(data),
  })

  return yaml.DEFAULT_SCHEMA.extend([envRequired, envOptional, mergeArrayTag])
}

/**
 * 读取并解析单个 YAML 文件，使用支持自定义 tag 的 schema。
 *
 * 返回 `unknown` 是为了让调用方决定如何收窄类型 —— 一般会断言成
 * `ParsedConfig`，但本函数本身不假设 YAML 顶层一定是对象。
 */
export async function parseYaml(
  filePath: string,
  envVars: Record<string, string>,
): Promise<unknown> {
  const text = fs.readFileSync(filePath, 'utf-8')
  const schema = buildSchema(envVars)
  return yaml.load(text, { schema, filename: filePath })
}
