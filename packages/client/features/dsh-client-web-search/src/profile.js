import { productFailure, ELECKOI_FAILURE_CODES } from '@eleckoi/dsh-product-api'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/**
 * Retire the removed provider's saved selections before the Loader mounts.
 * RETIRE WHEN: 受支持的 profile 均不再引用 eleckoi-deepseek-api 后，
 * 删除此函数、启动调用和旧选择升级用例；保留用户原有凭据及未使用的配置。
 */
export async function retireDeepSeekExtensionSelection(profileDirectory) {
  await withFileLock(join(profileDirectory, 'package.json'), async () => {
    const path = join(profileDirectory, 'cordis.patch.yml')
    let text
    try { text = await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
    if (document.errors[0]) throw document.errors[0]
    if (!isSeq(document.contents)) throw productFailure(ELECKOI_FAILURE_CODES.dataShapeInvalid, 'Profile patch must be a YAML sequence', { what: 'Profile patch' })
    let changed = false
    for (const row of document.contents.items) {
      if (!isMap(row) || row.get('id') !== 'web') continue
      for (const [key, provider] of [['searchProvider', 'deepseek-search-api'], ['fetchProvider', 'deepseek-fetch-api']]) {
        if (row.getIn(['config', key]) !== 'eleckoi-deepseek-api') continue
        row.setIn(['config', key], provider)
        changed = true
      }
    }
    if (changed) await writeFileAtomic(path, String(document), { mode: 0o600 })
  })
}
