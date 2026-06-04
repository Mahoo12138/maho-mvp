import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/boot/src/core/loading.test.ts',
      'packages/boot-vue/src/**/*.test.ts',
    ],
    environment: 'jsdom',
    globals: true,
  },
})
