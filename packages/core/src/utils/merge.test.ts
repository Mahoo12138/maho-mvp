import { describe, it, expect } from 'vitest'
import { deepMerge, mergeArray } from './merge.js'

describe('mergeArray', () => {
  it('returns the same array reference', () => {
    const arr = [1, 2, 3]
    expect(mergeArray(arr)).toBe(arr)
  })

  it('sets the mergeArray symbol on the array', () => {
    const arr = mergeArray(['a'])
    expect((arr as Record<symbol, unknown>)[Symbol.for('maho:mergeArray')]).toBe(true)
  })

  it('the symbol is non-enumerable', () => {
    const arr = mergeArray(['a'])
    expect(Object.keys(arr)).toEqual(['0'])
  })

  it('works on empty arrays', () => {
    const arr = mergeArray([])
    expect(arr).toEqual([])
    expect((arr as Record<symbol, unknown>)[Symbol.for('maho:mergeArray')]).toBe(true)
  })
})

describe('deepMerge', () => {
  it('override undefined keeps base', () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 })
  })

  it('override null explicitly clears', () => {
    expect(deepMerge({ a: 1 }, null)).toBeNull()
  })

  it('override value wins for different types', () => {
    expect(deepMerge({ a: 1 }, 'override')).toBe('override')
  })

  it('arrays replace by default', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3, 4] })).toEqual({ a: [3, 4] })
  })

  it('mergeArray arrays append when base is array', () => {
    const result = deepMerge({ a: [1, 2] }, { a: mergeArray([3, 4]) })
    expect(result).toEqual({ a: [1, 2, 3, 4] })
  })

  it('mergeArray on non-array base uses override', () => {
    const result = deepMerge({ a: 'string' }, { a: mergeArray([3, 4]) as unknown as string[] })
    expect(result).toEqual({ a: [3, 4] })
  })

  it('recursively merges plain objects', () => {
    const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } })
    expect(result).toEqual({ a: { b: 1, c: 2 } })
  })

  it('nested null clears nested object', () => {
    const result = deepMerge({ a: { b: 1 } }, { a: null })
    expect(result).toEqual({ a: null })
  })

  it('nested undefined keeps nested base', () => {
    const result = deepMerge({ a: { b: 1 } }, { a: undefined })
    expect(result).toEqual({ a: { b: 1 } })
  })

  it('null base with object override returns override', () => {
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 })
  })

  it('array base replaced by array override without merge flag', () => {
    expect(deepMerge([1, 2], [3, 4])).toEqual([3, 4])
  })

  it('partial key override merges correctly', () => {
    const result = deepMerge({ a: 1, b: 2, c: 3 }, { b: 20 })
    expect(result).toEqual({ a: 1, b: 20, c: 3 })
  })

  it('both undefined returns undefined', () => {
    expect(deepMerge(undefined, undefined)).toBeUndefined()
  })

  it('deep nesting works', () => {
    const result = deepMerge(
      { a: { b: { c: 1 } } },
      { a: { b: { d: 2 } } },
    )
    expect(result).toEqual({ a: { b: { c: 1, d: 2 } } })
  })

  it('Date instances are not plain objects, override wins', () => {
    const d = new Date()
    expect(deepMerge({ a: 1 }, d)).toBe(d)
  })
})
