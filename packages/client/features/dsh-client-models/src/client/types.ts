import type { Context } from '@deepseek-ai/cordis'

export interface ClientModelOption {
  id: string; name: string; description?: string; inputModalities?: readonly ('text' | 'image')[];
  contextWindowTokens?: number; maxOutputTokens?: number; supportsImageInput?: boolean;
  reasoningEfforts?: false | Record<string, string | null>; reasoningEffort?: string;
  temperature?: number; topP?: number; autoCompactTokenLimit?: number; isUserAdded?: boolean;
}
export interface ClientModelConfig {
  id: string; name?: string; provider?: string; model?: string; model_options?: ClientModelOption[];
  enabled?: boolean; base_url?: string; api_format?: string; api_key?: string;
  custom_headers?: Record<string, string>; proxy_url?: string; credentialRef?: string;
  credentialConfigured?: boolean; clearCredential?: boolean; settingsNs?: string; settingsPath?: string[];
  clearConfiguration?: boolean; image_settings?: Record<string, import('@eleckoi/dsh-product-api/types').VariableJsonValue>;
}
export interface ModelCatalogSnapshot { status: 'loading' | 'ready' | 'error'; configs: ClientModelConfig[]; error: string }

/** 通过官方模型目录、Settings 和 Credentials 管理模型配置。 */
export interface ElecKoiModels {
  /**
   * 读取模型目录的页面状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): ModelCatalogSnapshot
  /**
   * 订阅模型目录变化。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 重新读取官方模型目录和已保存配置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<ClientModelConfig[]>
  /**
   * 保存模型配置和明确声明的能力，不根据模型名称猜测能力。
   * @param config - 模型配置和明确声明的模型能力。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  save(config: ClientModelConfig): Promise<ClientModelConfig | undefined>
  /**
   * 删除一个配置，返回剩余目录的第一个配置。
   * @param id - 要读取或修改的项目编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  deleteConfig(id: string): Promise<ClientModelConfig | undefined>
  /**
   * 删除指定提供商的配置，返回剩余的首选配置。
   * @param provider - 提供商编号。
   * @param preferredId - 删除后优先选择的剩余配置编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  deleteProvider(provider: string, preferredId?: string): Promise<ClientModelConfig | undefined>
  /**
   * 读取模型列表并合并当前配置明确声明的参数。
   * @param config - 模型配置和明确声明的模型能力。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  discover(config: ClientModelConfig): Promise<ClientModelOption[]>
  /**
   * 使用官方适配器发起一次工具调用测试。
   * @param config - 模型配置和明确声明的模型能力。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  testConnection(config: ClientModelConfig): Promise<{ supported: true }>
  /**
   * 按配置编号读取密钥，供用户主动查看。
   * @param configId - 模型配置编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  revealApiKey(configId: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiModels: ElecKoiModels
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
