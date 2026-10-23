/**
 * 日志诊断行：一行里说清「什么码、为什么、什么详情、在做什么操作」。
 *
 * 判据：错误设计的目标「看日志的人不需要回去查码表」。这里断言的是**形状**：
 * 码在、开发者文案在、详情在、操作名在，且没有时间戳（时间由日志层给）。
 */
import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '../src/contracts/errors/codes'
import { describeDetails, describeFailure } from '../src/foundation/describeFailure'

const failure = {
  code: ELECKOI_FAILURE_CODES.ioFailed,
  message: '写不进创作项目索引',
  details: { operation: 'write', path: '/tmp/项目' }
}

describe('describeFailure', () => {
  it('码、开发者文案、详情各就各位', () => {
    const line = describeFailure(failure)
    expect(line).toContain(`[${ELECKOI_FAILURE_CODES.ioFailed}]`)
    expect(line).toContain('写不进创作项目索引')
    expect(line).toContain('operation: write')
    expect(line).toContain('path: /tmp/项目')
  })

  it('有操作名时附在尾部（是有语义的操作名，不是随机 id）', () => {
    expect(describeFailure(failure, '保存创作项目')).toContain('保存创作项目')
  })

  it('没有详情时不写空括号', () => {
    const line = describeFailure({ code: ELECKOI_FAILURE_CODES.internal, message: '不知道怎么了', details: {} })
    expect(line).not.toContain('（）')
    expect(line).not.toContain('(  )')
  })

  it('不含时间戳（时间由日志层负责）', () => {
    expect(describeFailure(failure)).not.toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('详情值可以做 JSON、也可以只是标量', () => {
    expect(describeDetails({ a: 1, b: true, c: { d: 2 }, e: undefined })).toBe('a: 1；b: true；c: {"d":2}')
    expect(describeDetails(null)).toBe('')
    expect(describeDetails([1, 2])).toBe('')
  })
})
