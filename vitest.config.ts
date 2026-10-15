import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import { authorVendorPlugin } from './scripts/vite-author-vendor-plugin'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('apps/desktop/src/main'),
      '@product-data': resolve('packages/host/product-data/src'),
      '@shared': resolve('packages/shared/src'),
      '@eleckoi/dsh-product-data/media': resolve('packages/host/product-data/src/storage/media/index.ts'),
      '@eleckoi/dsh-product-data/variables': resolve('packages/host/product-data/src/domain/variables/variableSchema.ts'),
      '@eleckoi/dsh-product-data/frontends': resolve('packages/host/product-data/src/domain/frontends/index.ts'),
      '@eleckoi/dsh-product-data': resolve('packages/host/product-data/src/index.ts'),
      '@eleckoi/desktop-host': resolve('apps/desktop-host/src/index.ts'),
      '@eleckoi/dsh-runtime': resolve('packages/host/runtime/src/index.ts')
    }
  },
  plugins: [authorVendorPlugin(resolve('.'))],
  test: {
    exclude: [...configDefaults.exclude, 'build/**'],
    environment: 'node',
    server: {
      deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] }
    }
  }
})
