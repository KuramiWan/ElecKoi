import type { Context } from '@deepseek-ai/cordis'
import type { PersonaProfile } from '@eleckoi/dsh-product-api/types'

export interface PersonaSnapshot { status: 'loading' | 'ready' | 'error'; profile: PersonaProfile | null; error: string }

/** 读取、保存用户资料并订阅当前页面的资料变化。 */
export interface ElecKoiPersona {
  /**
   * 读取当前页面的用户资料状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): PersonaSnapshot
  /**
   * 订阅资料状态变化。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 重新读取 Host 保存的用户资料。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<PersonaProfile>
  /**
   * 保存用户资料并更新页面状态。
   * @param profile - 完整用户资料。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  save(profile: PersonaProfile): Promise<PersonaProfile>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiPersona: ElecKoiPersona
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
