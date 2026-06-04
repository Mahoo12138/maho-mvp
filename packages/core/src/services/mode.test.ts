import { describe, it, expect, vi } from 'vitest'

// Mock cordis before importing ModeService
vi.mock('cordis', () => {
  class Service {
    constructor(_ctx: unknown, _name: string) {}
  }
  return { Service }
})

import { ModeService } from '../services/mode.js'
import type { MFContext } from '../context.js'

function makeCtx(): MFContext {
  return {} as MFContext
}

describe('ModeService', () => {
  it('mode=dev → isDev=true, isProd=false', () => {
    const svc = new ModeService(makeCtx(), 'dev')
    expect(svc.isDev).toBe(true)
    expect(svc.isProd).toBe(false)
    expect(svc.current).toBe('dev')
  })

  it('mode=prod → isDev=false, isProd=true', () => {
    const svc = new ModeService(makeCtx(), 'prod')
    expect(svc.isDev).toBe(false)
    expect(svc.isProd).toBe(true)
    expect(svc.current).toBe('prod')
  })

  it('mode=staging → both false', () => {
    const svc = new ModeService(makeCtx(), 'staging')
    expect(svc.isDev).toBe(false)
    expect(svc.isProd).toBe(false)
  })

  it('mode=empty string → both false', () => {
    const svc = new ModeService(makeCtx(), '')
    expect(svc.isDev).toBe(false)
    expect(svc.isProd).toBe(false)
  })

  it('current property is readable', () => {
    const svc = new ModeService(makeCtx(), 'test')
    expect(svc.current).toBe('test')
  })
})
