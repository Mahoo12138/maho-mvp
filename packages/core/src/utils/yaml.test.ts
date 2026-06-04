import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import yaml from 'js-yaml'

vi.mock('node:fs')

import { buildSchema, parseYaml } from './yaml.js'

describe('buildSchema', () => {
  it('!env resolves required env var', () => {
    const schema = buildSchema({ MY_KEY: 'my_value' })
    const result = yaml.load('!env MY_KEY', { schema })
    expect(result).toBe('my_value')
  })

  it('!env throws when variable is missing', () => {
    const schema = buildSchema({})
    expect(() => yaml.load('!env MISSING', { schema })).toThrow(
      'Required env variable "MISSING"',
    )
  })

  it('!env throws when variable is empty', () => {
    const schema = buildSchema({ EMPTY: '' })
    expect(() => yaml.load('!env EMPTY', { schema })).toThrow(
      'Required env variable "EMPTY"',
    )
  })

  it('!env? returns value when present', () => {
    const schema = buildSchema({ OPT: 'present' })
    const result = yaml.load('!env? OPT', { schema })
    expect(result).toBe('present')
  })

  it('!env? returns null when missing', () => {
    const schema = buildSchema({})
    const result = yaml.load('!env? MISSING', { schema })
    expect(result).toBeNull()
  })

  it('!mergeArray returns array with merge symbol', () => {
    const schema = buildSchema({})
    const result = yaml.load('!mergeArray [1, 2, 3]', { schema }) as unknown[]
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([1, 2, 3])
    expect((result as Record<symbol, unknown>)[Symbol.for('maho:mergeArray')]).toBe(true)
  })
})

describe('parseYaml', () => {
  it('parses a basic YAML file', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('key: value\nnumber: 42')
    const result = await parseYaml('/path/to/config.yml', {})
    expect(result).toEqual({ key: 'value', number: 42 })
  })

  it('parses YAML with env substitution', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('base_url: !env API_URL')
    const result = await parseYaml('/path/to/config.yml', {
      API_URL: 'https://api.example.com',
    })
    expect(result).toEqual({ base_url: 'https://api.example.com' })
  })
})
