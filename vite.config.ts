import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/neon-break/',
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
