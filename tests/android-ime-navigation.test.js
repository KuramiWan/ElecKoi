import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const css = readFileSync(new URL('../apps/web/src/mobile/mobile.css', import.meta.url), 'utf8')
const activity = readFileSync(new URL('../apps/android/app/src/main/java/com/eleckoi/app/MainActivity.java', import.meta.url), 'utf8')

function navigationPage() {
  const page = new JSDOM('<!doctype html><html><body><main class="mobile-shell"><div class="mobile-front-content"><section class="mobile-page-seat"><div role="dialog"><input aria-label="名称" /></div></section><nav class="mobile-bottom-nav"><button>预设</button></nav></div></main><nav class="desktop-navigation">桌面</nav></body></html>', { runScripts: 'outside-only' })
  const style = page.window.document.createElement('style')
  style.textContent = css
  page.window.document.head.append(style)
  const script = activity.match(/web\.evaluateJavascript\("([^"\n]+)" \+ imeVisible \+ "([^"\n]+)", null\);/)
  expect(script, 'native IME visibility script').not.toBeNull()
  return { page, applyIme: visible => page.window.eval(`${script[1]}${visible}${script[2]}`) }
}

describe('Android IME and root navigation', () => {
  it('removes the navigation from layout while the keyboard is visible and restores it on dismissal', () => {
    const { page, applyIme } = navigationPage()
    try {
      const { window } = page
      const nav = window.document.querySelector('.mobile-bottom-nav')
      const input = window.document.querySelector('input')
      input.focus()
      expect(window.getComputedStyle(nav).display).toBe('flex')
      applyIme(true)
      expect(window.getComputedStyle(nav).display).toBe('none')
      expect(window.document.activeElement).toBe(input)
      expect(window.getComputedStyle(input).display).not.toBe('none')
      applyIme(false)
      expect(window.getComputedStyle(nav).display).toBe('flex')
      expect(window.document.activeElement).toBe(input)
    } finally { page.window.close() }
  })

  it('keeps new root navigation hidden during page switches and leaves desktop navigation alone', () => {
    const { page, applyIme } = navigationPage()
    try {
      const { window } = page
      applyIme(true)
      const next = window.document.createElement('nav')
      next.className = 'mobile-bottom-nav'
      next.innerHTML = '<button>角色</button>'
      window.document.querySelector('.mobile-bottom-nav').replaceWith(next)
      expect(window.getComputedStyle(next).display).toBe('none')
      expect(window.getComputedStyle(window.document.querySelector('.desktop-navigation')).display).not.toBe('none')
      applyIme(false)
      expect(window.getComputedStyle(next).display).toBe('flex')
    } finally { page.window.close() }
  })

  it('does not treat input focus or window resizing as keyboard visibility', () => {
    const { page } = navigationPage()
    try {
      const { window } = page
      window.document.querySelector('input').focus()
      Object.defineProperty(window, 'innerHeight', { value: 360, configurable: true })
      window.dispatchEvent(new window.Event('resize'))
      expect(window.getComputedStyle(window.document.querySelector('.mobile-bottom-nav')).display).toBe('flex')
      expect(window.document.documentElement.hasAttribute('data-eleckoi-ime-visible')).toBe(false)
    } finally { page.window.close() }
  })
})
