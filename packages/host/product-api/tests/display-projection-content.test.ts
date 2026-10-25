import { expect, it, vi } from 'vitest'
import { ElecKoiConversationsApi } from '../lib/types/index.js'

it('forwards all display messages and complete content beyond the former count and total-text ceilings', () => {
  const text = 'Synthetic display content '.repeat(1001) + 'tail-marker'
  const messages = Array.from({ length: 1001 }, (_, index) => ({ id: `synthetic-display-${index}`, role: 'assistant' as const,
    content: `${index}:${text}`, variableStateJson: '{}', status: 'complete' as const, createdAt: '2026-10-25',
    reasoning: [{ id: `synthetic-reasoning-${index}`, text }],
  }))
  const project = vi.fn((_id: string, input: typeof messages) => input.map(message => ({ id: message.id, displayContent: message.content })))
  const result = Reflect.apply(ElecKoiConversationsApi.prototype.projectDisplay,
    { productData: { projectConversationMessages: project } }, ['synthetic-display-conversation', messages])
  expect(project).toHaveBeenCalledExactlyOnceWith('synthetic-display-conversation', messages)
  expect(result).toHaveLength(1001)
  for (const index of [0, 500, 1000]) expect(result[index]?.displayContent).toBe(messages[index]!.content)
})
