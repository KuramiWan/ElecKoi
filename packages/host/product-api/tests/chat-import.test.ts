import { expect, it } from 'vitest'
import { parseChatImport } from '../lib/types/chatImport.js'

it('converts selected message variables and chat variables without applying author rules', () => {
  const input = [
    { chat_metadata: { variables: { score: 9 } } },
    { is_user: false, mes: 'Synthetic opening', variables: [{ stat_data: { score: 1 } }] },
    { is_user: true, mes: 'Synthetic input' },
    { is_user: false, mes: 'Synthetic reply', swipe_id: 1, variables: [{ stat_data: { score: 2 } }, { stat_data: { score: 7 } }] },
  ].map(value => JSON.stringify(value)).join('\n')
  expect(parseChatImport(input)).toEqual({ currentVariableStateJson: '{"score":9}', messages: [
    { role: 'assistant', content: 'Synthetic opening', variableStateJson: '{"score":1}' },
    { role: 'user', content: 'Synthetic input' },
    { role: 'assistant', content: 'Synthetic reply', variableStateJson: '{"score":7}' },
  ] })
})

it('does not silently substitute an invalid variable candidate', () => {
  expect(() => parseChatImport('{"chat_metadata":{}}\n{"is_user":false,"mes":"Synthetic reply","variables":[{}],"swipe_id":4}'))
    .toThrow('候选编号')
  expect(() => parseChatImport('{"chat_metadata":{"variables":null}}')).toThrow('JSON 对象')
})
