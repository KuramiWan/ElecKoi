/** 显示模板是持久作者配置，计算结果只属于消息显示。 */
export interface AuthorDisplayTemplate {
  id: string
  name: string
  enabled: boolean
  /** before / after 在 AI 消息开头 / 末尾添加结果；replace 替换匹配片段。 */
  position: 'before' | 'after' | 'replace'
  /** replace 使用表达式正文，不包含 /.../g 外壳。 */
  pattern: string
  /** replace 的独立正则标志，例如 g。 */
  flags: string
  /** 标准 <% ... %> EJS 源码，保留空白；新建时可为空。 */
  source: string
}

export interface AuthorDisplayTemplateLibrary {
  scope: 'global' | 'character' | 'preset'
  ownerId: string
  enabled: boolean
  revision: number
  templates: AuthorDisplayTemplate[]
}
