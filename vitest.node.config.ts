import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/core/src/**/*.test.ts',
      'packages/cli/src/**/*.test.ts',
      'packages/boot/src/**/*.test.ts',
    ],
    exclude: [
      'packages/boot-vue/src/**/*.test.ts',
    ],
    environment: 'node',
    globals: true,
  },
})
