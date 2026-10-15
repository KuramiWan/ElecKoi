import { Context } from '@deepseek-ai/cordis'
import { mainWindowPlugin } from '@main/platform/electron/mainWindowPlugin'
import { mediaProtocolPlugin } from '@main/platform/electron/mediaProtocol'
import { updatesPlugin } from '@main/modules/updates'
import { platformPlugin } from './plugins'
import { dshHostPlugin } from './dshHostPlugin'

export class DesktopHost {
  private readonly root = new Context()
  private foundationMounted = false
  private interactiveMounted = false

  constructor(onFailure: (error: Error) => void = () => {}) {
    this.root.on('eleckoi/desktop-fatal', onFailure)
  }

  async mountFoundation(): Promise<void> {
    if (this.foundationMounted) return
    await this.root.plugin(platformPlugin)
    this.foundationMounted = true
  }

  async mountInteractive(): Promise<void> {
    if (this.interactiveMounted) return
    if (!this.foundationMounted) throw new Error('Desktop foundation 尚未装载。')
    await this.root.plugin(dshHostPlugin)
    await this.root.plugin(mediaProtocolPlugin)
    await this.root.plugin(mainWindowPlugin)
    await this.root.plugin(updatesPlugin)
    this.interactiveMounted = true
  }

  diagnostics() {
    return this.root.fiber.getEffects()
  }

  async stopPluginHost(): Promise<void> {
    await this.root.get('pluginHost')?.close()
  }

  async disableUserPlugins(): Promise<string | undefined> {
    const host = this.root.get('pluginHost')
    if (host === undefined) throw new Error('DSH 插件宿主未装载，无法恢复插件配置。')
    return host.disableUserPlugins()
  }

  async dispose(): Promise<void> {
    await this.root.fiber.dispose()
    this.interactiveMounted = false
    this.foundationMounted = false
  }
}
