// 判据来源：票 EH-9 第 6 节——闸对**构造出来的**违规样本报红、对干净样本报绿、账本多/少一条都报红；
// ADR 0002 决定 6（三条规则各配一次突变演练、判据必须可突变）与决定 11（账本集合等式、只减不增）。
//
// 用 `.mjs`：`tests/**/*.ts` 在 `tsconfig.node.json` 的 include 里，`.ts` 测试 import `.mjs` 脚本需要
// 同目录 `.d.mts`；`.mjs` 测试不受这条限制（先例 `tests/docs-check.test.mjs`，见
// `notes/eh-explore-gate-docs.md` §1.7/§6.6）。
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  MAX_EXEMPTIONS,
  RULES,
  checkErrorContract,
  hitsForFile,
  loadLedger,
  reconcile,
  validateTracking
} from '../scripts/check-error-contract.mjs'

const root = resolve(import.meta.dirname, '..')

const linesOf = (...lines) => lines.join('\n') + '\n'

describe('check:error-contract 对真实仓库', () => {
  it('干净样本报绿，且命中集合与账本集合相等', () => {
    const result = checkErrorContract(root)
    expect(result.failures).toEqual([])
    expect(result.hits.length).toBe(result.exemptions.length)
    expect(result.exemptions.length).toBeLessThanOrEqual(MAX_EXEMPTIONS)
  })

  it('账本每条都有 reason 与可核对的 tracking 失效条件', () => {
    const ledger = loadLedger(root)
    expect(ledger.failures).toEqual([])
    expect(ledger.exemptions.length).toBeGreaterThan(0)
    for (const entry of ledger.exemptions) {
      expect(entry.reason.trim().length).toBeGreaterThan(0)
      expect(entry.tracking).toMatch(/^docs\/(?:open-problems|adr)\//)
    }
  })
})

// 判据来源：票 EH-11 的 J 项——`tracking` 的族名检查原先在指针字面等于「状态行」时被跳过，
// 于是任何豁免只靠状态行就能过（"没有失效条件的豁免不许存在"这条机器判据形同虚设）。
describe('tracking 的失效条件指针（EH-11 的 J 项）', () => {
  it('裸写「状态行」不算指针（它不指向任何一条失效条件）', () => {
    expect(validateTracking(root, 'docs/open-problems/error-contract-exemptions.md 状态行'))
      .toContain('不许只写')
  })

  it('指向具体族名的指针成立，现有账本 65 条每一条都成立', () => {
    expect(validateTracking(root, 'docs/open-problems/error-contract-exemptions.md 族 B')).toBeUndefined()
    const ledger = loadLedger(root)
    expect(ledger.failures).toEqual([])
    for (const entry of ledger.exemptions) {
      expect(validateTracking(root, entry.tracking), entry.tracking).toBeUndefined()
    }
  })

  it('不存在的族名仍红（不许退化成"文档里有个状态行就算数"）', () => {
    expect(validateTracking(root, 'docs/open-problems/error-contract-exemptions.md 族 Z'))
      .toContain('找不到状态行指针')
  })
})

describe('规则 1 禁止丢码', () => {
  it('任意接收者的 .error.message 都算命中（变量名不是 result 也要抓到）', () => {
    expect(hitsForFile('packages/x/src/a.js', linesOf("if (!accepted?.ok) throw new Error(accepted?.error?.message || '生成请求失败。')"))).toHaveLength(1)
    expect(hitsForFile('packages/x/src/a.js', linesOf("throw new Error(status.ok ? '不兼容。' : status.error.message)"))).toHaveLength(1)
    expect(hitsForFile('packages/x/src/a.js', linesOf("throw new Error(event.data.reason.error?.message || '未完成。')"))).toHaveLength(1)
  })

  it('没有 throw 前缀也算命中（finish(new Error(<…>.error.message)) 是同一族）', () => {
    const hits = hitsForFile('packages/x/src/a.js', linesOf("finish(new Error(snapshot.promptError.error?.message || '生成失败。'))"))
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe('no-code-drop')
  })

  it('保留失败实例的写法不命中', () => {
    expect(hitsForFile('packages/x/src/a.js', linesOf('if (!result?.ok) throw result.error'))).toEqual([])
  })

  it('注释行不算命中', () => {
    expect(hitsForFile('packages/x/src/a.js', linesOf('// 以前是 throw new Error(result?.error?.message)'))).toEqual([])
  })
})

describe('规则 2 契约违例必须给 invalid-* 与结构完整的 issues', () => {
  const clean = linesOf(
    'export function invalidResponseFailure(what, path = MISSING_ERROR_ISSUE_PATH) {',
    '  const issue = { path, message: what }',
    '  return {',
    '    isDSHRemoteError: true,',
    '    code: ELECKOI_FAILURE_CODES.contractInvalidResponse,',
    '    message: what,',
    '    details: { issues: [issue] }',
    '  }',
    '}'
  )

  it('干净样本报绿', () => {
    expect(hitsForFile('packages/dsh-product-api/src/client/invalidResponse.ts', clean)).toEqual([])
  })

  it('契约声明目录不参与扫描（它是判据来源，不是产出点）', () => {
    expect(hitsForFile('packages/product-shared/src/contracts/errors/boundaries.ts', linesOf('  { when: \'入参不合合同\', code: ELECKOI_FAILURE_CODES.contractInvalidRequest },'))).toEqual([])
  })

  it('details 里没有 issues ⇒ 红', () => {
    const hits = hitsForFile('packages/x/src/a.ts', clean.replace('details: { issues: [issue] }', 'details: {}'))
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe('contract-invalid-details')
    expect(hits[0].detail).toContain('issues')
  })

  it('issues 为空数组 ⇒ 红', () => {
    expect(hitsForFile('packages/x/src/a.ts', clean.replace('issues: [issue]', 'issues: []'))).toHaveLength(1)
  })

  it('issues 元素缺 path ⇒ 红', () => {
    expect(hitsForFile('packages/x/src/a.ts', clean.replace('{ path, message: what }', '{ message: what }'))).toHaveLength(1)
  })

  it('未登记的契约违例码名 ⇒ 红', () => {
    const hits = hitsForFile('packages/x/src/a.ts', clean.replace('contractInvalidResponse', 'contractInvalidPayload'))
    expect(hits).toHaveLength(1)
    expect(hits[0].detail).toContain('未登记的契约违例码')
  })

  it('未登记的违约例码字面量 ⇒ 红', () => {
    const hits = hitsForFile('packages/x/src/a.ts', clean.replace('ELECKOI_FAILURE_CODES.contractInvalidResponse', "'eleckoi/contract/invalid-payload'"))
    expect(hits).toHaveLength(1)
    expect(hits[0].detail).toContain('未登记的契约违例码')
  })
})

describe('规则 3 空 catch 必须有豁免声明', () => {
  it('.catch(() => {}) 命中', () => {
    const hits = hitsForFile('apps/web/src/a.js', linesOf('void catalog.refresh().catch(() => {})'))
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe('empty-catch')
  })

  it('空与仅注释的 catch 体都命中', () => {
    expect(hitsForFile('packages/x/src/a.ts', linesOf('} catch {}'))).toHaveLength(1)
    expect(hitsForFile('packages/x/src/a.ts', linesOf('} catch { /* 说明 */ }'))).toHaveLength(1)
  })

  it('有处理体的 catch 不命中', () => {
    expect(hitsForFile('apps/web/src/a.js', linesOf('void catalog.refresh().catch((error) => setStatus(error.message))'))).toEqual([])
    expect(hitsForFile('packages/x/src/a.ts', linesOf('} catch (error) { console.error(error) }'))).toEqual([])
  })

  it('注释行不算命中', () => {
    expect(hitsForFile('apps/web/src/a.js', linesOf('// 列表刷新失败以前被 `.catch(() => {})` 吃掉'))).toEqual([])
  })
})

describe('账本对账（多一条 / 少一条 / 超过冻结上限都红）', () => {
  const hit = { rule: 'empty-catch', file: 'apps/web/src/a.js', line: 3, detail: 'void x().catch(() => {})' }
  const exemption = { rule: 'empty-catch', file: 'apps/web/src/a.js', line: 3, reason: '合成样本', tracking: 'docs/open-problems/error-contract-exemptions.md 族 C' }

  it('命中已登记 ⇒ 绿', () => {
    expect(reconcile([hit], [exemption], MAX_EXEMPTIONS)).toEqual([])
  })

  it('少一条（命中没登记）⇒ 红', () => {
    const failures = reconcile([hit], [], MAX_EXEMPTIONS)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('账本里没有登记')
  })

  it('多一条（登记了但没有命中）⇒ 红', () => {
    const failures = reconcile([], [exemption], MAX_EXEMPTIONS)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('已失效')
  })

  it('超过 MAX_EXEMPTIONS ⇒ 红（只减不增）', () => {
    const failures = reconcile([hit], [exemption], 0)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('MAX_EXEMPTIONS')
  })
})

describe('三条规则的判据都写在闸里（不靠调用方传）', () => {
  it('规则 id 与 ADR 决定 6 的首批三条一一对应', () => {
    expect(RULES.map((rule) => rule.id)).toEqual(['no-code-drop', 'contract-invalid-details', 'empty-catch'])
    expect(RULES.map((rule) => rule.ordinal)).toEqual([1, 2, 3])
    for (const rule of RULES) expect(rule.criterion.length).toBeGreaterThan(0)
  })
})
