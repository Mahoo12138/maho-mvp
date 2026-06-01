import type { ResolvedLayoutMap, LayoutValue } from '../interfaces/LayoutConfig'
import { getLoadedRemote } from './registry'

/**
 * 解析单个 layout ID 为最终可渲染组件。
 *
 * 支持三种值：
 * - 组件对象（已加载）→ 直接返回
 * - 懒加载函数 → await 调用，取 default
 * - 联邦路径字符串（'module-x/layouts/Y'）→ 运行时通过 registry 加载
 *
 * 找不到时降级 default 并打印 warn；default 也找不到则抛错。
 */
export async function resolveLayout(
  layoutId: string,
  layoutMap: ResolvedLayoutMap,
): Promise<unknown> {
  const value = layoutMap[layoutId]

  if (value === undefined) {
    if (layoutId !== 'default') {
      console.warn(
        `[Maho] Layout "${layoutId}" not found, falling back to "default"`,
      )
    }
    const fallback = layoutMap['default']
    if (fallback === undefined) {
      throw new Error(`[Maho] No layout registered for id "${layoutId}" and no "default" available`)
    }
    return resolveLayoutValue(fallback)
  }

  return resolveLayoutValue(value)
}

async function resolveLayoutValue(value: LayoutValue): Promise<unknown> {
  if (typeof value === 'string') {
    const [remoteName, ...pathParts] = value.split('/')
    if (!remoteName || pathParts.length === 0) {
      throw new Error(`[Maho] Invalid federated layout path: "${value}"`)
    }
    const remote = getLoadedRemote(remoteName)
    if (!remote) {
      throw new Error(
        `[Maho] Remote "${remoteName}" not loaded; cannot resolve layout "${value}"`,
      )
    }
    const mod: any = await remote.load(`./${pathParts.join('/')}`)
    return mod?.default ?? mod
  }

  if (typeof value === 'function') {
    const mod: any = await (value as () => Promise<any>)()
    return mod?.default ?? mod
  }

  return value
}
