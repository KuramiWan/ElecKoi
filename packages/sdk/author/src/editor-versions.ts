/** 完整命名版本；content 是对应配置类型的 JSON，脚本版本包含源码及资源，正则版本包含整体 enabled 与 rules。 */
export interface AuthorEditorLibraryVersions {
  kind: 'scripts' | 'displayTemplates' | 'regex'
  scope: 'global' | 'character' | 'preset'
  ownerId: string
  revision: number
  resourceRevision: string
  activeVersionId: string
  versions: Array<{ id: string; name: string; content: string }>
}

export interface AuthorEditorLibrarySaveResult {
  documents: string[]
  versions: AuthorEditorLibraryVersions[]
}
