import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchMode, TavilyConnection } from '@eleckoi/dsh-product-api/types'

export interface WebSearchSnapshot { status: 'loading' | 'ready' | 'error'; mode: WebSearchMode; maxResults: number; apiKeyConfigured: boolean; apiKeyRef: string; apiKeyWritable: boolean; writable: boolean; tavilyAvailable: boolean; revision?: number; error: string }

/** 管理联网搜索方式、Tavily 配置和官方 Credentials 中的密钥。 */
export interface ElecKoiWebSearch {
  /**
   * 读取搜索配置的页面状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): WebSearchSnapshot
  /**
   * 订阅搜索配置变化。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 重新读取搜索配置和密钥是否已设置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<WebSearchSnapshot>
  /**
   * 修改搜索方式和返回条数，条数必须在 1 至 8 之间。
   * @param patch - 要修改的配置字段。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  update(patch: { mode?: WebSearchMode; maxResults?: number }): Promise<WebSearchSnapshot>
  /**
   * 测试密钥，通过后保存至官方 Credentials 并刷新页面状态。
   * @param apiKey - 待测试或保存的密钥。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveAndTest(apiKey: string): Promise<{ settings: WebSearchSnapshot; connection: TavilyConnection }>
  /**
   * 测试临时密钥；未传密钥时测试当前已保存密钥。
   * @param apiKey - 待测试或保存的密钥。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  test(apiKey?: string): Promise<{ connection: TavilyConnection }>
  /**
   * 移除已保存的搜索密钥。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  removeKey(): Promise<WebSearchSnapshot>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiWebSearch: ElecKoiWebSearch
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
