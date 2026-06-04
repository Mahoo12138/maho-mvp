import { describe, it, expect } from 'vitest'
import { routeName } from '../helpers/routeName.js'

describe('routeName', () => {
  it('combines module and route name', () => {
    expect(routeName('module-order', 'order-detail')).toBe('module-order__order-detail')
  })

  it('handles names with underscores', () => {
    expect(routeName('my_module', 'my_route')).toBe('my_module__my_route')
  })

  it('handles empty strings', () => {
    expect(routeName('', '')).toBe('__')
  })
})
