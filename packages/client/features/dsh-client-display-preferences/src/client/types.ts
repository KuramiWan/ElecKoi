import type { Context } from '@deepseek-ai/cordis'
import type { DisplayPreferenceValue } from '@eleckoi/dsh-product-api/types'

export interface ClientDisplayPreferencesSnapshot { status: 'loading' | 'ready' | 'error'; ui: Readonly<Record<string, DisplayPreferenceValue>>; chatDisplay: Readonly<Record<string, DisplayPreferenceValue>>; writable: boolean; revision?: number; error: string }

/** 读取和保存显示偏好；保存请求在当前页面中依次执行。 */
export interface ElecKoiDisplayPreferences {
  /**
   * 读取显示偏好的页面状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): ClientDisplayPreferencesSnapshot
  /**
   * 订阅显示偏好变化。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 重新读取显示偏好。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<ClientDisplayPreferencesSnapshot>
  /**
   * 更新界面偏好，可根据队列执行时的当前值生成更新。
   * @param update - 新配置或根据当前配置计算新配置的函数。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  updateUi(update: Record<string, DisplayPreferenceValue> | ((current: Readonly<Record<string, DisplayPreferenceValue>>) => Record<string, DisplayPreferenceValue>)): Promise<ClientDisplayPreferencesSnapshot>
  /**
   * 保存聊天显示配置。
   * @param value - 完整待保存配置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  setChatDisplay(value: Record<string, DisplayPreferenceValue>): Promise<ClientDisplayPreferencesSnapshot>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiDisplayPreferences: ElecKoiDisplayPreferences
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
