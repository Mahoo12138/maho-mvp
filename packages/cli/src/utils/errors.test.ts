import { describe, it, expect } from 'vitest'
import { MahoError } from './errors.js'

describe('MahoError', () => {
  it('is an instance of MahoError', () => {
    const err = new MahoError('dir-exists', 'Directory already exists')
    expect(err).toBeInstanceOf(MahoError)
  })

  it('is an instance of Error', () => {
    const err = new MahoError('workspace-not-found', 'Not found')
    expect(err).toBeInstanceOf(Error)
  })

  it('has the correct code', () => {
    const err = new MahoError('template-not-found', 'Template not found')
    expect(err.code).toBe('template-not-found')
  })

  it('has the correct message and name', () => {
    const err = new MahoError('no-port', 'No port available')
    expect(err.message).toBe('No port available')
    expect(err.name).toBe('MahoError')
  })
})
