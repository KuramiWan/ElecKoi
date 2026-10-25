import { productFailure, ELECKOI_FAILURE_CODES } from '@eleckoi/dsh-product-api'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import { hasRegexEjsOutput, renderRegexEjs } from '@eleckoi/dsh-product-data/regex'

/** Evaluate the actual regex-projected request without writing to Session history. */
export async function renderRequestEjs(messages, { conversationId, variables = null }, signal) {
  const output = []
  for (const message of messages) {
    let changed = false
    const content = []
    for (const block of message.content) {
      if (!['text', 'reasoning'].includes(block.type) || !hasRegexEjsOutput(block.text)) { content.push(block); continue }
      const text = await renderRegexEjs({ content: block.text, rawContent: block.text, variables, surface: 'Prompt',
        message: { id: message.id, conversationId, role: message.role, status: 'complete', content: block.text },
        filename: `regex-prompt/${message.id}.ejs` }, signal)
      if (text === block.text) { content.push(block); continue }
      if (message.source.replayState !== undefined) throw productFailure(ELECKOI_FAILURE_CODES.inputUnsupported, '消息携带模型回放数据，不能用提示词 EJS 修改；请将该规则改为仅修改显示内容。', { what: '修改携带模型回放数据的提示词', expected: '仅修改显示内容' })
      changed = true; content.push({ ...block, text })
    }
    output.push(changed ? freezeMessage({ ...message, content }) : message)
  }
  return output
}
