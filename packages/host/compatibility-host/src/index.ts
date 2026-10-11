import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ASSETS_BASE_URL, createAuthorAssetHandler } from './assets.js'

export default {
  name: 'eleckoi-compatibility-host',
  inject: ['webServer'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSETS_BASE_URL.slice(0, -1), handler: createAuthorAssetHandler() }))
    ctx.on('webserver/index-inject', table => { table.push({ kind: 'global', name: '__ELECKOI_COMPATIBILITY_ASSETS__', value: { baseUrl: ASSETS_BASE_URL } }) })
  }
} satisfies Plugin.Object
