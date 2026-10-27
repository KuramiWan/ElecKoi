import { z } from 'zod'

export const characterOpeningMessageSchema = z.object({
  id: z.string().min(1), title: z.string(), content: z.string(),
  variableVersionId: z.string().optional(), initialVariableStateJson: z.string()
}).strict()

export const characterOpeningVersionSchema = z.object({
  id: z.string().min(1), name: z.string(), enabled: z.boolean(),
  openingMessages: z.array(characterOpeningMessageSchema).min(1),
  defaultOpeningMessageId: z.string().min(1), createdAt: z.string(), updatedAt: z.string()
}).strict().superRefine((value, ctx) => {
  if (new Set(value.openingMessages.map(message => message.id)).size !== value.openingMessages.length) {
    ctx.addIssue({ code: 'custom', message: '开场白编号不能重复。', path: ['openingMessages'] })
  }
  if (!value.openingMessages.some(message => message.id === value.defaultOpeningMessageId)) {
    ctx.addIssue({ code: 'custom', message: '主开场白编号必须存在。', path: ['defaultOpeningMessageId'] })
  }
})

export const characterOpeningsSchema = z.object({
  characterId: z.string().min(1), activeVersionId: z.string().min(1),
  name: z.string(), enabled: z.boolean(), openingMessages: z.array(characterOpeningMessageSchema).min(1),
  defaultOpeningMessageId: z.string().min(1), versions: z.array(characterOpeningVersionSchema).min(1)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.versions.map(version => version.id)).size !== value.versions.length) {
    ctx.addIssue({ code: 'custom', message: '开场白版本编号不能重复。', path: ['versions'] })
  }
  if (!value.versions.some(version => version.id === value.activeVersionId)) {
    ctx.addIssue({ code: 'custom', message: '选中的开场白版本不存在。', path: ['activeVersionId'] })
  }
  const active = characterOpeningVersionSchema.safeParse({ id: value.activeVersionId, name: value.name,
    enabled: value.enabled, openingMessages: value.openingMessages, defaultOpeningMessageId: value.defaultOpeningMessageId,
    createdAt: '', updatedAt: '' })
  if (!active.success) for (const issue of active.error.issues) ctx.addIssue({ ...issue, path: issue.path })
})

export type CharacterOpeningMessage = z.output<typeof characterOpeningMessageSchema>
export type CharacterOpeningVersion = z.output<typeof characterOpeningVersionSchema>
export type CharacterOpenings = z.output<typeof characterOpeningsSchema>

export function syncCharacterOpeningVersion(input: CharacterOpenings): CharacterOpenings {
  const value = characterOpeningsSchema.parse(input)
  return { ...value, versions: value.versions.map(version => version.id === value.activeVersionId ? {
    ...version, name: value.name, enabled: value.enabled, openingMessages: value.openingMessages,
    defaultOpeningMessageId: value.defaultOpeningMessageId
  } : version) }
}

export function createCharacterOpenings(characterId: string, content = '', enabled = true): CharacterOpenings {
  const timestamp = new Date().toISOString()
  const version: CharacterOpeningVersion = { id: 'openings-default', name: '默认版本', enabled,
    openingMessages: [{ id: 'opening-default', title: '默认开场', content, initialVariableStateJson: '' }],
    defaultOpeningMessageId: 'opening-default', createdAt: timestamp, updatedAt: timestamp }
  return { characterId, activeVersionId: version.id, name: version.name, enabled,
    openingMessages: version.openingMessages, defaultOpeningMessageId: version.defaultOpeningMessageId, versions: [version] }
}
