import type { ModuleRegistry } from '../interfaces/ModuleRegistry'
import { getLoadedRemote } from '../core/registry'

/**
 * 跨模块加载导出。
 *
 * key 形如 `'module-order/utils/formatters'`：
 *   - 第一段是模块名（remote name）
 *   - 其余是 expose 路径（不含 './'）
 *
 * 类型推导：
 *   - 若 key 命中 ModuleRegistry（声明合并扩展）→ 返回精确类型
 *   - 未命中 → 退化为 any
 */
export async function load<K extends string>(
  key: K,
): Promise<K extends keyof ModuleRegistry ? ModuleRegistry[K] : any> {
  const [remoteName, ...rest] = key.split('/')
  if (!remoteName || rest.length === 0) {
    throw new Error(
      `[Maho] mf.load: invalid key "${key}" — expected "<remote>/<expose-path>"`,
    )
  }
  const remote = getLoadedRemote(remoteName)
  if (!remote) {
    throw new Error(
      `[Maho] mf.load: remote "${remoteName}" is not loaded (key="${key}")`,
    )
  }
  const mod = await remote.load(`./${rest.join('/')}`)
  return mod as any
}
