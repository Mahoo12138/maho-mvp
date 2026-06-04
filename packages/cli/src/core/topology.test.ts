import { describe, it, expect, vi } from 'vitest'
import { buildBuildPlan } from './topology.js'
import type { WorkspaceContext } from './workspace.js'
import type { AppInfo } from './workspace.js'

function makeApp(name: string, dir = `/workspace/apps/${name}`): AppInfo {
  return { name, dir, hasViteConfig: true }
}

function makeCtx(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    role: 'host',
    apps: [
      makeApp('module-a'),
      makeApp('module-b'),
      makeApp('module-c'),
    ],
    hostConfig: { role: 'host' } as WorkspaceContext['hostConfig'],
    mahoCtx: {} as WorkspaceContext['mahoCtx'],
    ...overrides,
  }
}

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn() },
}))

import { logger } from '../utils/logger.js'

describe('buildBuildPlan', () => {
  it('filter=null, role=host → build only host', () => {
    const plan = buildBuildPlan(makeCtx({ role: 'host' }), null)
    expect(plan.remotes).toEqual([])
    expect(plan.host).toBe(true)
  })

  it('filter=null, role=remote → build current remote', () => {
    const plan = buildBuildPlan(
      makeCtx({ role: 'remote', currentAppName: 'module-a', cwd: '/workspace/apps/module-a' }),
      null,
    )
    expect(plan.remotes).toHaveLength(1)
    expect(plan.remotes[0]!.name).toBe('module-a')
    expect(plan.host).toBe(false)
  })

  it('filter=null, role=unknown → throws', () => {
    expect(() =>
      buildBuildPlan(makeCtx({ role: 'unknown' }), null),
    ).toThrow(/Run "maho build"/)
  })

  it('filter=all → builds all remotes + host', () => {
    const plan = buildBuildPlan(makeCtx(), 'all')
    expect(plan.remotes).toHaveLength(3)
    expect(plan.host).toBe(true)
  })

  it('filter by name → builds matching remotes only', () => {
    const plan = buildBuildPlan(makeCtx(), ['module-a', 'module-b'])
    expect(plan.remotes.map((r) => r.name)).toEqual(['module-a', 'module-b'])
    expect(plan.host).toBe(false)
  })

  it('filter with partial match → builds found, warns missing', () => {
    const plan = buildBuildPlan(makeCtx(), ['module-a', 'nonexist'])
    expect(plan.remotes.map((r) => r.name)).toEqual(['module-a'])
    expect(plan.host).toBe(false)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('nonexist'),
    )
  })

  it('filter with all missing → builds nothing, warns', () => {
    const plan = buildBuildPlan(makeCtx(), ['nonexist'])
    expect(plan.remotes).toEqual([])
    expect(plan.host).toBe(false)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('nonexist'),
    )
  })

  it('empty filter array → builds nothing', () => {
    const plan = buildBuildPlan(makeCtx(), [])
    expect(plan.remotes).toEqual([])
    expect(plan.host).toBe(false)
  })

  it('filter=null, role=remote without currentAppName → throws', () => {
    expect(() =>
      buildBuildPlan(
        makeCtx({ role: 'remote', currentAppName: undefined }),
        null,
      ),
    ).toThrow(/Run "maho build"/)
  })
})
