import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const defaultBase = '/raffle-wheel/'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'development' ? '/' : (process.env.VITE_BASE_PATH ?? defaultBase),
  test: {
    environment: 'jsdom',
    setupFiles: './src/vitest.setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
    },
  },
}))
