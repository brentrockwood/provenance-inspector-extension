import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@provenance/evidence': p('./packages/evidence/src/index.ts'),
      '@provenance/detector-synthid': p('./packages/detectors/synthid-reference/src/index.ts'),
      '@provenance/detector-c2pa': p('./packages/detectors/c2pa/src/index.ts'),
      '@provenance/detector-anthropic-status': p('./packages/detectors/anthropic-status/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [p('./test/filereadersync-shim.ts')],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'fixtures/**/*.test.ts'],
  },
});
