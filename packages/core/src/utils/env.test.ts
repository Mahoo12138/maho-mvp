import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'

vi.mock('node:fs')

import { loadEnvFiles } from './env.js'

function mockFileReads(files: Record<string, string>) {
  vi.mocked(fs.existsSync).mockImplementation(
    (p: fs.PathLike) => files.hasOwnProperty(String(p).replace(/\\/g, '/').split('/').pop()!),
  )
  vi.mocked(fs.readFileSync).mockImplementation(
    (p: fs.PathLike, _opts?: unknown) => {
      const name = String(p).replace(/\\/g, '/').split('/').pop()!
      return files[name] ?? ''
    },
  )
}

describe('loadEnvFiles', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue('')
  })

  it('returns process.env when no .env files exist', () => {
    const result = loadEnvFiles('/project', 'dev')
    // Should at least contain process.env (which vitest sets)
    expect(typeof result).toBe('object')
  })

  it('loads .env file', () => {
    mockFileReads({
      '.env': 'MY_KEY=my_value\nOTHER=other_val',
    })
    const result = loadEnvFiles('/project', 'production')
    expect(result['MY_KEY']).toBe('my_value')
    expect(result['OTHER']).toBe('other_val')
  })

  it('.env.local overrides .env', () => {
    mockFileReads({
      '.env': 'KEY=base',
      '.env.local': 'KEY=local',
    })
    const result = loadEnvFiles('/project', 'production')
    expect(result['KEY']).toBe('local')
  })

  it('mode-specific files are loaded', () => {
    mockFileReads({
      '.env': 'KEY=base',
      '.env.dev': 'KEY=dev_mode',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('dev_mode')
  })

  it('.env.dev.local has highest file priority', () => {
    mockFileReads({
      '.env': 'KEY=base',
      '.env.dev': 'KEY=dev',
      '.env.dev.local': 'KEY=dev_local',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('dev_local')
  })

  it('quoted values are unquoted', () => {
    mockFileReads({
      '.env': 'KEY="quoted value"',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('quoted value')
  })

  it('inline comments are stripped', () => {
    mockFileReads({
      '.env': 'KEY=value # this is a comment',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('value')
  })

  it('empty lines and comment-only lines are skipped', () => {
    mockFileReads({
      '.env': '# this is a comment\n\nKEY=value\n\n# another comment',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('value')
    expect(Object.keys(result).filter((k) => k === 'KEY')).toHaveLength(1)
  })

  it('lines without = are skipped', () => {
    mockFileReads({
      '.env': 'KEY=value\nMALFORMED_LINE\nANOTHER=val',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['KEY']).toBe('value')
    expect(result['ANOTHER']).toBe('val')
    expect(result['MALFORMED_LINE']).toBeUndefined()
  })

  it('process.env overrides .env files', () => {
    vi.stubEnv('MY_OVERRIDE', 'from_process')
    mockFileReads({
      '.env': 'MY_OVERRIDE=from_file',
    })
    const result = loadEnvFiles('/project', 'dev')
    expect(result['MY_OVERRIDE']).toBe('from_process')
  })
})
