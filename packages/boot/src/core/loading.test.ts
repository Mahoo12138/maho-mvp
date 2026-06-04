import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock document before importing MahoLoading
const mockEl = {
  getAttribute: vi.fn().mockReturnValue(null),
  setAttribute: vi.fn(),
  removeAttribute: vi.fn(),
  addEventListener: vi.fn(),
  remove: vi.fn(),
}

vi.stubGlobal('document', {
  getElementById: vi.fn((id: string) => {
    if (id === 'maho-loading') return mockEl
    return null
  }),
})

import { MahoLoading } from './loading.js'

describe('MahoLoading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => {
        if (id === 'maho-loading') return mockEl
        return null
      }),
    })
  })

  describe('show', () => {
    it('removes data-hidden attribute', () => {
      MahoLoading.show()
      expect(mockEl.removeAttribute).toHaveBeenCalledWith('data-hidden')
    })

    it('does nothing when element does not exist', () => {
      vi.stubGlobal('document', {
        getElementById: vi.fn().mockReturnValue(null),
      })
      expect(() => MahoLoading.show()).not.toThrow()
    })
  })

  describe('hide', () => {
    it('sets data-hidden attribute', () => {
      MahoLoading.hide()
      expect(mockEl.setAttribute).toHaveBeenCalledWith('data-hidden', '')
    })

    it('adds transitionend listener', () => {
      MahoLoading.hide()
      expect(mockEl.addEventListener).toHaveBeenCalledWith(
        'transitionend',
        expect.any(Function),
        { once: true },
      )
    })

    it('does nothing when element does not exist', () => {
      vi.stubGlobal('document', {
        getElementById: vi.fn().mockReturnValue(null),
      })
      expect(() => MahoLoading.hide()).not.toThrow()
      expect(mockEl.setAttribute).not.toHaveBeenCalled()
    })
  })
})
