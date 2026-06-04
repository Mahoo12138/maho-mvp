import { describe, it, expect, vi } from 'vitest'

// Store callbacks keyed by event name
let eventCallbacks: Record<string, Array<(...args: unknown[]) => void>> = {}
let shouldFire: 'listening' | 'error' = 'listening'

vi.mock('node:net', () => ({
  createServer: vi.fn(() => ({
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (eventCallbacks[event] ??= []).push(cb)
    }),
    close: vi.fn((cb?: () => void) => {
      if (cb) cb()
    }),
    listen: vi.fn(() => {
      // Fire the appropriate event on next tick
      setImmediate(() => {
        eventCallbacks[shouldFire]?.forEach((cb) => cb())
      })
    }),
  })),
}))

import { createServer } from 'node:net'
import { isPortAvailable, allocatePort } from './port-manager.js'

beforeEach(() => {
  eventCallbacks = {}
  shouldFire = 'listening'
  vi.clearAllMocks()
})

describe('isPortAvailable', () => {
  it('returns true when port is free (listening event)', async () => {
    shouldFire = 'listening'
    const result = await isPortAvailable(3000)
    expect(result).toBe(true)
  })

  it('returns false when port is in use (error event)', async () => {
    shouldFire = 'error'
    const result = await isPortAvailable(3000)
    expect(result).toBe(false)
  })
})

describe('allocatePort', () => {
  it('returns preferred port when available', async () => {
    shouldFire = 'listening'
    const port = await allocatePort(3000, 5)
    expect(port).toBe(3000)
  })

  it('tries next port when some are taken', async () => {
    // First two error, third succeeds
    let callCount = 0
    vi.mocked(createServer).mockImplementation(() => {
      const currentCall = ++callCount
      return {
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          (eventCallbacks[event] ??= []).push(cb)
        }),
        close: vi.fn((cb?: () => void) => {
          if (cb) cb()
        }),
        listen: vi.fn(() => {
          setImmediate(() => {
            if (currentCall <= 2) {
              eventCallbacks['error']?.forEach((cb) => cb())
            } else {
              eventCallbacks['listening']?.forEach((cb) => cb())
            }
          })
        }),
      }
    })

    const port = await allocatePort(3000, 5)
    expect(port).toBe(3002)
  })

  it('throws when all ports in range are taken', async () => {
    vi.mocked(createServer).mockImplementation(() => ({
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (eventCallbacks[event] ??= []).push(cb)
      }),
      close: vi.fn((cb?: () => void) => {
        if (cb) cb()
      }),
      listen: vi.fn(() => {
        setImmediate(() => {
          eventCallbacks['error']?.forEach((cb) => cb())
        })
      }),
    }))

    await expect(allocatePort(3000, 2)).rejects.toThrow('No available port')
  })

  it('range of 0 throws immediately', async () => {
    await expect(allocatePort(3000, 0)).rejects.toThrow('No available port')
  })
})
