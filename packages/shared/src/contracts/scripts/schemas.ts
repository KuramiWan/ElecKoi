import { z } from 'zod'

export const scriptLibraryScopeSchema = z.enum(['global', 'character', 'preset'])
export const scriptFilePathSchema = z.string().min(1).refine(name => !/[\\:\0]/.test(name)
  && !name.split('/').some(part => !part || part === '.' || part === '..'), '脚本文件路径无效。')
const jsonObjectSchema = z.record(z.string(), z.json())
export const scriptSchema = z.looseObject({
  type: z.literal('script'),
  id: z.string().min(1),
  name: z.string().default(''),
  enabled: z.boolean().default(false),
  content: z.string(),
  info: z.string().default(''),
  data: jsonObjectSchema.default({}),
  button: z.looseObject({ enabled: z.boolean().default(true),
    buttons: z.array(z.looseObject({ name: z.string(), visible: z.boolean().default(true) }).catchall(z.json())).default([]),
  }).catchall(z.json()).prefault({}),
  export_with: z.looseObject({ data: z.boolean().default(true), button: z.boolean().default(true) }).catchall(z.json()).prefault({}),
}).catchall(z.json())
export const scriptFolderSchema = z.looseObject({
  type: z.literal('folder'), id: z.string().min(1), name: z.string().default(''),
  enabled: z.boolean().default(false), icon: z.string().default(''), color: z.string().default(''),
  scripts: z.array(scriptSchema),
}).catchall(z.json())
export const scriptTreeSchema = z.discriminatedUnion('type', [scriptSchema, scriptFolderSchema])
export const scriptLibrarySchema = z.strictObject({
  scope: scriptLibraryScopeSchema,
  ownerId: z.string(),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  trees: z.array(scriptTreeSchema),
  variables: jsonObjectSchema,
}).superRefine((library, context) => {
  if (library.scope === 'global' ? library.ownerId !== '' : !library.ownerId) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: '脚本库归属编号与作用域不匹配。' })
  }
  const ids = new Set<string>()
  for (const tree of library.trees) for (const item of tree.type === 'folder' ? [tree, ...tree.scripts] : [tree]) {
    if (ids.has(item.id)) context.addIssue({ code: 'custom', path: ['trees'], message: '脚本或文件夹编号重复。' })
    ids.add(item.id)
  }
})
export type ScriptLibraryScope = z.infer<typeof scriptLibraryScopeSchema>
export type ScriptLibrary = z.infer<typeof scriptLibrarySchema>
export type ScriptTree = z.infer<typeof scriptTreeSchema>
