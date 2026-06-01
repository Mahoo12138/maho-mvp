import fs from 'node:fs'
import path from 'node:path'

export interface PackageJsonShape {
  name?: string
  version?: string
  maho?: {
    name?: string
    exposes?: string[]
  }
  [key: string]: unknown
}

/**
 * 读取 package.json，不存在时返回空对象（而非抛错）。
 */
export function readPackageJsonSafe(dir: string): PackageJsonShape {
  const file = path.join(dir, 'package.json')
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(raw) as PackageJsonShape
  } catch {
    return {}
  }
}

/**
 * 检查文件是否存在（同步）。
 */
export function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function writeFileIfChanged(file: string, content: string): boolean {
  try {
    const existing = fs.readFileSync(file, 'utf-8')
    if (existing === content) return false
  } catch {
    /* file may not exist yet */
  }
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, content, 'utf-8')
  return true
}
