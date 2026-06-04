import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerRemote,
  getLoadedRemote,
  listLoadedRemotes,
  _resetRemoteRegistry,
} from './registry.js'
import type { RemoteModule } from '../interfaces/RemoteModule.js'

function makeRemote(name: string): RemoteModule {
  return {
    name,
    load: async (_expose: string) => ({}),
    container: {} as unknown as RemoteModule['container'],
  }
}

describe('registry', () => {
  beforeEach(() => {
    _resetRemoteRegistry()
  })

  it('registers and retrieves a single remote', () => {
    const r = makeRemote('module-a')
    registerRemote(r)
    expect(getLoadedRemote('module-a')).toBe(r)
  })

  it('registers multiple remotes and lists them', () => {
    const a = makeRemote('a')
    const b = makeRemote('b')
    registerRemote(a)
    registerRemote(b)
    expect(listLoadedRemotes()).toEqual([a, b])
  })

  it('later registration overwrites same name', () => {
    const first = makeRemote('x')
    const second = makeRemote('x')
    registerRemote(first)
    registerRemote(second)
    expect(getLoadedRemote('x')).toBe(second)
  })

  it('returns undefined for missing name', () => {
    expect(getLoadedRemote('nonexistent')).toBeUndefined()
  })

  it('lists empty array when no remotes registered', () => {
    expect(listLoadedRemotes()).toEqual([])
  })

  it('reset clears all remotes', () => {
    registerRemote(makeRemote('a'))
    registerRemote(makeRemote('b'))
    _resetRemoteRegistry()
    expect(getLoadedRemote('a')).toBeUndefined()
    expect(getLoadedRemote('b')).toBeUndefined()
    expect(listLoadedRemotes()).toEqual([])
  })

  it('can re-register after reset', () => {
    registerRemote(makeRemote('old'))
    _resetRemoteRegistry()
    const r = makeRemote('new')
    registerRemote(r)
    expect(getLoadedRemote('new')).toBe(r)
    expect(listLoadedRemotes()).toHaveLength(1)
  })
})
