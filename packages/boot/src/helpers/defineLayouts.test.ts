import { describe, it, expect } from 'vitest'
import { defineLayouts } from '../helpers/defineLayouts.js'

describe('defineLayouts', () => {
  it('wraps input in { map }', () => {
    const comp = () => null
    const result = defineLayouts({ default: comp })
    expect(result).toEqual({ map: { default: comp } })
  })

  it('handles empty map', () => {
    const result = defineLayouts({})
    expect(result).toEqual({ map: {} })
  })

  it('handles all LayoutValue types', () => {
    const comp = () => null
    const result = defineLayouts({
      default: comp,
      blank: () => Promise.resolve({ default: comp }),
      admin: 'module-admin/layouts/AdminLayout',
    })
    expect(result.map).toHaveProperty('default')
    expect(result.map).toHaveProperty('blank')
    expect(result.map).toHaveProperty('admin')
  })
})
