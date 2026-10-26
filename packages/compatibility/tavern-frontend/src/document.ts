import { FrontendCompatibilityError } from './common'
import { installTavernFrontend, type FrontendCompatibilityController } from './index'
import type { ElecKoiAuthorApi } from '@eleckoi/author-sdk'

const scriptType = 'application/eleckoi-frontend-script'

/** Parse HTML as HTML; script contents and application/json blocks are left intact. */
export function prepareFrontendCompatibilitySource(source: string, parser = new DOMParser()): string {
  const document = parser.parseFromString(source, 'text/html')
  for (const script of document.querySelectorAll('script')) {
    const type = (script.getAttribute('type') || '').trim().toLowerCase()
    if (type && type !== 'module' && !/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type)) continue
    script.setAttribute('data-eleckoi-original-type', script.getAttribute('type') || '')
    script.type = scriptType
  }
  return '<!doctype html>' + document.documentElement.outerHTML
}

/** Release executable scripts only after the SDK-backed compatibility snapshot is ready. */
export async function activateFrontendCompatibilityScripts(page: Window, active: () => boolean): Promise<void> {
  const deferred: HTMLScriptElement[] = [], asynchronous: Promise<void>[] = []
  const execute = (inert: HTMLScriptElement): Promise<void> => {
    if (!active()) return Promise.reject(new FrontendCompatibilityError('FRAME_CLOSED', '前端页面已关闭。'))
    const script = page.document.createElement('script')
    for (const attribute of inert.attributes) if (!['type', 'data-eleckoi-original-type'].includes(attribute.name)) script.setAttribute(attribute.name, attribute.value)
    const type = inert.getAttribute('data-eleckoi-original-type') || ''
    if (type) script.type = type
    script.textContent = inert.textContent
    if (script.noModule && 'noModule' in script) { inert.remove(); return Promise.resolve() }
    const result = script.src || type.trim().toLowerCase() === 'module' ? new Promise<void>((resolve, reject) => {
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`前端脚本加载失败：${script.src || 'inline module'}`))
    }) : Promise.resolve()
    inert.replaceWith(script)
    return result
  }
  for (const inert of page.document.querySelectorAll<HTMLScriptElement>(`script[type="${scriptType}"][data-eleckoi-original-type]`)) {
    if (!active()) return
    const module = inert.getAttribute('data-eleckoi-original-type')?.trim().toLowerCase() === 'module'
    if (inert.hasAttribute('async') && (inert.src || module)) asynchronous.push(execute(inert))
    else if (module || inert.src && inert.hasAttribute('defer')) deferred.push(inert)
    else await execute(inert)
  }
  for (const script of deferred) await execute(script)
  if (active()) page.document.dispatchEvent(new (page as Window & typeof globalThis).Event('DOMContentLoaded', { bubbles: true }))
  await Promise.all(asynchronous)
  if (active()) {
    page.dispatchEvent(new (page as Window & typeof globalThis).Event('load'))
    page.dispatchEvent(new (page as Window & typeof globalThis).Event('eleckoi:frontend-scripts-ready'))
  }
}

export function mountFrontendCompatibility(page: Window & { ElecKoi?: ElecKoiAuthorApi }, mountSdk: (() => () => void) | undefined,
  report: (error: unknown) => void): { ready: Promise<void>; dispose(): void } {
  let active = true, compatibility: FrontendCompatibilityController | undefined
  const release = mountSdk?.()
  const dispose = () => {
    if (!active) return
    active = false; page.removeEventListener('pagehide', dispose)
    compatibility?.dispose(); release?.()
  }
  page.addEventListener('pagehide', dispose, { once: true })
  const ready = (async () => {
    if (mountSdk) {
      if (!page.ElecKoi) throw new Error('前端兼容需要已安装的 ElecKoi SDK。')
      compatibility = await installTavernFrontend(page, page.ElecKoi, { report, active: () => active })
      if (!active) { compatibility.dispose(); return }
    }
    await activateFrontendCompatibilityScripts(page, () => active)
  })().catch(error => { dispose(); throw error })
  return { ready, dispose }
}
