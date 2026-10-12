import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createAndroidUpdateDescriptor } from '../scripts/android-runtime/create-update-descriptor.mjs'
const directories=[]
afterEach(() => { for (const root of directories.splice(0)) { const child=relative(tmpdir(),root); if(!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid temporary directory'); rmSync(root,{recursive:true,force:true}) } })
it('generates the notification descriptor from the exact Gradle APK metadata', () => {
  const root=mkdtempSync(join(tmpdir(),'eleckoi-update-')); directories.push(root)
  const metadata=join(root,'output-metadata.json'), output=join(root,'android-update.json')
  writeFileSync(join(root,'synthetic.apk'),'synthetic APK bytes')
  const value={applicationId:'com.eleckoi.app',elements:[{versionCode:9,versionName:'1.2.3',outputFile:'synthetic.apk'}]}
  writeFileSync(metadata,JSON.stringify(value))
  expect(createAndroidUpdateDescriptor(metadata,output)).toMatchObject({platform:'android',applicationId:'com.eleckoi.app',versionCode:9,versionName:'1.2.3',apkAsset:'synthetic.apk',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
  expect(JSON.parse(readFileSync(output,'utf8')).versionCode).toBe(9)
  for(const invalid of [{...value,applicationId:'com.example.other'},{...value,elements:[...value.elements,...value.elements]},{...value,elements:[{...value.elements[0],outputFile:'../synthetic.apk'}]}]) {
    writeFileSync(metadata,JSON.stringify(invalid)); expect(() => createAndroidUpdateDescriptor(metadata,output)).toThrow()
  }
})
