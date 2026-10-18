/**
 * 错误合约闸的**代码位置判定**：同样一段文本出现在字符串 / 模板字符串 / 注释里不算，
 * 只有代码位置才算。
 *
 * 反例来自真实仓库：`packages/host/product-data/src/domain/creatorStudio/guides.ts` 把作者脚本示例
 * 写成模板字符串，示例里的 `throw new Error(` 是**示例脚本**的合法写法，行级正则却把它计成裸抛。
 *
 * 这里构造四类样本，直接断言闸的判定结果：
 *
 * ① 真裸抛 → 规则 4 红；
 * ② 字符串 / 模板字符串（含跨行）里的同样文本 → 白；
 * ③ 注释（行注释、块注释）里的 → 白；
 * ④ 字符串里的 `.error.message` → 规则 1 白；真代码里的 → 规则 1 红。
 *
 * 另外钉住三条容易退化的行为：模板插值 `${…}` 里是真代码；正则字面量里的引号只污染本行、
 * 不污染后面的行；规则 2 / 3 用的是同一套代码位置判定。
 */
import { describe, expect, it } from 'vitest'
import { inspectSource } from '../check-error-contract.mjs'

/** 某条规则的命中行号（1 起，按出现顺序）。 */
function linesOf(text, rule) {
  return inspectSource(text, 'sample.ts')
    .filter((hit) => hit.rule === rule)
    .map((hit) => hit.line)
}

/** 样本里**整行等于** `exact` 的行号（1 起）。样本构造保证这一行只出现一次。 */
function lineOf(text, exact) {
  const index = text.split('\n').indexOf(exact)
  if (index < 0) throw new Error(`样本里没有这一行：${exact}`)
  return index + 1
}

describe('规则 4：只在代码位置上的裸抛判红', () => {
  const SAMPLE = [
    '// ① 真裸抛：红',
    'export function fail() {',
    '  throw new Error("真实失败")',
    '}',
    '',
    '// ② 单引号、双引号、转义与模板字符串里的同样文本：白',
    `const single = 'export default () => { throw new Error("示例") }'`,
    `const double = "… throw new Error('示例') …"`,
    `const escaped = 'it\\'s throw new Error("转义示例")'`,
    'const template = `',
    '  if (!Number.isFinite(score)) throw new Error("模板示例")',
    '`',
    'const interpolated = `前 ${(() => { throw new Error("插值里的裸抛") })()} 后`',
    '',
    '// ③ 注释里的：白',
    '// throw new Error("行注释示例")',
    '/* throw new Error("块注释示例") */',
    'const afterComment = 1',
    '',
    '// ④ 字符串里的丢码：规则 1 白；真代码里的：规则 1 红（它同时也是裸抛）',
    'const message = "失败原因：new Error(result.error.message)"',
    'export function drop(result) {',
    '  if (!result.ok) throw new Error(result.error.message)',
    '}'
  ].join('\n')

  it('字符串、模板、注释里的不算，插值里的是代码', () => {
    // 最后一条「丢码」同时也是裸抛（`throw new Error(x.error.message)`），所以规则 4 也数它。
    expect(linesOf(SAMPLE, 'bare-throw')).toEqual([
      lineOf(SAMPLE, '  throw new Error("真实失败")'),
      lineOf(SAMPLE, 'const interpolated = `前 ${(() => { throw new Error("插值里的裸抛") })()} 后`'),
      lineOf(SAMPLE, '  if (!result.ok) throw new Error(result.error.message)')
    ])
  })

  it('规则 1 同样只看代码位置', () => {
    expect(linesOf(SAMPLE, 'no-code-drop')).toEqual([
      lineOf(SAMPLE, '  if (!result.ok) throw new Error(result.error.message)')
    ])
  })

  it('这份样本不触发规则 2 与规则 3', () => {
    expect(linesOf(SAMPLE, 'contract-issues')).toEqual([])
    expect(linesOf(SAMPLE, 'empty-catch')).toEqual([])
  })
})

describe('引号状态的边界', () => {
  it('正则字面量里的引号不污染后面的行（未转义换行处复位）', () => {
    const text = [
      'const quoted = /["\']/.test(value)',
      'throw new Error("真实失败")'
    ].join('\n')
    expect(linesOf(text, 'bare-throw')).toEqual([2])
  })
})

describe('规则 2：契约违例码与 issues', () => {
  it('代码里的契约违例带完整 issues 时放行', () => {
    const text = [
      'export function good() {',
      '  return { code: ELECKOI_FAILURE_CODES.contractInvalidRequest, message: "诊断", details: {',
      '    issues: [{ path: "name", message: "必填" }]',
      '  } }',
      '}'
    ].join('\n')
    expect(linesOf(text, 'contract-issues')).toEqual([])
  })

  it('代码里的契约违例缺 issues 时判红', () => {
    const text = [
      'export function bad() {',
      '  return { code: ELECKOI_FAILURE_CODES.contractInvalidRequest, message: "诊断", details: {} }',
      '}'
    ].join('\n')
    expect(linesOf(text, 'contract-issues')).toEqual([2])
  })

  it('字符串与注释里的契约违例码不算', () => {
    const text = [
      '// 字符串与注释里的同样文本：白',
      'const example = "code: ELECKOI_FAILURE_CODES.contractInvalidRequest"',
      "const literal = \"code: 'eleckoi/contract/invalid-response'\"",
      '// code: ELECKOI_FAILURE_CODES.contractInvalidRequest',
      '/* code: ELECKOI_FAILURE_CODES.contractInvalidRequest */'
    ].join('\n')
    expect(linesOf(text, 'contract-issues')).toEqual([])
  })
})

describe('规则 3：空 catch', () => {
  it('字符串与注释里的空 catch 不算，代码里的算', () => {
    const text = [
      '// 字符串与注释里的空 catch：白',
      'const inString = "promise.catch(() => {})"',
      '// 注释里的 try { run() } catch {}',
      '/* promise.catch(() => {}) */',
      '',
      '// 代码里的空 catch：红',
      'void promise.catch(() => {})',
      'try { run() } catch {}',
      'try { run() } catch (error) { /* 只有注释也算空 */ }',
      '',
      '// 非空处理体与具名声明：白',
      'promise.catch((error) => reportFailure(error))',
      'promise.catch(failureAlreadyPublished)'
    ].join('\n')
    expect(linesOf(text, 'empty-catch')).toEqual([
      lineOf(text, 'void promise.catch(() => {})'),
      lineOf(text, 'try { run() } catch {}'),
      lineOf(text, 'try { run() } catch (error) { /* 只有注释也算空 */ }')
    ])
  })
})
