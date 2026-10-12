import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ASSETS_BASE_URL, createHtmlAssetHandler } from './assets.js'

export default {
  name: 'eleckoi-html-resources',
  inject: ['webServer'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSETS_BASE_URL.slice(0, -1), handler: createHtmlAssetHandler() }))
    ctx.on('webserver/index-inject', table => { table.push({ kind: 'global', name: '__ELECKOI_HTML_RESOURCES__', value: { baseUrl: ASSETS_BASE_URL } }) })
  }
} satisfies Plugin.Object
