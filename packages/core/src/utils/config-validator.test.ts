import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { validateConfig } from './config-validator.js'
import type { ValidationResult } from './config-validator.js'

vi.mock('node:fs')

function valid(errors: ValidationResult['errors']): ValidationResult {
  return { valid: errors.length === 0, errors }
}

describe('validateConfig', () => {
  it('minimal valid host config', () => {
    expect(validateConfig({ role: 'host' })).toEqual(valid([]))
  })

  it('minimal valid remote config', () => {
    expect(validateConfig({ role: 'remote', name: 'my-app' })).toEqual(valid([]))
  })

  it('empty config fails on role', () => {
    const result = validateConfig({})
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'role')).toBe(true)
  })

  it('invalid role value', () => {
    const result = validateConfig({ role: 'invalid' as unknown as 'host' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]!.path).toBe('role')
  })

  it('remote without name fails', () => {
    const result = validateConfig({ role: 'remote' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'name')).toBe(true)
  })

  it('boot must be string', () => {
    const result = validateConfig({ role: 'host', boot: 123 as unknown as string })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'boot')).toBe(true)
  })

  it('boot can be a valid string', () => {
    expect(validateConfig({ role: 'host', boot: '@maho/boot-vue' })).toEqual(valid([]))
  })

  it('invalid URL in federation remotes', () => {
    const result = validateConfig({
      role: 'host',
      federation: { remotes: ['not-a-url'] },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.startsWith('federation.remotes'))).toBe(true)
  })

  it('valid URLs in federation remotes pass', () => {
    expect(
      validateConfig({
        role: 'host',
        federation: { remotes: ['https://cdn.example.com/remoteEntry.js'] },
      }),
    ).toEqual(valid([]))
  })

  it('plugins that are not arrays are silently skipped', () => {
    expect(
      validateConfig({ role: 'host', plugins: 'not-array' as unknown as undefined }),
    ).toEqual(valid([]))
  })

  it('invalid plugin declaration fails', () => {
    const result = validateConfig({
      role: 'host',
      plugins: [{ use: 123 as unknown as string }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.startsWith('plugins[0]'))).toBe(true)
  })

  it('local plugin file check with projectRoot', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = validateConfig(
      { role: 'host', plugins: [{ use: './my-plugin' }] },
      '/project',
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('local plugin file not found'))).toBe(true)
  })

  it('local plugin file check skips when no projectRoot', () => {
    const result = validateConfig(
      { role: 'host', plugins: [{ use: './my-plugin' }] },
    )
    expect(result.valid).toBe(true)
  })

  it('npm package plugin skips file existence check', () => {
    expect(
      validateConfig(
        { role: 'host', plugins: [{ use: '@scope/package' }] },
        '/project',
      ),
    ).toEqual(valid([]))
  })

  it('multiple errors collected simultaneously', () => {
    const result = validateConfig({
      role: 'invalid' as unknown as 'host',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
  })
})

describe('isValidUrl', () => {
  // tested indirectly through validateConfig federation.remotes
  it('rejects non-URL strings', () => {
    const result = validateConfig({
      role: 'host',
      federation: { remotes: ['not-a-url'] },
    })
    expect(result.valid).toBe(false)
  })

  it('accepts https URLs', () => {
    const result = validateConfig({
      role: 'host',
      federation: { remotes: ['https://example.com/entry.js'] },
    })
    expect(result.valid).toBe(true)
  })

  it('accepts http://localhost', () => {
    const result = validateConfig({
      role: 'host',
      federation: { remotes: ['http://localhost:3000/remoteEntry.js'] },
    })
    expect(result.valid).toBe(true)
  })
})
