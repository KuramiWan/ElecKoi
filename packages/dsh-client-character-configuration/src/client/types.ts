import type { Context } from '@deepseek-ai/cordis'
import type { SettingLibrary, SettingLibraryConversation, VariableConfig, RegexRule, RegexRuleCollection, RegexRuleScope, RegexRuleImportDocument, RegexRuleImportResult, RegexRuleTestResult, RegexRuleTarget } from '@eleckoi/dsh-product-api/types'

export interface ConfigurationSnapshot<T> { status: 'idle' | 'loading' | 'ready' | 'error'; value: T | null; error: string }

/** 读取和保存角色配置，保留完整字段、触发方式和提示词插入位置。 */
export interface ElecKoiSettingLibraries {
  /**
   * 读取指定角色在页面中的配置状态。
   * @param characterId - 角色编号。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(characterId: string): ConfigurationSnapshot<SettingLibrary>
  /**
   * 订阅配置变化，通知中包含角色编号和变化后的值。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: (kind: 'configuration' | 'conversations', characterId: string, snapshot: ConfigurationSnapshot<SettingLibrary | SettingLibraryConversation[]>) => void): () => void
  /**
   * 读取完整配置并更新页面状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  read(characterId: string): Promise<SettingLibrary>
  /**
   * 读取完整配置，不更新页面中的已加载状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readUntracked(characterId: string): Promise<SettingLibrary>
  /**
   * 保存完整配置；正则配置使用其 revision 检查是否发生并发修改。
   * @param characterId - 角色编号。
   * @param value - 完整待保存配置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  save(characterId: string, value: SettingLibrary): Promise<SettingLibrary>
  /**
   * 保存配置页面中已展开项目的编号。
   * @param characterId - 角色编号。
   * @param expandedIds - 页面中已展开项目的编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveViewState(characterId: string, expandedIds: string[]): Promise<string[]>
  /**
   * 读取此角色各聊天设定库的页面状态。
   * @param characterId - 角色编号。
   * @returns 当前页面保存的状态对象。
   */
  getConversationSnapshot(characterId: string): ConfigurationSnapshot<SettingLibraryConversation[]>
  /**
   * 读取此角色各聊天的完整设定库。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readConversations(characterId: string): Promise<SettingLibraryConversation[]>
  /**
   * 保存指定聊天的设定库。
   * @param characterId - 角色编号。
   * @param sessionId - 目标聊天编号。
   * @param library - 完整设定库，包含触发条件和插入位置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveConversation(characterId: string, sessionId: string, library: SettingLibrary): Promise<SettingLibrary>
  /**
   * 恢复指定聊天的设定库。
   * @param characterId - 角色编号。
   * @param sessionId - 目标聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  resetConversation(characterId: string, sessionId: string): Promise<void>
  /**
   * 为指定聊天的设定库保存命名版本。
   * @param characterId - 角色编号。
   * @param sessionId - 目标聊天编号。
   * @param name - 保存的名称。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveConversationVersion(characterId: string, sessionId: string, name: string): Promise<SettingLibrary>
}

/** 读取和保存角色配置，保留完整字段、触发方式和提示词插入位置。 */
export interface ElecKoiVariables {
  /**
   * 读取指定角色在页面中的配置状态。
   * @param characterId - 角色编号。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(characterId: string): ConfigurationSnapshot<VariableConfig>
  /**
   * 订阅配置变化，通知中包含角色编号和变化后的值。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: (kind: 'configuration' | 'conversations', characterId: string, snapshot: ConfigurationSnapshot<VariableConfig>) => void): () => void
  /**
   * 读取完整配置并更新页面状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  read(characterId: string): Promise<VariableConfig>
  /**
   * 读取完整配置，不更新页面中的已加载状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readUntracked(characterId: string): Promise<VariableConfig>
  /**
   * 保存完整配置；正则配置使用其 revision 检查是否发生并发修改。
   * @param characterId - 角色编号。
   * @param value - 完整待保存配置。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  save(characterId: string, value: VariableConfig): Promise<VariableConfig>
  /**
   * 保存配置页面中已展开项目的编号。
   * @param characterId - 角色编号。
   * @param expandedIds - 页面中已展开项目的编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveViewState(characterId: string, expandedIds: string[]): Promise<string[]>
}

/** 读取和保存角色配置，保留完整字段、触发方式和提示词插入位置。 */
export interface ElecKoiRegexRules {
  /**
   * 读取指定角色在页面中的配置状态。
   * @param characterId - 角色编号。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(characterId: string): ConfigurationSnapshot<RegexRuleCollection>
  /**
   * 订阅配置变化，通知中包含角色编号和变化后的值。
   * @param listener - 状态变化回调；返回的函数用于取消订阅。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: (kind: 'configuration' | 'conversations', characterId: string, snapshot: ConfigurationSnapshot<RegexRuleCollection>) => void): () => void
  /**
   * 读取完整配置并更新页面状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  read(characterId: string): Promise<RegexRuleCollection>
  /**
   * 读取完整配置，不更新页面中的已加载状态。
   * @param characterId - 角色编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readUntracked(characterId: string): Promise<RegexRuleCollection>
  /**
   * 保存完整配置；正则配置使用其 revision 检查是否发生并发修改。
   * @param characterId - 角色编号。
   * @param collection - 完整正则配置，包含当前 revision。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  save(characterId: string, collection: RegexRuleCollection): Promise<RegexRuleCollection>
  /**
   * 校验当前 revision 后导入正则文件。
   * @param characterId - 角色编号。
   * @param collection - 完整正则配置，包含当前 revision。
   * @param fallbackScope - 导入文件未指定归属时使用的范围。
   * @param documents - 待导入的正则文件。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  import(characterId: string, collection: RegexRuleCollection, fallbackScope: RegexRuleScope, documents: RegexRuleImportDocument[]): Promise<RegexRuleImportResult>
  /**
   * 导出指定正则规则的 JSON 文本。
   * @param characterId - 角色编号。
   * @param ruleIds - 待导出的正则编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  export(characterId: string, ruleIds: string[]): Promise<{ fileName: string; json: string }>
  /**
   * 在指定文本上测试规则，不保存规则。
   * @param text - 待处理文本。
   * @param rule - 待测试的正则规则。
   * @param target - 正则规则作用的内容类别。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  test(text: string, rule: RegexRule, target: RegexRuleTarget): Promise<RegexRuleTestResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiSettingLibraries: ElecKoiSettingLibraries
    eleckoiVariables: ElecKoiVariables
    eleckoiRegexRules: ElecKoiRegexRules
  }
}

/** Client 插件入口。 */
export declare function apply(ctx: Context): void
export declare const inject: string[]
