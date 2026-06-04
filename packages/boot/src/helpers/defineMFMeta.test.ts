import { describe, it, expect } from 'vitest'
import { defineMFMeta } from '../helpers/defineMFMeta.js'

describe('defineMFMeta', () => {
  it('returns input unchanged', () => {
    const input = { name: 'test', version: '1.0.0' }
    expect(defineMFMeta(input)).toBe(input)
  })
})
