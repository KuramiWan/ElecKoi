import { describe, expect, it } from 'vitest'
import { normalizeLineEndings } from '../scripts/lib/normalize-line-endings.mjs'

describe('plugin documentation line ending checks', () => {
  it('treats Windows and Unix line endings as the same generated content', () => {
    const generated = '# API\n\n| ID | Members |\n'
    const windowsCheckout = generated.replaceAll('\n', '\r\n')

    expect(normalizeLineEndings(windowsCheckout)).toBe(normalizeLineEndings(generated))
  })
})
