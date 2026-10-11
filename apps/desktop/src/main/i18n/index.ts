const mainMessages = {
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  missingConversation: '找不到这个对话。',
  activeTurnConflict: '这个对话仍有回复正在生成。'
} as const

export function t(key: keyof typeof mainMessages): string {
  return mainMessages[key]
}
