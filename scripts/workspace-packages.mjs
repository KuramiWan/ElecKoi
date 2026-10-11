import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Discover package owners beneath responsibility groups, stopping at each manifest. */
export function readWorkspacePackages(root) {
  const packages = []
  function visit(directory) {
    const packagePath = join(directory, 'package.json')
    if (existsSync(packagePath)) {
      const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (typeof manifest.name !== 'string' || !manifest.name) {
        throw new Error(`工作区包缺少名称：${relative(root, packagePath)}`)
      }
      packages.push({ manifest, packagePath, directory: relative(root, directory).replaceAll('\\', '/') })
      return
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'lib', 'out'].includes(entry.name)) {
        visit(join(directory, entry.name))
      }
    }
  }
  visit(join(root, 'packages'))
  return packages.sort((left, right) => left.directory.localeCompare(right.directory, 'en'))
}
