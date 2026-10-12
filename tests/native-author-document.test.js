// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { AUTHOR_API_VERSION, buildAuthorDocumentSource, readAuthorDocumentDeclaration } from '@eleckoi/author-sdk'

const declaration = `<meta name="eleckoi-author-api" content="${AUTHOR_API_VERSION}">`

describe('native author document contract', () => {
  it('uses an explicit head declaration, never script text, attributes, or template contents', () => {
    expect(readAuthorDocumentDeclaration(`<html><head>${declaration}</head><body></body></html>`)).toEqual({ kind: 'native', version: AUTHOR_API_VERSION })
    for (const source of [
      `<html><head><script>const example = ${JSON.stringify(declaration)};</script></head><body></body></html>`,
      `<html><head><template>${declaration}</template></head><body></body></html>`,
      `<html><body>${declaration}</body></html>`,
      '<div data-eleckoi-author-api="0.1.0">Synthetic panel</div>',
      '<script>window.ElecKoi.variables.getState()</script>',
    ]) expect(readAuthorDocumentDeclaration(source)).toEqual({ kind: 'undeclared' })
  })

  it('distinguishes unsupported declarations from undeclared documents, without choosing among duplicates', () => {
    for (const head of [declaration + declaration, '<meta name="eleckoi-author-api" content="9.0.0">', '<meta name="eleckoi-author-api">']) {
      const source = `<html><head>${head}</head><body>Synthetic content</body></html>`
      expect(readAuthorDocumentDeclaration(source).kind).toBe('unsupported')
      expect(() => buildAuthorDocumentSource(source, 'synthetic-channel')).toThrow()
    }
    expect(() => buildAuthorDocumentSource('<div>Synthetic panel</div>', 'synthetic-channel')).toThrow('没有声明')
  })

  it('preserves authored source and inserts readiness before it without compatibility assets', () => {
    const author = 'window.ElecKoiReady.then(api => api.context.current());'
    const output = buildAuthorDocumentSource(`<!doctype html><html lang="en"><head>${declaration}<script>${author}</script></head><body><button>Confirm</button></body></html>`, '</script><script>Synthetic</script>', true)
    const document = new DOMParser().parseFromString(output, 'text/html')
    const scripts = document.querySelectorAll('script')
    expect(scripts).toHaveLength(2)
    expect(scripts[0].textContent).toContain('ElecKoiReady')
    expect(scripts[0].textContent).toContain('\\u003c/script>')
    expect(scripts[1].textContent).toBe(author)
    expect(document.documentElement.lang).toBe('en')
    expect(document.querySelector('button')?.textContent).toBe('Confirm')
    expect(document.querySelector('meta[name="viewport"]')).not.toBeNull()
    expect(document.querySelectorAll('script[src],link,script[type="importmap"]')).toHaveLength(0)
    expect(output).not.toMatch(/TavernHelper|SillyTavern|Mvu|__ElecKoiHtmlResources|\/eleckoi\/compat\//)
  })

  it('resolves project resources relative to the explicit entry folder and preserves an authored base', () => {
    const input = `<html><head>${declaration}<script src="app.js"></script></head><body><img src="../assets/image.png"></body></html>`
    const output = buildAuthorDocumentSource(input, 'synthetic-project', false, {
      baseUrl: '/eleckoi/frontends/synthetic-project/pages/', globalStyles: ['/eleckoi/frontends/synthetic-project/shared.css'],
      context: { view: 'main', owner: { characterId: 'synthetic-character' }, literal: '</script><script>Not code</script>' },
    })
    const document = new DOMParser().parseFromString(output, 'text/html')
    expect(document.querySelector('base').getAttribute('href')).toBe(new URL('/eleckoi/frontends/synthetic-project/pages/', window.document.baseURI).href)
    expect(document.querySelector('script[src]').src).toBe(new URL('app.js', document.baseURI).href)
    expect(document.querySelector('img').src).toBe(new URL('../assets/image.png', document.baseURI).href)
    expect(document.querySelector('link[rel="stylesheet"]').getAttribute('href')).toBe('/eleckoi/frontends/synthetic-project/shared.css')
    expect(document.querySelector('script[src]').getAttribute('src')).toBe('app.js')
    expect(document.querySelectorAll('script')).toHaveLength(2)
    expect(document.querySelector('script').textContent).toContain('\\u003c/script>')
    expect(readAuthorDocumentDeclaration(output)).toEqual({ kind: 'native', version: AUTHOR_API_VERSION })
    const explicit = buildAuthorDocumentSource(input.replace(declaration, declaration + '<base href="/synthetic-authored/">'), 'synthetic-base', false, { baseUrl: '/eleckoi/frontends/synthetic-project/pages/' })
    const authored = new DOMParser().parseFromString(explicit, 'text/html')
    expect(authored.querySelectorAll('base')).toHaveLength(1)
    expect(authored.querySelector('base').getAttribute('href')).toBe('/synthetic-authored/')
  })
})
