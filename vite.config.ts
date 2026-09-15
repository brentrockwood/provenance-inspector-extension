import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * The manifest is authored as source, not as a build artifact, so it lives beside the code
 * it describes and is copied verbatim. Generating it would mean the file a reviewer reads is
 * not the file Chrome loads.
 */
function copyManifest(): Plugin {
  return {
    name: 'copy-manifest',
    closeBundle() {
      mkdirSync(p('./dist'), { recursive: true });
      copyFileSync(p('./apps/extension/manifest.json'), p('./dist/manifest.json'));
    },
  };
}

export default defineConfig({
  root: 'apps/extension',
  publicDir: 'public',
  plugins: [copyManifest()],
  resolve: {
    alias: {
      '@provenance/evidence': p('./packages/evidence/src/index.ts'),
      '@provenance/detector-synthid': p('./packages/detectors/synthid-reference/src/index.ts'),
      '@provenance/detector-c2pa': p('./packages/detectors/c2pa/src/index.ts'),
      '@provenance/detector-anthropic-status': p(
        './packages/detectors/anthropic-status/src/index.ts',
      ),
    },
  },
  build: {
    outDir: p('./dist'),
    emptyOutDir: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        panel: p('./apps/extension/panel.html'),
        background: p('./apps/extension/src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
