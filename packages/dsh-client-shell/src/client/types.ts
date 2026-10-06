import type { Context } from '@deepseek-ai/cordis'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
export type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

declare module '@deepseek-ai/cordis' {
  interface Context { layout: ILayout }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
