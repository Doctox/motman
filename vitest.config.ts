import { defineConfig } from 'vitest/config'
import { pluginCatalogue } from './scripts/lib/catalogue.mjs'

export default defineConfig({
  plugins: [pluginCatalogue()],
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'output/**', 'node_modules/**'],
  },
})
