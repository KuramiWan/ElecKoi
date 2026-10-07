import { describe, expect, it } from 'vitest'
import { resolveConversationSeed } from '../packages/dsh-product-data/src/domain/conversations/conversationSeed'

describe('conversation opening seed', () => {
  it('uses the saved primary setting-library opening', () => {
    const settingLibraries = {
      get: () => ({
        entries: [{
          id: 'fixed-opening-assistant',
          kind: 'opening',
          enabled: true,
          defaultOpeningMessageId: 'primary',
          openingMessages: [
            { id: 'backup', title: '备用', content: '备用开场', initialVariableStateJson: '' },
            { id: 'primary', title: '主开场', content: '主开场', initialVariableStateJson: '{"好感":10}' }
          ]
        }]
      })
    }
    const variables = { get: () => ({ activeVersionId: 'version-a', initialStateJson: '{"好感":0}', versions: [{ id: 'version-a', initialStateJson: '{"好感":0}' }] }) }

    expect(resolveConversationSeed(
      'card-a', {} as never, settingLibraries as never, variables as never
    )).toEqual({
      variableVersionId: 'version-a',
      initialVariableStateJson: '{"好感":10}',
      openingText: '主开场',
      openingOptions: [
        { id: 'backup', title: '备用', content: '备用开场', variableVersionId: 'version-a', initialVariableStateJson: '{"好感":0}' },
        { id: 'primary', title: '主开场', content: '主开场', variableVersionId: 'version-a', initialVariableStateJson: '{"好感":10}' },
      ],
      selectedOpeningId: 'primary',
    })
  })

  it('does not fall back to the obsolete persona opening field', () => {
    const settingLibraries = { get: () => ({ entries: [] }) }
    const variables = { get: () => ({ activeVersionId: 'version-a', initialStateJson: '{}', versions: [{ id: 'version-a', initialStateJson: '{}' }] }) }

    expect(resolveConversationSeed(
      'card-a',
      {} as never,
      settingLibraries as never,
      variables as never
    )).toEqual({ variableVersionId: 'version-a', initialVariableStateJson: '{}', openingText: '', openingOptions: [], selectedOpeningId: '' })
  })
})
