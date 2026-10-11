export interface ChatImportMessage {
  role: 'user' | 'assistant'
  content: string
  variableStateJson?: string
}
export interface ChatImportDocument {
  messages: ChatImportMessage[]
  currentVariableStateJson?: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('聊天导入字段必须是 JSON 对象。')
  return value as Record<string, unknown>
}
function state(value: unknown): string {
  const data = object(value)
  return JSON.stringify(Object.hasOwn(data, 'stat_data') ? object(data.stat_data) : data)
}

export function parseChatImport(content: string): ChatImportDocument {
  const values = content.split(/\r?\n/).filter(line => line.trim()).map(line => object(JSON.parse(line)))
  const header = values.shift()
  if (!header || !Object.hasOwn(header, 'chat_metadata')) throw new Error('不支持此聊天记录格式。')
  const metadata = object(header.chat_metadata)
  const messages = values.map((value): ChatImportMessage => {
    if (typeof value.is_user !== 'boolean' || typeof value.mes !== 'string') throw new Error('聊天消息缺少正文或正式角色字段。')
    if (value.is_system === true) throw new Error('此聊天包含尚未支持的系统消息，原文件未修改。')
    let variableStateJson: string | undefined
    if (value.variables !== undefined) {
      const index = value.swipe_id ?? 0
      if (!Number.isSafeInteger(index) || Number(index) < 0 || !Array.isArray(value.variables)
        || !Object.hasOwn(value.variables, Number(index))) throw new Error('消息变量候选编号无效。')
      variableStateJson = state(value.variables[Number(index)])
    }
    return { role: value.is_user ? 'user' : 'assistant', content: value.mes,
      ...(variableStateJson === undefined ? {} : { variableStateJson }) }
  })
  return { messages, ...(Object.hasOwn(metadata, 'variables') ? { currentVariableStateJson: state(metadata.variables) } : {}) }
}
