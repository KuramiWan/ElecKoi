import { z } from 'zod'

export const displayTemplateScopeSchema = z.enum(['global', 'character', 'preset'])
export const displayTemplateSchema = z.strictObject({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  position: z.enum(['before', 'after', 'replace']),
  pattern: z.string().max(4000),
  flags: z.string().max(8),
  source: z.string().max(512_000),
}).superRefine((template, context) => {
  if (template.position !== 'replace') return
  try {
    if (!template.pattern) throw new Error('替换模式需要匹配表达式。')
    new RegExp(template.pattern, template.flags)
  } catch (error) {
    context.addIssue({ code: 'custom', path: ['pattern'], message: error instanceof Error ? error.message : '匹配表达式无效。' })
  }
})

export const displayTemplateLibrarySchema = z.strictObject({
  scope: displayTemplateScopeSchema,
  ownerId: z.string(),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  templates: z.array(displayTemplateSchema).max(100),
}).superRefine((library, context) => {
  if (library.scope === 'global' ? library.ownerId !== '' : library.ownerId.length === 0) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: '全局模板使用空归属编号，角色及预设模板必须提供编号。' })
  }
  const ids = new Set<string>(), names = new Set<string>()
  library.templates.forEach((template, index) => {
    if (ids.has(template.id)) context.addIssue({ code: 'custom', path: ['templates', index, 'id'], message: '模板编号重复。' })
    if (names.has(template.name)) context.addIssue({ code: 'custom', path: ['templates', index, 'name'], message: '模板名称重复。' })
    ids.add(template.id); names.add(template.name)
  })
})

export type DisplayTemplate = z.output<typeof displayTemplateSchema>
export type DisplayTemplateScope = z.output<typeof displayTemplateScopeSchema>
export type DisplayTemplateLibrary = z.output<typeof displayTemplateLibrarySchema>
export interface DisplayTemplateSelection { characterId: string; libraries: DisplayTemplateLibrary[] }
export type PortableDisplayTemplates = Pick<DisplayTemplateLibrary, 'enabled' | 'templates'>

export function decodePortableDisplayTemplates(value: unknown): PortableDisplayTemplates {
  const portable = z.strictObject({ enabled: z.boolean(), templates: z.array(displayTemplateSchema).max(100) }).parse(value)
  const { enabled, templates } = displayTemplateLibrarySchema.parse({ ...portable, scope: 'character', ownerId: 'import', revision: 0 })
  return { enabled, templates }
}
