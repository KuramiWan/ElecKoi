import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Build Android update metadata from the exact APK output owned by Gradle. */
export function createAndroidUpdateDescriptor(metadataPath, outputPath, variant) {
  const path = resolve(metadataPath), metadata = JSON.parse(readFileSync(path, 'utf8'))
  if (!['standard', 'compat'].includes(variant) || metadata.variantName !== `${variant}Release`) throw new Error('Android browser variant does not match release Gradle metadata')
  if (metadata.applicationId !== 'com.eleckoi.app') throw new Error('Android update application ID does not match com.eleckoi.app')
  if (!Array.isArray(metadata.elements) || metadata.elements.length !== 1) throw new Error('Expected one APK output for Android updates')
  const artifact = metadata.elements[0]
  if (!Number.isSafeInteger(artifact.versionCode) || artifact.versionCode < 1 || artifact.versionCode > 2100000000
    || typeof artifact.versionName !== 'string' || !artifact.versionName.trim()) throw new Error('Invalid APK version metadata')
  if (typeof artifact.outputFile !== 'string' || !artifact.outputFile.endsWith('.apk')) throw new Error('Missing exact APK output file')
  const apk = resolve(dirname(path), artifact.outputFile), child = relative(dirname(path), apk)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('APK output escapes the Gradle output directory')
  if (statSync(apk).size === 0) throw new Error('APK output is empty')
  const descriptor = { schemaVersion: 1, platform: 'android', variant, applicationId: metadata.applicationId,
    versionCode: artifact.versionCode, versionName: artifact.versionName, apkAsset: artifact.outputFile,
    sha256: createHash('sha256').update(readFileSync(apk)).digest('hex') }
  writeFileSync(outputPath, JSON.stringify(descriptor, null, 2) + '\n')
  return descriptor
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) throw new Error('Usage: create-update-descriptor.mjs <output-metadata.json> <android-update.json> <standard|compat>')
  const descriptor = createAndroidUpdateDescriptor(process.argv[2], process.argv[3], process.argv[4])
  process.stdout.write(`Android update descriptor created: ${descriptor.applicationId} ${descriptor.versionName} (${descriptor.versionCode})\n`)
}
