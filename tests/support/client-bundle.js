import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
/** Resolve the package's declared browser Client bundle for VM-based browser tests. */
export function clientBundlePath(require, specifier) {
  const name = specifier.slice(0, -'/client'.length)
  const manifestPath = require.resolve(name + '/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const exported = manifest.exports['./client']
  const target = typeof exported === 'string' ? exported : exported.browser ?? exported.default
  if (typeof target !== 'string') throw new Error('Client browser export is not declared: ' + specifier)
  return resolve(dirname(manifestPath), target)
}
