import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import puterLocalhost from '../../dev/puter-localhost.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [puterLocalhost('contacts')],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    // Pure logic only — no DOM needed, so the fast node environment is enough.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
