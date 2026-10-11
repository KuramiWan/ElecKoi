import type { AuthorScriptFrame, AuthorScriptProgram } from '@eleckoi/author-sdk'

export type AuthorBrowserWindow = Window & typeof globalThis

/** A browser realm owns native module evaluation and its import cache. */
export function createAuthorScriptFrame(view: AuthorBrowserWindow, entryUrl: string): AuthorScriptFrame {
  const entry = new view.URL(entryUrl, view.location.href)
  if (entry.origin !== view.location.origin || !entry.pathname.startsWith('/eleckoi/scripts/')) throw new Error('Invalid native script entry URL')
  const node = view.document.createElement('iframe')
  node.hidden = true; node.title = 'ElecKoi author script'
  view.document.body.appendChild(node)
  const target = node.contentWindow as AuthorBrowserWindow | null
  if (!target) { node.remove(); throw new Error('Cannot create an author script frame') }
  let disposed = false
  return {
    window: target,
    load(_source, signal) {
      signal.throwIfAborted()
      if (disposed) throw new Error('Author script frame is closed')
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
          else reject(new Error(result.message))
        }
        const cancelled = () => { finish(); reject(signal.reason) }
        target.addEventListener(type, loaded)
        signal.addEventListener('abort', cancelled, { once: true })
        script.type = 'module'
        script.textContent = `import(${JSON.stringify(entry.href)}).then(module => dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {detail:{ok:true,program:module.default}})), error => dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {detail:{ok:false,message:error.message||String(error)}})));`
        script.onerror = () => { finish(); reject(new Error('Author module could not be loaded')) }
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
