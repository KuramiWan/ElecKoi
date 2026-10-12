import { constants } from 'node:fs'
import { copyFile, open, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { publishAndroidFile } from './android-file-publication.mjs'

/** The native shell provisions this directory before starting the Host. */
export function androidAttachmentBoundary(home) {
  const root = process.env.ELECKOI_RUNTIME_ROOT
  if (!root || !isAbsolute(root)) throw new Error('Android attachment storage requires its provisioned runtime root')
  const boundary = resolve(root)
  const child = relative(boundary, resolve(home))
  if (!child || child === '..' || child.startsWith('../') || isAbsolute(child)) {
    throw new Error('Android attachment home must be inside its provisioned runtime root')
  }
  return boundary
}

/** Preserve the immutable object while publishing an independent, synced alias. */
export async function publishAndroidAlias(source, target) {
  const temporary = join(dirname(target), `.attachment-${randomUUID()}`)
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL)
    const handle = await open(temporary, constants.O_RDONLY)
    try { await handle.sync() } finally { await handle.close() }
    publishAndroidFile(temporary, target)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
