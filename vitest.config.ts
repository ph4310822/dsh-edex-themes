import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The harness runtime client bundle is loader-format (not importable in
      // Node). Standalone tests alias the specifier to local doubles.
      '@deepseek-ai/dsh-client-runtime/client': resolve(import.meta.dirname, 'tests/support/runtime-double.ts'),
    },
  },
  test: {
    include: ['tests/*.client.spec.ts', 'tests/*.client.spec.tsx'],
    environment: 'node',
  },
})