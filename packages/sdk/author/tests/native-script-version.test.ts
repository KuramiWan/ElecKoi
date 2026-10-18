import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { foldFailure } from '@shared/foundation/failure'
import {
  AUTHOR_SCRIPT_API_VERSION,
  AUTHOR_SCRIPT_RUNTIME,
  UNSUPPORTED_NATIVE_SCRIPT_VERSION_CODE,
  assertNativeAuthorScriptVersion
} from '@eleckoi/author-sdk'

const capture = (run: () => unknown): unknown => {
  try { run() } catch (error) { return error }
  throw new Error('预期抛出失败，但没有抛出')
}

describe('原生脚本版本校验的契约码', () => {
  it('本地码常量与契约码表逐字一致', () => {
    expect(Object.values(ELECKOI_FAILURE_CODES)).toContain(UNSUPPORTED_NATIVE_SCRIPT_VERSION_CODE)
    expect(UNSUPPORTED_NATIVE_SCRIPT_VERSION_CODE).toBe(ELECKOI_FAILURE_CODES.inputUnsupported)
  })

  it('不支持的版本折成 input/unsupported，而不是裸 TypeError', () => {
    const failure = capture(() => assertNativeAuthorScriptVersion({ runtime: { kind: AUTHOR_SCRIPT_RUNTIME, apiVersion: AUTHOR_SCRIPT_API_VERSION + 1 } }))
    expect(failure).toBeInstanceOf(Error)
    expect(foldFailure(failure)).toMatchObject({
      code: ELECKOI_FAILURE_CODES.inputUnsupported,
      message: '不支持的 ElecKoi 原生脚本版本。',
      details: { what: '原生脚本版本', expected: String(AUTHOR_SCRIPT_API_VERSION) }
    })
  })

  it('缺少运行期声明的脚本同样折成 input/unsupported', () => {
    expect(foldFailure(capture(() => assertNativeAuthorScriptVersion({})))).toMatchObject({
      code: ELECKOI_FAILURE_CODES.inputUnsupported
    })
  })
})
