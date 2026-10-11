import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { scriptFilePathSchema, scriptLibrarySchema, type ScriptLibrary } from '@shared/contracts/scripts/schemas'

const fileSchema = z.strictObject({ path: scriptFilePathSchema, data: z.string() })
const MAX_FILES_BYTES = 48 * 1024 * 1024
export type PortableScriptLibrary = Pick<ScriptLibrary, 'trees' | 'variables' | 'enabled'> & {
  files?: Array<z.infer<typeof fileSchema>>
}

export function decodeScriptFiles(value: unknown): NonNullable<PortableScriptLibrary['files']> {
  const files = z.array(fileSchema).parse(value), paths = new Set<string>()
  let bytes = 0
  for (const file of files) {
    const key = process.platform === 'win32' ? file.path.toLowerCase() : file.path
    if (paths.has(key)) throw new Error(`脚本附件路径重复：${file.path}`)
    paths.add(key)
    const body = Buffer.from(file.data, 'base64')
    if (body.toString('base64') !== file.data) throw new Error(`脚本附件内容损坏：${file.path}`)
    bytes += body.byteLength
    if (bytes > MAX_FILES_BYTES) throw new Error('脚本附件总大小不能超过 48 MB。')
  }
  return files
}

export function decodeScriptLibrary(value: unknown): PortableScriptLibrary | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('脚本库配置必须是对象。')
  const helper = value as Record<string, unknown>
  if (helper.scripts === undefined && helper.variables === undefined) return undefined
  const scripts = helper.scripts === undefined ? [] : helper.scripts
  if (!Array.isArray(scripts)) throw new Error('脚本列表必须是数组。')
  function identity(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('脚本项目必须是对象。')
    const item = candidate as Record<string, unknown>
    return { ...item, id: item.id === undefined ? randomUUID() : item.id,
      ...(item.type === 'folder' && Array.isArray(item.scripts) ? { scripts: item.scripts.map(identity) } : {}),
    }
  }
  const input = { scope: 'global', ownerId: '', enabled: false, revision: 0,
    trees: scripts.map(identity), variables: helper.variables === undefined ? {} : helper.variables,
  }
  z.json().parse(input)
  const { trees, variables, enabled } = scriptLibrarySchema.parse(input)
  return { trees, variables, enabled }
}

export function decodePortableScriptLibrary(value: unknown): PortableScriptLibrary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('脚本库配置必须是对象。')
  const library = value as Record<string, unknown>
  if (!Array.isArray(library.trees)) throw new Error('脚本库缺少脚本列表。')
  return { ...decodeScriptLibrary({ scripts: library.trees, variables: library.variables })!,
    ...(library.files === undefined ? {} : { files: decodeScriptFiles(library.files) }) }
}
