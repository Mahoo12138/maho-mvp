import { describe, it, expect } from 'vitest'
import { defineModuleRoutes } from '../helpers/defineModuleRoutes.js'

describe('defineModuleRoutes', () => {
  it('returns input unchanged', () => {
    const input = { name: 'test', routes: [] }
    expect(defineModuleRoutes(input)).toBe(input)
  })

  it('works with routes containing components', () => {
    const comp = () => null
    const input = {
      name: 'module',
      routes: [{ path: '/', name: 'home', component: comp }],
    }
    expect(defineModuleRoutes(input)).toEqual(input)
  })
})
