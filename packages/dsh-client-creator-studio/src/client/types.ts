import type { Context } from '@deepseek-ai/cordis'
import type { CreatorProjectCollection, CreateCreatorProjectInput } from '@eleckoi/dsh-product-api/types'

export interface CreatorStudioSnapshot { status: 'loading' | 'ready' | 'error'; collection: CreatorProjectCollection; error: string }

/** 管理创作项目并使用官方目录选择器。 */
export interface ElecKoiCreatorStudio {
  /**
   * 读取项目目录状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): CreatorStudioSnapshot
  /**
   * 订阅项目目录变化。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 重新读取项目目录。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<CreatorProjectCollection>
  /**
   * 创建项目并更新目录。
   * @param input - 创建项目所需数据。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  create(input: CreateCreatorProjectInput): Promise<CreatorProjectCollection>
  /**
   * 删除项目目录中的指定项目。
   * @param projectId - 创作项目编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  delete(projectId: string): Promise<CreatorProjectCollection>
  /**
   * 打开官方目录选择器；取消选择时返回 null。
   * @param signal - 取消本次操作的信号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  selectDirectory(signal?: AbortSignal): Promise<string | null>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiCreatorStudio: ElecKoiCreatorStudio
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
