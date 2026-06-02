#!/usr/bin/env node
// Load the TS source directly via jiti — avoids needing a dist build step
// and the .js-suffix dance that Node ESM strict resolution requires.
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

const jiti = createJiti(fileURLToPath(import.meta.url), {
  interopDefault: true,
})
await jiti.import('../src/index.ts')
