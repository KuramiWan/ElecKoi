import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const css = readFileSync(new URL('../apps/web/src/mobile/mobile.css', import.meta.url), 'utf8')
const activity = readFileSync(new URL('../apps/android/app/src/main/java/com/eleckoi/app/MainActivity.java', import.meta.url), 'utf8')
const facade = readFileSync(new URL('../apps/android/app/src/main/assets/platform-facade.js', import.meta.url), 'utf8')

function navigationPage() {
  const page = new JSDOM('<!doctype html><html><body><main class="mobile-shell"><div class="mobile-front-content"><section class="mobile-page-seat"><div role="dialog"><input aria-label="名称" /></div></section><nav class="mobile-bottom-nav"><button>预设</button></nav></div></main><nav class="desktop-navigation">桌面</nav></body></html>', { runScripts: 'outside-only' })
  const style = page.window.document.createElement('style')
  style.textContent = css
  page.window.document.head.append(style)
  page.window.ElecKoiAndroid = {}
  page.window.eval(facade)
  function applyAttribute(name, variable, value) {
    expect(activity).toContain(`browserCommand("attribute", attributePayload("${name}", ${variable}), null);`)
    page.window.ElecKoiPlatform.browserCommand({ type: 'attribute', payload: { name, value } })
  }
  return { page,
    applyIme: visible => applyAttribute('data-eleckoi-ime-visible', 'imeVisible', visible),
    applyNavigation: buttons => applyAttribute('data-eleckoi-button-navigation', 'bottomButtonNavigation', buttons),
  }
}

describe('Android IME and root navigation', () => {
  it('uses a compact centered row for bottom navigation buttons and restores gesture spacing', () => {
    const { page, applyIme, applyNavigation } = navigationPage()
    try {
      const { window } = page
      const nav = window.document.querySelector('.mobile-bottom-nav')
      nav.querySelector('button').innerHTML = '<span>预设</span>'
      applyNavigation(true)
      expect(window.getComputedStyle(nav).minHeight).toBe('48px')
      expect(window.getComputedStyle(nav.querySelector('button')).height).toBe('48px')
      expect(window.getComputedStyle(nav.querySelector('span')).transform).toBe('none')
      applyIme(true)
      expect(window.getComputedStyle(nav).display).toBe('none')
      applyIme(false)
      expect(window.getComputedStyle(nav).display).toBe('flex')
      applyNavigation(false)
      expect(window.getComputedStyle(nav.querySelector('button')).height).toBe('64px')
      expect(window.getComputedStyle(nav.querySelector('span')).transform).toBe('translateY(-8px)')
    } finally { page.window.close() }
  })
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
