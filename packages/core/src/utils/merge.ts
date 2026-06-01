/**
 * 标记一个数组在 deepMerge 时使用「追加」语义，而非默认的「替换」。
 *
 * 用 `Symbol.for` 而非局部 Symbol，是为了让跨模块/跨 bundle 的同名数组
 * 也能被识别（如插件在自己的包里包装数组后传入 core）。
 */
const MERGE_ARRAY = Symbol.for('maho:mergeArray')

/**
 * 将数组标记为「追加」语义。配合 deepMerge 使用。
 *
 * YAML 侧通过 `!mergeArray` 自定义 tag 调用本函数。
 */
export function mergeArray<T>(items: T[]): T[] {
  Object.defineProperty(items, MERGE_ARRAY, {
    value: true,
    enumerable: false,
    configurable: true,
  })
  return items
}

/**
 * 配置专用 deepMerge：
 * - `override === undefined` 保留 base
 * - `override === null` 显式清除（返回 null）
 * - 数组默认替换；带 mergeArray 标记时追加
 * - 普通对象递归合并
 * - 其余情况 override 覆盖
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (override === null) return null

  if (Array.isArray(override)) {
    if ((override as unknown as { [k: symbol]: unknown })[MERGE_ARRAY] && Array.isArray(base)) {
      return [...base, ...override]
    }
    return override
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base }
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key])
    }
    return out
  }

  return override
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
