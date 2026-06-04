import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { renderTemplate } from './renderer.js'
import type { MahoTemplate } from './loader.js'

function tmpDir() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'maho-test-'))
}

async function makeTemplateDir(vars: Record<string, string | undefined>): Promise<MahoTemplate> {
  const srcDir = await tmpDir()
  // Write a .ejs file
  await fs.promises.writeFile(
    path.join(srcDir, 'hello.ejs'),
    'Hello, <%= name %>!',
    'utf-8',
  )
  // Write a static file
  await fs.promises.writeFile(
    path.join(srcDir, 'static.txt'),
    'static content',
    'utf-8',
  )
  // Write a nested directory
  await fs.promises.mkdir(path.join(srcDir, 'nested'))
  await fs.promises.writeFile(
    path.join(srcDir, 'nested', 'item.ejs'),
    'Item: <%= item %>',
    'utf-8',
  )
  // Write a non-ejs file in nested dir
  await fs.promises.writeFile(
    path.join(srcDir, 'nested', 'readme.txt'),
    'readme',
    'utf-8',
  )
  return { meta: { name: 'test', description: '', role: 'host', framework: 'vue' }, templateDir: srcDir }
}

async function cleanup(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true })
}

describe('renderTemplate', () => {
  let template: MahoTemplate
  let srcDir: string
  let destDir: string

  beforeEach(async () => {
    srcDir = await tmpDir()
    destDir = await tmpDir()

    await fs.promises.writeFile(
      path.join(srcDir, 'hello.ejs'),
      'Hello, <%= name %>!',
      'utf-8',
    )
    await fs.promises.writeFile(
      path.join(srcDir, 'static.txt'),
      'static content',
      'utf-8',
    )

    template = { meta: { name: 'test', description: '', role: 'host', framework: 'vue' }, templateDir: srcDir }
  })

  afterEach(async () => {
    await cleanup(srcDir)
    await cleanup(destDir)
  })

  it('renders .ejs files and strips .ejs extension', async () => {
    await renderTemplate(template, destDir, { name: 'World' })
    const content = await fs.promises.readFile(path.join(destDir, 'hello'), 'utf-8')
    expect(content).toBe('Hello, World!')
  })

  it('copies non-.ejs files verbatim', async () => {
    await renderTemplate(template, destDir, { name: 'X' })
    const content = await fs.promises.readFile(path.join(destDir, 'static.txt'), 'utf-8')
    expect(content).toBe('static content')
  })

  it('recursively renders nested directories', async () => {
    await fs.promises.mkdir(path.join(srcDir, 'nested'))
    await fs.promises.writeFile(
      path.join(srcDir, 'nested', 'item.ejs'),
      'Item: <%= item %>',
      'utf-8',
    )
    await renderTemplate(template, destDir, { name: 'X', item: 'foo' })
    const content = await fs.promises.readFile(path.join(destDir, 'nested', 'item'), 'utf-8')
    expect(content).toBe('Item: foo')
  })

  it('creates target directory if it does not exist', async () => {
    const newDest = path.join(destDir, 'new-subdir')
    await renderTemplate(template, newDest, { name: 'Test' })
    expect(fs.existsSync(newDest)).toBe(true)
    expect(fs.existsSync(path.join(newDest, 'hello'))).toBe(true)
  })

  it('works with empty variables', async () => {
    await renderTemplate(template, destDir, { name: '' })
    const content = await fs.promises.readFile(path.join(destDir, 'hello'), 'utf-8')
    expect(content).toBe('Hello, !')
  })

  it('overwrites existing target directory', async () => {
    await fs.promises.mkdir(destDir, { recursive: true })
    await renderTemplate(template, destDir, { name: 'Overwrite' })
    const content = await fs.promises.readFile(path.join(destDir, 'hello'), 'utf-8')
    expect(content).toBe('Hello, Overwrite!')
  })
})
