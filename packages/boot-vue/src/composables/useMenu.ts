import { computed, type ComputedRef } from 'vue'
import { useRouter, type RouteRecordNormalized } from 'vue-router'

export interface MenuItem {
  title: string
  path: string
  name: string
  icon?: string
  order: number
  group?: string
  children: MenuItem[]
}

/**
 * 响应式菜单数据，从 router.getRoutes() 计算。
 *
 * V1 简化版：路由表在启动时一次性构造，之后不变，
 * 所以 computed 包一层 router.getRoutes() 已经够用。
 */
export function useMenu(): ComputedRef<MenuItem[]> {
  const router = useRouter()
  return computed(() => buildMenu(router.getRoutes()))
}

interface MenuMeta {
  group?: string
  order?: number
  icon?: string
}

function buildMenu(routes: RouteRecordNormalized[]): MenuItem[] {
  const items: MenuItem[] = []

  for (const r of routes) {
    const menu = r.meta?.menu as MenuMeta | false | undefined
    if (menu === false || menu == null) continue

    const path = r.path
    const name = (r.name as string | undefined) ?? path

    items.push({
      title: (r.meta?.title as string | undefined) ?? name,
      path,
      name,
      icon: menu.icon,
      order: menu.order ?? 0,
      group: menu.group,
      children: [],
    })
  }

  // 按 group 分组，组内按 order 升序，分组之间按首次出现顺序
  const groupOrder: string[] = []
  const grouped = new Map<string, MenuItem[]>()
  const ungrouped: MenuItem[] = []

  for (const item of items) {
    if (item.group) {
      if (!grouped.has(item.group)) {
        groupOrder.push(item.group)
        grouped.set(item.group, [])
      }
      grouped.get(item.group)!.push(item)
    } else {
      ungrouped.push(item)
    }
  }

  for (const arr of grouped.values()) arr.sort((a, b) => a.order - b.order)
  ungrouped.sort((a, b) => a.order - b.order)

  const result: MenuItem[] = []
  for (const g of groupOrder) {
    const children = grouped.get(g)!
    result.push({
      title: g,
      path: '',
      name: `__group__${g}`,
      order: children[0]?.order ?? 0,
      group: g,
      children,
    })
  }
  result.push(...ungrouped)
  return result
}
