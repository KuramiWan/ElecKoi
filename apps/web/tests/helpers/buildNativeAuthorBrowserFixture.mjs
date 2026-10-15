import { build } from 'vite';
import { resolve } from 'node:path';

for (const surface of ['message', 'project', 'libraries']) await build({
  configFile: false,
  resolve: { alias: { '@shared': resolve('packages/shared/src') } },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: `output/playwright/native-${surface}`, emptyOutDir: false,
    lib: { entry: `apps/web/tests/fixtures/native-author-${surface}.jsx`, name: 'NativeAuthorFixture', formats: ['iife'], fileName: () => 'fixture.js', cssFileName: 'fixture' },
  },
});
