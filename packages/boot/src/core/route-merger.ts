import type {
  MahoRoute,
  ModuleRoute,
  ModuleRoutesConfig,
} from '../interfaces/MahoRoute'

interface FlatRoute {
  fullPath: string
  parentPath: string | null
  route: ModuleRoute
  priority: number
  moduleName: string
  loadOrder: number
}

/**
 * 路由合并算法：展平 → 竞争解析 → 重组树。
 *
 * - 不同 path：各自独立注册
 * - 相同 path 不同 priority：高优先级整棵子树胜出
 * - 相同 path 相同 priority：warn + 按加载顺序取最后一个
 * - 父被淘汰但子在另一模块未冲突：子作为孤儿挂载到胜出的父节点下
 */
export class RouteMerger {
  merge(configs: ModuleRoutesConfig[]): MahoRoute[] {
    const allFlat: FlatRoute[] = configs.flatMap((config, index) =>
      flatten(config, index),
    )
    const { winners, eliminatedRoots } = resolveConflicts(allFlat)
    return buildTree(allFlat, winners, eliminatedRoots)
  }
}

function flatten(config: ModuleRoutesConfig, loadOrder: number): FlatRoute[] {
  const prefix = normalizePrefix(config.prefix ?? `/${config.name}`)
  const result: FlatRoute[] = []

  function walk(routes: ModuleRoute[], parentFullPath: string | null): void {
    for (const route of routes) {
      const segment = route.path.startsWith('/') ? route.path : `/${route.path}`
      const fullPath =
        parentFullPath === null
          ? joinPath(prefix, segment)
          : joinPath(parentFullPath, segment)

      result.push({
        fullPath,
        parentPath: parentFullPath,
        route,
        priority: route.priority ?? 0,
        moduleName: config.name,
        loadOrder,
      })

      if (route.children?.length) {
        walk(route.children, fullPath)
      }
    }
  }

  walk(config.routes, null)
  return result
}

function normalizePrefix(prefix: string): string {
  if (!prefix) return ''
  const p = prefix.startsWith('/') ? prefix : `/${prefix}`
  return p.replace(/\/+$/, '')
}

function joinPath(a: string, b: string): string {
  return `${a}${b}`.replace(/\/{2,}/g, '/')
}

interface ConflictResolution {
  winners: Map<string, FlatRoute>
  eliminatedRoots: Set<string>
}

function resolveConflicts(allFlat: FlatRoute[]): ConflictResolution {
  const byPath = new Map<string, FlatRoute[]>()
  for (const flat of allFlat) {
    const arr = byPath.get(flat.fullPath)
    if (arr) arr.push(flat)
    else byPath.set(flat.fullPath, [flat])
  }

  const winners = new Map<string, FlatRoute>()
  const eliminated = new Set<string>()

  for (const [path, group] of byPath) {
    if (group.length === 1) {
      winners.set(path, group[0]!)
      continue
    }

    group.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return b.loadOrder - a.loadOrder
    })

    const winner = group[0]!
    const losers = group.slice(1)

    const samePriority = losers.filter((l) => l.priority === winner.priority)
    if (samePriority.length > 0) {
      const conflicting = [winner, ...samePriority]
      console.warn(
        `[Maho Router] Route conflict at "${path}" — same priority ${winner.priority}. ` +
          `Modules: [${conflicting.map((f) => f.moduleName).join(', ')}]. ` +
          `"${winner.moduleName}" wins by load order.`,
      )
    }

    winners.set(path, winner)
    for (const loser of losers) {
      eliminated.add(`${loser.moduleName}::${path}`)
    }
  }

  return { winners, eliminatedRoots: eliminated }
}

function buildTree(
  allFlat: FlatRoute[],
  winners: Map<string, FlatRoute>,
  eliminatedRoots: Set<string>,
): MahoRoute[] {
  const isInEliminatedSubtree = (flat: FlatRoute): boolean => {
    if (eliminatedRoots.has(`${flat.moduleName}::${flat.fullPath}`)) return true
    const parts = flat.fullPath.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const ancestor = '/' + parts.slice(0, i).join('/')
      if (eliminatedRoots.has(`${flat.moduleName}::${ancestor}`)) return true
    }
    return false
  }

  const surviving = allFlat.filter((flat) => {
    if (isInEliminatedSubtree(flat)) return false
    const winner = winners.get(flat.fullPath)
    return winner === flat
  })

  // path → 新构造的 MahoRoute 节点。每个胜出 path 至多一个节点。
  const nodes = new Map<string, MahoRoute>()
  const roots: MahoRoute[] = []

  for (const flat of surviving) {
    nodes.set(flat.fullPath, toMahoRoute(flat))
  }

  for (const flat of surviving) {
    const node = nodes.get(flat.fullPath)!
    if (flat.parentPath === null) {
      roots.push(node)
      continue
    }
    const parent = nodes.get(flat.parentPath)
    if (parent) {
      parent.children ??= []
      parent.children.push(node)
    } else {
      // 父节点的 winner 不存在（极少见，例如声明了子但父在所有模块都被淘汰）
      // 作为孤儿提升为根节点，保证路由不丢失。
      roots.push(node)
    }
  }

  return roots
}

function toMahoRoute(flat: FlatRoute): MahoRoute {
  return {
    path: flat.fullPath,
    name: namespaceRouteName(flat.moduleName, flat.route.name),
    priority: flat.route.priority,
    component: flat.route.component,
    meta: flat.route.meta,
    children: undefined,
  }
}

export function namespaceRouteName(moduleName: string, name: string): string {
  return `${moduleName}__${name}`
}
