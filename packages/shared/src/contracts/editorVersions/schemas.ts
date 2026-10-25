import { z } from 'zod'
import { scriptFilePathSchema, scriptTreeSchema, scriptLibrarySchema } from '../scripts/schemas'
import { regexRuleSchema } from '../regex/schemas'

export const editorLibraryKindSchema = z.enum(['scripts', 'regex'])
export const editorLibraryAddressSchema = z.strictObject({
  kind: editorLibraryKindSchema,
  scope: z.enum(['global', 'character', 'preset']),
  ownerId: z.string(),
}).superRefine((value, context) => {
  if (value.scope === 'global' ? value.ownerId !== '' : !value.ownerId) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: '配置版本归属与作用域不匹配。' })
  }
})

export const editorLibraryVersionsSchema = z.strictObject({
  kind: editorLibraryKindSchema,
  scope: z.enum(['global', 'character', 'preset']),
  ownerId: z.string(),
  revision: z.number().int().nonnegative(),
  resourceRevision: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  activeVersionId: z.string().min(1),
  versions: z.array(z.strictObject({ id: z.string().min(1), name: z.string().trim().min(1), content: z.string() })).min(1),
}).superRefine((library, context) => {
  const address = editorLibraryAddressSchema.safeParse({ kind: library.kind, scope: library.scope, ownerId: library.ownerId })
  if (!address.success) context.addIssue({ code: 'custom', path: ['ownerId'], message: '配置版本归属与作用域不匹配。' })
  if (library.kind === 'scripts' ? !library.resourceRevision : library.resourceRevision !== '') context.addIssue({ code: 'custom', path: ['resourceRevision'], message: '源码资源版本与配置类型不匹配。' })
  const ids = new Set<string>(), names = new Set<string>()
  library.versions.forEach((version, index) => {
    if (ids.has(version.id) || names.has(version.name)) context.addIssue({ code: 'custom', path: ['versions', index], message: '版本编号和名称必须唯一。' })
    ids.add(version.id); names.add(version.name)
    try { decodeEditorVersionContent(library.kind, version.content) }
    catch (error) { context.addIssue({ code: 'custom', path: ['versions', index, 'content'], message: error instanceof Error ? error.message : '版本内容无效。' }) }
  })
  if (!ids.has(library.activeVersionId)) context.addIssue({ code: 'custom', path: ['activeVersionId'], message: '当前版本不存在。' })
})

export const scriptVersionContentSchema = z.strictObject({
  enabled: z.boolean(), trees: z.array(scriptTreeSchema), variables: z.record(z.string(), z.json()),
  files: z.array(z.strictObject({ path: scriptFilePathSchema, data: z.string() })),
}).superRefine((content, context) => {
  const result = scriptLibrarySchema.safeParse({ enabled: content.enabled, trees: content.trees, variables: content.variables, scope: 'global', ownerId: '', revision: 0 })
  if (!result.success) result.error.issues.forEach(issue => context.addIssue({ code: 'custom', path: issue.path, message: issue.message }))
})
export const regexVersionContentSchema = z.strictObject({ enabled: z.boolean().default(true), rules: z.array(regexRuleSchema) }).superRefine((content, context) => {
  const ids = new Set<string>()
  for (const rule of content.rules) {
    if (ids.has(rule.id)) context.addIssue({ code: 'custom', path: ['rules'], message: '正则规则编号重复。' })
    ids.add(rule.id)
  }
})

export function decodeEditorVersionContent(kind: EditorLibraryKind, content: string) {
  const input: unknown = JSON.parse(content)
  if (kind === 'scripts') return scriptVersionContentSchema.parse(input)
  return regexVersionContentSchema.parse(input)
}

export const editorLibrarySaveRequestSchema = z.strictObject({
  kind: editorLibraryKindSchema, documents: z.array(z.string()).min(1), versions: z.array(editorLibraryVersionsSchema),
})
export type EditorLibraryKind = z.output<typeof editorLibraryKindSchema>
export type EditorLibraryAddress = z.output<typeof editorLibraryAddressSchema>
export type EditorLibraryVersions = z.output<typeof editorLibraryVersionsSchema>
export type EditorLibrarySaveRequest = z.output<typeof editorLibrarySaveRequestSchema>
export interface EditorLibrarySaveResult { documents: string[]; versions: EditorLibraryVersions[] }
