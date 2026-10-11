import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const documentPath = 'docs/plugins/author-sdk.html'
const sourceBase = 'https://github.com/eleckoi/ElecKoi/blob/main/'
export const siteFiles = [
  documentPath,
  'docs/plugins/author-sdk-page.css',
  'docs/plugins/author-sdk-page.js',
  'apps/web/src/assets/eleckoi-app-icon.png',
  'packages/examples/native-author/example.character.json',
  'packages/examples/native-author/example.preset.json',
]

export function prepareAuthorDocsHtml(html) {
  const dom = new JSDOM(html)
  for (const link of dom.window.document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href')
    if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) continue
    const url = new URL(href, `https://docs.invalid/${documentPath}`)
    if (url.origin !== 'https://docs.invalid') throw new Error(`Unexpected documentation link: ${href}`)
    const file = decodeURIComponent(url.pathname.slice(1))
    if (siteFiles.includes(file)) continue
    link.setAttribute('href', `${sourceBase}${file}${url.search}${url.hash}`)
  }
  return dom.serialize()
}

export async function buildAuthorDocsSite(root = workspaceRoot) {
  const output = resolve(root, 'build', 'author-docs')
  if (relative(resolve(root), output) !== ['build', 'author-docs'].join(sep)) {
    throw new Error('Documentation output must stay in the workspace build directory')
  }
  for (const file of siteFiles) {
    if (isAbsolute(file) || file.split('/').includes('..')) throw new Error(`Invalid site file: ${file}`)
    await readFile(resolve(root, file))
  }
  await rm(output, { recursive: true, force: true })
  for (const file of siteFiles) {
    const destination = resolve(output, file)
    await mkdir(dirname(destination), { recursive: true })
    if (file === documentPath) {
      await writeFile(destination, prepareAuthorDocsHtml(await readFile(resolve(root, file), 'utf8')))
    } else {
      await copyFile(resolve(root, file), destination)
    }
  }
  await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>ElecKoi 作者 SDK</title>
<meta http-equiv="refresh" content="0;url=${documentPath}"></head>
<body><a href="${documentPath}">ElecKoi 作者 SDK</a></body></html>
`)
  await writeFile(resolve(output, '.nojekyll'), '')
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Author SDK site: ${await buildAuthorDocsSite()}`)
}
