import fs from 'node:fs'
import path from 'node:path'

/**
 * 按优先级加载 .env 文件，合并到一个对象返回。
 *
 * 优先级（高 → 低，高的覆盖低的）：
 *   1. process.env
 *   2. .env.local
 *   3. .env.{mode}.local
 *   4. .env.{mode}
 *   5. .env
 *
 * 仅做极简解析：`KEY=value` 一行一条，`#` 行注释，
 * `"..."` / `'...'` 字符串去引号；不做 ${VAR} 变量插值。
 */
export function loadEnvFiles(
  projectRoot: string,
  mode: string,
): Record<string, string> {
  const files = [
    '.env',
    `.env.${mode}`,
    `.env.${mode}.local`,
    '.env.local',
  ]

  const result: Record<string, string> = {}

  // 文件按低 → 高顺序处理，让高优先级文件覆盖低优先级
  for (const file of files) {
    const full = path.join(projectRoot, file)
    if (!fs.existsSync(full)) continue
    Object.assign(result, parseEnvFile(full))
  }

  // process.env 最高优先级（CI / 用户显式设置）
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') result[key] = value
  }

  return result
}

function parseEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf-8')
  const out: Record<string, string> = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq < 0) continue

    const key = line.slice(0, eq).trim()
    if (!key) continue

    let value = line.slice(eq + 1).trim()
    // 去除尾部行内注释（仅当 value 不在引号内时）
    if (!isQuoted(value)) {
      const hashIdx = value.indexOf(' #')
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim()
    }
    out[key] = unquote(value)
  }

  return out
}

function isQuoted(v: string): boolean {
  return (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
}

function unquote(v: string): string {
  if (isQuoted(v) && v.length >= 2) return v.slice(1, -1)
  return v
}
