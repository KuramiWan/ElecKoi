import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { foldFailure } from '@shared/foundation/failure'
import { resolveMvuMessageVariableMacros } from '@eleckoi/compatibility-mvu'

const capture = (run: () => unknown): unknown => {
  try { run() } catch (error) { return error }
  throw new Error('预期抛出失败，但没有抛出')
}

const resolve = (state: string) => resolveMvuMessageVariableMacros('{{get_message_variable::stat_data.hp}}', state)

describe('消息变量状态损坏', () => {
  it('解析不出的状态折成 storage/corrupt，并带名词短语 what', () => {
    expect(foldFailure(capture(() => resolve('{')))).toMatchObject({
      code: ELECKOI_FAILURE_CODES.storageCorrupt,
      details: { what: '消息变量状态' }
    })
  })

  it('合法 JSON 但不是对象同样折成 storage/corrupt', () => {
    expect(foldFailure(capture(() => resolve('[1,2,3]')))).toMatchObject({
      code: ELECKOI_FAILURE_CODES.storageCorrupt,
      details: { what: '消息变量状态' }
    })
  })

  it('合法对象仍按原语义展开宏', () => {
    expect(resolve('{"hp":7}')).toBe('7')
  })
})
