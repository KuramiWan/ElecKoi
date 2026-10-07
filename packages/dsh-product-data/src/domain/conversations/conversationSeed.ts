import type { OpeningMessageOption } from '@shared/contracts/entities/chat'
import type { ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import type { SettingLibraryEntry } from '@shared/contracts/settingLibrary/schemas'
import type { VariableConfig } from '@shared/contracts/variables/schemas'

interface ConversationSettingLibraryReader {
  get(characterId: string, database: ElecKoiDatabase): { entries: SettingLibraryEntry[] }
}

interface ConversationVariableConfigReader {
  get(characterId: string, database: ElecKoiDatabase): VariableConfig
}

export interface ConversationSeed {
  variableVersionId?: string
  initialVariableStateJson: string
  openingText: string
  openingOptions: OpeningMessageOption[]
  selectedOpeningId: string
}

export function resolveConversationSeed(
  characterId: string,
  database: ElecKoiDatabase,
  settingLibraries: ConversationSettingLibraryReader,
  variables: ConversationVariableConfigReader
): ConversationSeed {
  const config = variables.get(characterId, database)
  const entry = settingLibraries.get(characterId, database).entries.find((candidate) => (
    candidate.enabled && (candidate.id === 'fixed-opening-assistant' || candidate.kind === 'opening')
  ))
  const opening = entry?.openingMessages.find((candidate) => candidate.id === entry.defaultOpeningMessageId)
    ?? entry?.openingMessages[0]

  const openingOptions = (entry?.openingMessages ?? []).map((candidate) => {
    const versionId = candidate.variableVersionId || config.activeVersionId
    const version = config.versions.find((item) => item.id === versionId)
    if (!version) throw new Error(`开场白“${candidate.title || '未命名开场白'}”绑定的变量版本不存在。`)
    return {
      id: candidate.id, title: candidate.title, content: candidate.content,
      variableVersionId: versionId,
      initialVariableStateJson: candidate.variableVersionId
        ? version.initialStateJson
        : candidate.initialVariableStateJson.trim() || version.initialStateJson
    }
  })
  const selected = openingOptions.find((candidate) => candidate.id === opening?.id)
  return {
    variableVersionId: selected?.variableVersionId || config.activeVersionId,
    initialVariableStateJson: selected?.initialVariableStateJson || config.initialStateJson,
    openingText: opening?.content.trim() || '',
    openingOptions,
    selectedOpeningId: opening?.id ?? ''
  }
}
