import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/main/**/*.test.ts', 'src/main/**/*.test.ts'],
        },
        resolve: {
          alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
          },
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.{ts,tsx}', 'src/renderer/**/*.test.{ts,tsx}'],
          exclude: ['tests/renderer/tools/**'],
          setupFiles: ['./tests/setup-renderer.ts'],
        },
        resolve: {
          alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
          },
        },
      },
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tests/renderer/tools/**/*.test.ts'],
        },
        resolve: {
          alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'out/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/preload/**',
      ],
    },
  },
})
