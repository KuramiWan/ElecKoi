import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** Inspect the actual app WebView; a separate HTTP cookie jar cannot prove Client startup. */
export async function inspectDeviceWebView(adb, state) {
  const origin = new URL(state.url).origin
  let port, socket
  const pending = new Map()
  try {
    port = await adb(['forward', 'tcp:0', `localabstract:webview_devtools_remote_${state.androidPid}`])
    assert.match(port, /^[1-9][0-9]*$/)
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) })).json()
    const pages = targets.filter(row => row.type === 'page' && row.url.startsWith(`${origin}/`)
      && JSON.parse(row.description || '{}').visible === true)
    assert.equal(pages.length, 1, 'Exactly one actual Android Host WebView must exist')
    socket = new WebSocket(pages[0].webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Android WebView debugger connection timed out')), 10_000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Android WebView debugger connection failed')) }
    })
    let id = 0
    socket.onmessage = event => {
      const reply = JSON.parse(event.data), waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id); clearTimeout(waiter.timer)
      if (reply.error) waiter.reject(new Error(`Android WebView command failed: ${reply.error.code}`))
      else waiter.resolve(reply.result)
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const commandId = ++id
      const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(`Android WebView ${method} timed out`)) }, 10_000)
      pending.set(commandId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: commandId, method, params }))
    })
    const deadline = Date.now() + 60_000
    let page
    while (Date.now() < deadline) {
      const result = await call('Runtime.evaluate', { returnByValue: true, expression: `({
        ready: !!document.querySelector('#eleckoi-root main.main-window-shell.mobile-shell'),
        failures: [...document.querySelectorAll('[data-slot-error]')].map(row => row.getAttribute('data-slot-error')),
        richMessageLoading: document.querySelectorAll('.rich-message-loading').length,
        richMessageErrors: document.querySelectorAll('.rich-message-error').length,
        sharedFrontendStatus: window.__ElecKoiHtmlResources?.getSnapshot?.().status ?? 'unavailable',
        responseStatus: performance.getEntriesByType('navigation')[0]?.responseStatus ?? null,
        width: innerWidth, height: innerHeight
      })` })
      assert(!result.exceptionDetails, 'Android WebView inspection failed')
      page = result.result.value
      assert.equal(page.failures.length, 0, 'Android Client has a failed slot')
      assert.equal(page.richMessageErrors, 0, 'Android interactive message failed to load')
      if (page.responseStatus) assert.equal(page.responseStatus, 200, 'Actual Android WebView main document failed')
      if (page.ready && page.richMessageLoading === 0) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert(page?.ready, 'Android WebView did not render the mobile application within one minute')
    assert.equal(page.richMessageLoading, 0,
      `Android interactive messages did not finish loading; shared frontend: ${page.sharedFrontendStatus}`)
    const { cookies } = await call('Network.getCookies', { urls: [origin + '/'] })
    const sessions = cookies.filter(cookie => /^dsh-auth-[A-Za-z0-9_-]{43}$/.test(cookie.name))
    const activeName = 'dsh-auth-' + createHash('sha256').update(new URL(origin).host).digest('base64url')
    assert.equal(sessions.length, 1, 'Obsolete Android Host authentication cookies accumulated')
    assert.equal(sessions[0].name, activeName, 'Android WebView session does not belong to the active Host authority')
    return { ...page, authenticationCookies: sessions.length,
      cookieHeaderBytes: Buffer.byteLength(cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')) }
  } finally {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Android WebView inspection closed')) }
    socket?.close()
    if (port) await adb(['forward', '--remove', `tcp:${port}`])
  }
}
