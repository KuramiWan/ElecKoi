import { describe, expect, it } from 'vitest'
import { platformPlugin } from '../src/main/host/plugins'
import { dshHostPlugin } from '../src/main/host/dshHostPlugin'
import { mainWindowPlugin } from '../src/main/platform/electron/mainWindowPlugin'
import { mediaProtocolPlugin } from '../src/main/platform/electron/mediaProtocol'
import { updatesPlugin } from '../src/main/modules/updates'

const plugins = [
  platformPlugin,
  dshHostPlugin,
  mediaProtocolPlugin,
  mainWindowPlugin,
  updatesPlugin
]

describe('Cordis plugin definitions', () => {
  it('load as named object plugins without mutating Function.name', () => {
    expect(plugins).toHaveLength(5)
    for (const plugin of plugins) {
      expect(plugin.name).toMatch(/^eleckoi-/)
      expect(plugin.apply).toBeTypeOf('function')
      expect(typeof plugin).toBe('object')
    }
  })
})
