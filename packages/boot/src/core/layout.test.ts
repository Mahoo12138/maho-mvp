import { describe, it, expect, vi } from 'vitest'

vi.mock('./registry.js', () => ({
  getLoadedRemote: vi.fn(),
  registerRemote: vi.fn(),
  listLoadedRemotes: vi.fn(),
  _resetRemoteRegistry: vi.fn(),
}))

vi.mock('../interfaces/LayoutConfig.js', () => ({}))

import { getLoadedRemote } from './registry.js'
import { resolveLayout } from './layout.js'
import type { ResolvedLayoutMap } from '../interfaces/LayoutConfig.js'

function makeLoadedRemote(name: string, loadResult: unknown = {}) {
  return {
    name,
    load: vi.fn().mockResolvedValue(loadResult),
  }
}

describe('resolveLayout', () => {
  it('returns direct component value', async () => {
    const component = { template: '<div>layout</div>' }
    const map: ResolvedLayoutMap = { myLayout: component }
    const result = await resolveLayout('myLayout', map)
    expect(result).toBe(component)
  })

  it('resolves function layouts', async () => {
    const component = { template: '<div>async layout</div>' }
    const map: ResolvedLayoutMap = {
      asyncLayout: () => Promise.resolve({ default: component }),
    }
    const result = await resolveLayout('asyncLayout', map)
    expect(result).toBe(component)
  })

  it('resolves function layouts returning module without default', async () => {
    const component = { template: '<div>no default</div>' }
    const map: ResolvedLayoutMap = {
      noDefault: () => Promise.resolve(component),
    }
    const result = await resolveLayout('noDefault', map)
    expect(result).toBe(component)
  })

  it('resolves string federated layout', async () => {
    const component = { template: '<div>remote layout</div>' }
    const remote = makeLoadedRemote('module-x', { default: component })
    vi.mocked(getLoadedRemote).mockReturnValue(remote)
    const map: ResolvedLayoutMap = { fedLayout: 'module-x/layouts/Admin' }
    const result = await resolveLayout('fedLayout', map)
    expect(result).toBe(component)
    expect(remote.load).toHaveBeenCalledWith('./layouts/Admin')
  })

  it('falls back to default when layoutId not found', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const defaultComponent = { template: '<div>default</div>' }
    const map: ResolvedLayoutMap = { default: defaultComponent }
    const result = await resolveLayout('missing', map)
    expect(result).toBe(defaultComponent)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
    warn.mockRestore()
  })

  it('throws when neither layoutId nor default exists', async () => {
    const map: ResolvedLayoutMap = {}
    await expect(resolveLayout('missing', map)).rejects.toThrow('No layout registered')
  })

  it('throws when default is also missing (explicit default lookup)', async () => {
    const map: ResolvedLayoutMap = {}
    await expect(resolveLayout('default', map)).rejects.toThrow('No layout registered')
  })

  it('throws for invalid federated layout path', async () => {
    const map: ResolvedLayoutMap = { bad: 'just-a-name' }
    await expect(resolveLayout('bad', map)).rejects.toThrow('Invalid federated layout path')
  })

  it('throws when remote not loaded for string layout', async () => {
    vi.mocked(getLoadedRemote).mockReturnValue(undefined)
    const map: ResolvedLayoutMap = { fed: 'unknown-remote/layouts/X' }
    await expect(resolveLayout('fed', map)).rejects.toThrow('not loaded')
  })
})
