/**
 * 子包元数据（mf-meta.ts 默认导出）。
 * 用于版本协商、devtools 展示、类型漂移检测。
 */
export interface MFMeta {
  name: string
  version: string
  typesVersion: string
  minBootVersion?: string
  description?: string
}
