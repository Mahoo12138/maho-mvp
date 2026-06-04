import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { detectPackageManager } from './detector.js'

vi.mock('node:fs')

describe('detectPackageManager', () => {
  it('returns pnpm when pnpm-lock.yaml exists', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p).includes('pnpm-lock.yaml'),
    )
    expect(detectPackageManager('/root')).toBe('pnpm')
  })

  it('returns yarn when yarn.lock exists (and no pnpm lock)', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p).includes('yarn.lock'),
    )
    expect(detectPackageManager('/root')).toBe('yarn')
  })

  it('returns npm when package-lock.json exists', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p).includes('package-lock.json'),
    )
    expect(detectPackageManager('/root')).toBe('npm')
  })

  it('falls back to npm_config_user_agent when no lockfiles', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0')
    expect(detectPackageManager('/root')).toBe('pnpm')
  })

  it('falls back to yarn from user agent', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.stubEnv('npm_config_user_agent', 'yarn/1.22.0')
    expect(detectPackageManager('/root')).toBe('yarn')
  })

  it('returns npm when user agent is empty', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.stubEnv('npm_config_user_agent', undefined as unknown as string)
    expect(detectPackageManager('/root')).toBe('npm')
  })

  it('returns npm when user agent is unknown', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.stubEnv('npm_config_user_agent', 'gradle/8.0')
    expect(detectPackageManager('/root')).toBe('npm')
  })

  it('lockfile takes priority over user agent', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p).includes('pnpm-lock.yaml'),
    )
    vi.stubEnv('npm_config_user_agent', 'yarn/1.22.0')
    expect(detectPackageManager('/root')).toBe('pnpm')
  })
})
