import type { AuthorScriptFrame, AuthorScriptProgram } from '@eleckoi/author-sdk'
import { productFailure, ELECKOI_FAILURE_CODES } from '@eleckoi/dsh-product-api'

export type AuthorBrowserWindow = Window & typeof globalThis

/** A browser realm owns native module evaluation and its import cache. */
export function createAuthorScriptFrame(view: AuthorBrowserWindow, entryUrl: string): AuthorScriptFrame {
  const entry = new view.URL(entryUrl, view.location.href)
  if (entry.origin !== view.location.origin || !entry.pathname.startsWith('/eleckoi/scripts/')) throw productFailure(ELECKOI_FAILURE_CODES.securityDenied, 'Invalid native script entry URL', { what: '原生脚本入口地址', guard: 'same-origin' })
  const node = view.document.createElement('iframe')
  node.hidden = true; node.title = 'ElecKoi author script'
  view.document.body.appendChild(node)
  const target = node.contentWindow as AuthorBrowserWindow | null
  if (!target) { node.remove(); throw productFailure(ELECKOI_FAILURE_CODES.internal, 'Cannot create an author script frame', { what: '创建作者脚本 iframe' }) }
  let disposed = false
  return {
    window: target,
    load(_source, signal) {
      signal.throwIfAborted()
      if (disposed) throw productFailure(ELECKOI_FAILURE_CODES.lifecycleDisposed, 'Author script frame is closed', { what: '作者脚本 frame' })
      return new Promise<AuthorScriptProgram>((resolve, reject) => {
        const type = 'eleckoi:module-' + view.crypto.randomUUID()
        const script = target.document.createElement('script')
        const finish = () => {
          target.removeEventListener(type, loaded); signal.removeEventListener('abort', cancelled)
          script.remove()
        }
        const loaded = (event: Event) => {
          const result = (event as CustomEvent).detail
          finish()
          if (result.ok) resolve(result.program)
          // 作者脚本自己的 import 错误：码表里没有"脚本失败"的码，兜底码不写 what，
          // 让脚本那句诊断原样到用户眼前。
          else reject(productFailure(ELECKOI_FAILURE_CODES.internal, result.message))
        }
        const cancelled = () => { finish(); reject(signal.reason) }
        target.addEventListener(type, loaded)
        signal.addEventListener('abort', cancelled, { once: true })
        script.type = 'module'
        script.textContent = `import(${JSON.stringify(entry.href)}).then(module => dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {detail:{ok:true,program:module.default}})), error => dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {detail:{ok:false,message:error.message||String(error)}})));`
        script.onerror = () => { finish(); reject(productFailure(ELECKOI_FAILURE_CODES.internal, 'Author module could not be loaded')) }
        target.document.head.appendChild(script)
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      target.dispatchEvent(new target.Event('pagehide'))
      node.remove()
    }
  }
}
