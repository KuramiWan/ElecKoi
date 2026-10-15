import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'vite'
import { expect, it } from 'vitest'
import webConfig from '../../vite.config.mjs'

const require = createRequire(import.meta.url)

it('bundles dnd-kit against the production DSH platform and shares its React DOM batching API', async () => {
  const entryId = '\0test-dsh-dnd-platform'
  const platformPlugin = webConfig.plugins.find(plugin => plugin.name === 'eleckoi-dsh-platform-react')
  expect(platformPlugin).toBeDefined()

  const result = await build({
    configFile: false,
    root: webConfig.root,
    logLevel: 'silent',
    plugins: [platformPlugin, {
      name: 'test-dsh-dnd-entry',
      resolveId: source => source === entryId ? entryId : null,
      load: id => id === entryId
        ? "export { DndContext } from '@dnd-kit/core'; export { unstable_batchedUpdates } from 'react-dom';"
        : null
    }],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        input: entryId,
        output: { format: 'iife', name: 'DndPlatformProbe', exports: 'named' }
      }
    }
  })

  const react = require('react')
  const reactDom = require('react-dom')
  const runtime = {
    __ELECKOI_DSH_PLATFORM__: { react, reactDom }
  }
  const chunk = result.output.find(item => item.type === 'chunk' && item.isEntry)
  expect(chunk).toBeDefined()
  runInNewContext(chunk.code, runtime)

  const markup = require('react-dom/server').renderToStaticMarkup(
    react.createElement(runtime.DndPlatformProbe.DndContext, null,
      react.createElement('div', null, 'Drag item'))
  )
  expect(markup).toContain('Drag item')
  expect(runtime.DndPlatformProbe.unstable_batchedUpdates).toBe(reactDom.unstable_batchedUpdates)
  let calls = 0
  const value = runtime.DndPlatformProbe.unstable_batchedUpdates(argument => {
    calls += 1
    return argument
  }, 42)
  expect(calls).toBe(1)
  expect(value).toBe(42)
}, 30_000)
