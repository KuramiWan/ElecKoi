/** Serialized into a message document; all runtime dependencies stay in this function. */
export function installRichDocumentMeasurement(page: Window, publish: (height: number) => void): void {
  let frame = 0
  let mutation: MutationObserver | undefined, resize: ResizeObserver | undefined
  const measure = () => {
    frame = 0
    const body = page.document.body
    if (!body) return
    const rect = body.getBoundingClientRect()
    const margin = Number.parseFloat(page.getComputedStyle(body).marginBottom) || 0
    let bottom = Math.max(rect.bottom + page.scrollY + margin, rect.top + page.scrollY + body.scrollHeight)
    // Positioned content has no normal-flow body height; measure its actual visible bounds.
    for (const element of body.querySelectorAll('*')) {
      const style = page.getComputedStyle(element)
      if (style.position !== 'absolute' && style.position !== 'fixed') continue
      if (style.display === 'none' || style.visibility === 'hidden') continue
      bottom = Math.max(bottom, element.getBoundingClientRect().bottom + page.scrollY)
    }
    publish(Math.max(1, Math.ceil(bottom)))
  }
  const schedule = () => { if (!frame) frame = page.requestAnimationFrame(measure) }
  const observe = () => {
    mutation = new MutationObserver(schedule)
    mutation.observe(page.document.body, { childList: true, subtree: true, attributes: true, characterData: true })
    if (typeof ResizeObserver === 'function') { resize = new ResizeObserver(schedule); resize.observe(page.document.body) }
    page.document.fonts?.addEventListener('loadingdone', schedule)
    page.addEventListener('resize', schedule)
    page.document.addEventListener('load', schedule, true)
    // The first size unlocks the staged presentation. Offscreen iframe paint
    // callbacks can be suspended until scrolling, so do not wait for one here.
    measure()
  }
  if (page.document.readyState === 'loading') page.addEventListener('DOMContentLoaded', observe, { once: true })
  else observe()
  page.addEventListener('pagehide', () => {
    mutation?.disconnect(); resize?.disconnect(); page.cancelAnimationFrame(frame)
    page.document.fonts?.removeEventListener('loadingdone', schedule)
    page.removeEventListener('resize', schedule)
    page.document.removeEventListener('load', schedule, true)
  }, { once: true })
}
