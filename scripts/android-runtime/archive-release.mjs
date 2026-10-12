import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const artifacts = ['standard', 'compat'].map(variant => {
  const directory = resolve(repo, `apps/android/app/build/outputs/apk/${variant}/release`)
  const metadata = JSON.parse(readFileSync(resolve(directory, 'output-metadata.json'), 'utf8'))
  if (metadata.variantName !== `${variant}Release` || metadata.applicationId !== 'com.eleckoi.app'
      || metadata.elements?.length !== 1) throw new Error(`Invalid ${variant} Release metadata`)
  const artifact = metadata.elements[0]
  if (!/^\d+\.\d+\.\d+$/.test(artifact.versionName) || !Number.isSafeInteger(artifact.versionCode)) throw new Error('Invalid release version')
  const source = resolve(directory, artifact.outputFile)
  if (dirname(source) !== directory || !source.endsWith('.apk')) throw new Error('APK path escapes Release output')
  const descriptorName = variant === 'standard' ? 'android-update.json' : 'android-update-compat.json'
  const descriptor = JSON.parse(readFileSync(resolve(directory, descriptorName), 'utf8'))
  const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
  if (descriptor.variant !== variant || descriptor.applicationId !== metadata.applicationId
      || descriptor.versionName !== artifact.versionName || descriptor.versionCode !== artifact.versionCode
      || descriptor.apkAsset !== artifact.outputFile || descriptor.sha256 !== sha256) throw new Error('Release descriptor differs from actual APK')
  return { variant, descriptorName, descriptor, source, bytes: statSync(source).size }
})
if (artifacts.some(row => row.descriptor.versionName !== artifacts[0].descriptor.versionName
    || row.descriptor.versionCode !== artifacts[0].descriptor.versionCode)) throw new Error('Android variants must share a release version')
const output = resolve(process.argv[2] || resolve(repo, `build/releases/android-${artifacts[0].descriptor.versionName}-dual`))
mkdirSync(output, { recursive: true })
for (const artifact of artifacts) {
  const apkAsset = `ElecKoi-${artifact.descriptor.versionName}-android-arm64-${artifact.variant}.apk`
  copyFileSync(artifact.source, resolve(output, apkAsset))
  writeFileSync(resolve(output, artifact.descriptorName), JSON.stringify({ ...artifact.descriptor, apkAsset }, null, 2) + '\n')
  process.stdout.write(`${apkAsset}: ${artifact.bytes} bytes\n`)
}
process.stdout.write(`Android release artifacts archived: ${output}\n`)
