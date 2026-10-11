import { describe, expect, it } from 'vitest'
import { moduleImports, isDshRuntimeImport, isForbiddenRendererDshImport } from '../scripts/architecture-imports.mjs'

describe('Official Renderer package boundary', () => {
  it('admits the public pure Client UI entry while retaining Host and SDK restrictions', () => {
    const imports = moduleImports(`
      import { IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
      export { IconCheckOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
      const documentation = "@deepseek-ai/dsh-sdk";
    `)
    expect(imports).toEqual(['@deepseek-ai/dsh-client-ui-primitives'])
    expect(imports.some(isForbiddenRendererDshImport)).toBe(false)
    expect(imports.some(isDshRuntimeImport)).toBe(false)
    for (const specifier of ['@deepseek-ai/dsh-sdk', '@deepseek-ai/dsh-sdk-client',
      '@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-primitives/src/icons', '@deepseek-ai/dsh-client-ui-primitives-other']) {
      expect(isForbiddenRendererDshImport(specifier), specifier).toBe(true)
      expect(isDshRuntimeImport(specifier), specifier).toBe(true)
    }
    expect(isForbiddenRendererDshImport('@deepseek-ai/cordis')).toBe(true)
    expect(isDshRuntimeImport('@eleckoi/dsh-runtime/session')).toBe(true)
    expect(isDshRuntimeImport('@eleckoi/desktop-host')).toBe(true)
  })
  it('also detects side-effect imports, type imports, re-exports and literal dynamic loading', () => {
    expect(moduleImports(`
      import '@deepseek-ai/dsh-agent';
      import type { Context } from '@deepseek-ai/cordis';
      export * from '@deepseek-ai/dsh-host-webserver';
      const sdk = import('@deepseek-ai/dsh-sdk');
      const runtime = require('@eleckoi/dsh-runtime');
    `)).toEqual(['@deepseek-ai/dsh-agent', '@deepseek-ai/cordis', '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-sdk', '@eleckoi/dsh-runtime'])
  })
})
