import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageName = '@eleckoi/dsh-product-api'
const output = resolve(root, 'packages/dsh-product-api/lib')
const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
const artifacts = generator.generate([packageName], ['host'])

if (artifacts.length !== 1 || artifacts[0]?.face !== 'host') {
  throw new Error(`DSH Typert 未生成 ${packageName} 的唯一 Host 描述。`)
}

const [artifact] = artifacts
if (!artifact.remote) {
  throw new Error(`DSH Typert 未生成 ${packageName} 的 Remote Client 描述。`)
}

mkdirSync(output, { recursive: true })
// The Host entry is emitted by TypeScript at lib/types/index.js. Remove the
// former bundled entry so a stale implementation cannot shadow generated APIs.
rmSync(resolve(output, 'index.js'), { force: true })
rmSync(resolve(output, 'index.js.map'), { force: true })
writeFileSync(resolve(output, 'typert.host.js'), artifact.js)
writeFileSync(resolve(output, 'typert.host.d.ts'), artifact.dts)
writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
rmSync(resolve(output, 'typert.client.js'), { force: true })
rmSync(resolve(output, 'typert.client.d.ts'), { force: true })

console.log(`DSH Typert generated ${packageName}: Host and Remote Client artifacts.`)
