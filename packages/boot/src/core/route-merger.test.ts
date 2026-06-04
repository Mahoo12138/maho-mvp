import { describe, it, expect } from 'vitest'
import { RouteMerger, namespaceRouteName } from './route-merger.js'
import type { ModuleRoutesConfig } from '../interfaces/MahoRoute.js'

function makeConfig(
  name: string,
  prefix?: string,
  routes: ModuleRoutesConfig['routes'] = [],
): ModuleRoutesConfig {
  return { name, prefix, routes }
}

describe('namespaceRouteName', () => {
  it('combines module and route name with __', () => {
    expect(namespaceRouteName('module-a', 'home')).toBe('module-a__home')
  })

  it('handles empty strings', () => {
    expect(namespaceRouteName('', '')).toBe('__')
  })

  it('handles names with underscores', () => {
    expect(namespaceRouteName('my_module', 'my_route')).toBe('my_module__my_route')
  })
})

describe('RouteMerger.merge', () => {
  const merger = new RouteMerger()

  it('single module with simple routes', () => {
    const routes = makeConfig('app1', '/app1', [
      { path: 'home', name: 'home', component: () => null },
    ])
    const result = merger.merge([routes])
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('/app1/home')
    expect(result[0]!.name).toBe('app1__home')
  })

  it('returns empty array for no configs', () => {
    expect(merger.merge([])).toEqual([])
  })

  it('returns empty array for configs with empty routes', () => {
    expect(merger.merge([makeConfig('app1', '/app1', [])])).toEqual([])
  })

  it('nested child routes preserve tree structure', () => {
    const routes = makeConfig('app1', '/app1', [
      {
        path: 'parent',
        name: 'parent',
        component: () => null,
        children: [
          {
            path: 'child',
            name: 'child',
            component: () => null,
          },
        ],
      },
    ])
    const result = merger.merge([routes])
    expect(result).toHaveLength(1)
    expect(result[0]!.children).toHaveLength(1)
    expect(result[0]!.children![0]!.path).toBe('/app1/parent/child')
  })

  it('multiple modules with non-conflicting paths', () => {
    const configs = [
      makeConfig('app1', '/app1', [
        { path: 'home', name: 'home', component: () => null },
      ]),
      makeConfig('app2', '/app2', [
        { path: 'dashboard', name: 'dashboard', component: () => null },
      ]),
    ]
    const result = merger.merge(configs)
    expect(result).toHaveLength(2)
  })

  it('higher priority route wins on conflict', () => {
    const configs = [
      makeConfig('app1', '/app1', [
        { path: 'shared', name: 'shared', component: () => null, priority: 1 },
      ]),
      makeConfig('app2', '/app1', [
        { path: 'shared', name: 'shared', component: () => null, priority: 10 },
      ]),
    ]
    const result = merger.merge(configs)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('app2__shared')
  })

  it('same priority, last loaded wins', () => {
    const configs = [
      makeConfig('app1', '/app1', [
        { path: 'shared', name: 'shared', component: () => null },
      ]),
      makeConfig('app2', '/app1', [
        { path: 'shared', name: 'shared', component: () => null },
      ]),
    ]
    const result = merger.merge(configs)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('app2__shared')
  })

  it('uses default prefix when prefix is not provided', () => {
    const routes = makeConfig('module-x', undefined, [
      { path: 'home', name: 'home', component: () => null },
    ])
    const result = merger.merge([routes])
    expect(result[0]!.path).toBe('/module-x/home')
  })

  it('uses explicit prefix over default', () => {
    const routes = makeConfig('module-x', '/custom', [
      { path: 'home', name: 'home', component: () => null },
    ])
    const result = merger.merge([routes])
    expect(result[0]!.path).toBe('/custom/home')
  })

  it('trims trailing slash from prefix', () => {
    const routes = makeConfig('app1', '/prefix/', [
      { path: 'home', name: 'home', component: () => null },
    ])
    const result = merger.merge([routes])
    expect(result[0]!.path).toBe('/prefix/home')
  })

  it('handles paths starting with / correctly', () => {
    const routes = makeConfig('app1', '/app1', [
      { path: '/home', name: 'home', component: () => null },
    ])
    const result = merger.merge([routes])
    expect(result[0]!.path).toBe('/app1/home')
  })

  it('three modules conflict, highest priority wins', () => {
    const configs = [
      makeConfig('low', '/', [{ path: 'page', name: 'page', component: () => null, priority: 1 }]),
      makeConfig('mid', '/', [{ path: 'page', name: 'page', component: () => null, priority: 5 }]),
      makeConfig('high', '/', [{ path: 'page', name: 'page', component: () => null, priority: 10 }]),
    ]
    const result = merger.merge(configs)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('high__page')
  })

  it('warns on same-priority conflict', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const configs = [
      makeConfig('a', '/', [{ path: 'page', name: 'page', component: () => null }]),
      makeConfig('b', '/', [{ path: 'page', name: 'page', component: () => null }]),
    ]
    merger.merge(configs)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[Maho Router] Route conflict'),
    )
    warn.mockRestore()
  })

  it('loser children are eliminated with parent when ancestor is eliminated', () => {
    // winner has priority 10 at all levels, loser has 1.
    // Winner takes both /parent and /parent/child.
    // Loser's child at /parent/child is eliminated because loser::/parent
    // is in eliminatedRoots, and ancestor check catches it.
    const configs = [
      makeConfig('winner', '/', [
        {
          path: 'parent',
          name: 'winner-parent',
          component: () => null,
          priority: 10,
          children: [
            { path: 'child', name: 'winner-child', component: () => null, priority: 10 },
          ],
        },
      ]),
      makeConfig('loser', '/', [
        {
          path: 'parent',
          name: 'loser-parent',
          component: () => null,
          priority: 1,
          children: [
            { path: 'child', name: 'loser-child', component: () => null, priority: 1 },
          ],
        },
      ]),
    ]
    const result = merger.merge(configs)

    // Only winner's routes survive
    const parent = result.find((r) => r.name === 'winner__winner-parent')
    expect(parent).toBeDefined()
    expect(parent!.children).toHaveLength(1)
    expect(parent!.children![0]!.name).toBe('winner__winner-child')

    // Loser's child should not appear anywhere
    const loserChild = result.find((r) => r.name === 'loser__loser-child')
    expect(loserChild).toBeUndefined()
  })
})
