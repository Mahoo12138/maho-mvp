import { describe, it, expect } from 'vitest'
import { loadTemplate, listBuiltinTemplates } from './loader.js'
import type { MahoTemplate } from './loader.js'

describe('listBuiltinTemplates', () => {
  it('returns host-vue and remote-vue', () => {
    const list = listBuiltinTemplates()
    expect(list).toContain('host-vue')
    expect(list).toContain('remote-vue')
    expect(list).toHaveLength(2)
  })
})

describe('loadTemplate', () => {
  it('loads host-vue template', () => {
    const tpl: MahoTemplate = loadTemplate('host-vue')
    expect(tpl.meta.name).toBe('host-vue')
    expect(tpl.meta.role).toBe('host')
    expect(tpl.meta.framework).toBe('vue')
    expect(tpl.meta.description).toBeTruthy()
    expect(tpl.templateDir).toContain('host-vue')
    expect(tpl.templateDir).toContain('template')
  })

  it('loads remote-vue template', () => {
    const tpl: MahoTemplate = loadTemplate('remote-vue')
    expect(tpl.meta.name).toBe('remote-vue')
    expect(tpl.meta.role).toBe('remote')
    expect(tpl.meta.framework).toBe('vue')
    expect(tpl.templateDir).toContain('remote-vue')
  })

  it('throws for unknown template name', () => {
    expect(() => loadTemplate('nonexistent')).toThrow(/template-not-found|Template.*not found/)
  })

  it('error message includes available templates', () => {
    try {
      loadTemplate('nonexistent')
    } catch (err) {
      expect((err as Error).message).toContain('host-vue')
      expect((err as Error).message).toContain('remote-vue')
    }
  })
})
