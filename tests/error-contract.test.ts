import { describe, expect, it } from 'vitest'
import {
  ELECKOI_FAILURE_CODE_LIST,
  ELECKOI_FAILURE_CODE_PATTERN,
  ELECKOI_FAILURE_CODES,
  ELECKOI_FALLBACK_FAILURE_CODE,
  isEleckoiFailureCode,
  type EleckoiFailureCode
} from '../packages/product-shared/src/contracts/errors/codes'
import {
  ELECKOI_BOUNDARIES,
  type EleckoiBoundary
} from '../packages/product-shared/src/contracts/errors/boundaries'
import type { EleckoiFailureDetails } from '../packages/product-shared/src/contracts/errors/details'
import {
  LEGACY_DESKTOP_FAILURE_CODES,
  foldFailure
} from '../packages/product-shared/src/foundation/failure'
import { DesktopError, DESKTOP_ERROR_CODES } from '../packages/product-shared/src/foundation/DesktopError'

// 判据来源：ADR 0002 决定 14（首批码表 13 条，逐字）。这张表故意逐字重抄一遍，
// 不从实现推导——否则测试会跟着实现一起漂，漂了也看不出来。
const DECISION_14_CODES = [
  'eleckoi/internal',
  'eleckoi/contract/invalid-request',
  'eleckoi/contract/invalid-response',
  'eleckoi/input/invalid',
  'eleckoi/conflict/stale-revision',
  'eleckoi/creator-project/name-taken',
  'eleckoi/io/failed',
  'eleckoi/safety/refused',
  'eleckoi/storage/corrupt',
  'eleckoi/character/not-found',
  'eleckoi/creator-project/not-found',
  'eleckoi/agent-preset/not-found',
  'eleckoi/sender/untrusted'
] as const

// 判据来源：ADR 0002 决定 13/14（legacy 6 码的防御映射：3 条有唯一对应，3 条没有）。
const DECISION_14_LEGACY_MAP = {
  INTERNAL: 'eleckoi/internal',
  INVALID_REQUEST: 'eleckoi/input/invalid',
  FORBIDDEN: 'eleckoi/safety/refused',
  NOT_FOUND: null,
  CONFLICT: null,
  RUNTIME_UNAVAILABLE: null
} as const

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

describe('失败码表', () => {
  it('恰好是 ADR 决定 14 的 13 条，逐字一致且互不相同', () => {
    const actual = Object.values(ELECKOI_FAILURE_CODES)
    expect(actual).toHaveLength(13)
    expect(new Set(actual).size).toBe(13)
    expect(sorted(actual)).toStrictEqual(sorted(DECISION_14_CODES))
  })

  it('常量表的顺序清单与常量表本身是同一集合', () => {
    expect(ELECKOI_FAILURE_CODE_LIST).toHaveLength(13)
    expect(sorted(ELECKOI_FAILURE_CODE_LIST)).toStrictEqual(sorted(Object.values(ELECKOI_FAILURE_CODES)))
  })

  it('兜底码是 eleckoi/internal', () => {
    expect(ELECKOI_FALLBACK_FAILURE_CODE).toBe('eleckoi/internal')
  })

  for (const code of DECISION_14_CODES) {
    it(`${code} 的形态是 eleckoi/<域>/<原因>`, () => {
      expect(ELECKOI_FAILURE_CODE_PATTERN.test(code)).toBe(true)
      expect(code.startsWith('eleckoi/')).toBe(true)
      if (code === ELECKOI_FALLBACK_FAILURE_CODE) {
        // 文档化的唯一例外：兜底码只有两段。
        expect(code.split('/')).toHaveLength(2)
      } else {
        expect(code.split('/')).toHaveLength(3)
        expect(code.split('/').every((segment) => segment.length > 0)).toBe(true)
      }
    })
  }

  it('形态正则拒绝域或原因缺失、拒绝大写与非 ASCII 段', () => {
    for (const rejected of [
      'eleckoi',
      'eleckoi/',
      'eleckoi//failed',
      'eleckoi/io/',
      'eleckoi/IO/failed',
      'eleckoi/io/FAILED',
      'Eleckoi/io/failed',
      'gateway/internal',
      'eleckoi/io/failed/extra',
      'eleckoi/io failed'
    ]) {
      expect(ELECKOI_FAILURE_CODE_PATTERN.test(rejected), rejected).toBe(false)
    }
  })

  it('isEleckoiFailureCode 只认码表里的码', () => {
    for (const code of DECISION_14_CODES) expect(isEleckoiFailureCode(code), code).toBe(true)
    for (const code of ['gateway/internal', 'INTERNAL', 'eleckoi/io/failure', '']) {
      expect(isEleckoiFailureCode(code), code).toBe(false)
    }
  })
})

describe('边界翻译规则表', () => {
  const boundaries: readonly EleckoiBoundary[] = ELECKOI_BOUNDARIES

  it('恰好是闭集 ①–⑥，编号各一次', () => {
    expect(boundaries).toHaveLength(6)
    expect(sorted(boundaries.map((boundary) => String(boundary.ordinal)))).toStrictEqual(['1', '2', '3', '4', '5', '6'])
    expect(new Set(boundaries.map((boundary) => boundary.id)).size).toBe(6)
  })

  it('未知失败一律折成兜底码 eleckoi/internal', () => {
    for (const boundary of boundaries) {
      expect(boundary.fallback, boundary.id).toBe(ELECKOI_FALLBACK_FAILURE_CODE)
    }
  })

  it('每条折法只指向码表里的码，或 null（保留失败自带的码）', () => {
    for (const boundary of boundaries) {
      expect(boundary.folds.length, boundary.id).toBeGreaterThan(0)
      for (const fold of boundary.folds) {
        if (fold.code === null) continue
        expect(isEleckoiFailureCode(fold.code), `${boundary.id} → ${fold.code}`).toBe(true)
      }
    }
  })
})

describe('legacy 6 码的防御映射', () => {
  it('逐字等于 ADR 决定 13/14：3 条有唯一对应，3 条没有', () => {
    expect(LEGACY_DESKTOP_FAILURE_CODES).toStrictEqual(DECISION_14_LEGACY_MAP)
  })

  it('覆盖全部 6 个 legacy 码，一个不漏', () => {
    expect(sorted(Object.keys(LEGACY_DESKTOP_FAILURE_CODES))).toStrictEqual(sorted(Object.values(DESKTOP_ERROR_CODES)))
  })
})

interface FoldCase {
  readonly name: string
  readonly input: unknown
  readonly code: EleckoiFailureCode
  readonly message: string
  readonly details: EleckoiFailureDetails
}

// 判据来源：EH-1 任务书「foldFailure 的七类输入」+ ADR 决定 13/14。
const FOLD_CASES: readonly FoldCase[] = [
  {
    name: '已带契约码的 DesktopError：码与详情原样保留',
    input: new DesktopError(
      ELECKOI_FAILURE_CODES.ioFailed,
      '读取角色列表失败：ENOENT',
      { operation: 'read', path: '/tmp/eleckoi/characters.json' }
    ),
    code: ELECKOI_FAILURE_CODES.ioFailed,
    message: '读取角色列表失败：ENOENT',
    details: { operation: 'read', path: '/tmp/eleckoi/characters.json' }
  },
  {
    name: 'RemoteError 形状（结构标记 + string code）：码与详情原样保留',
    input: {
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.characterNotFound,
      message: '角色不存在',
      details: { what: 'character-1' }
    },
    code: ELECKOI_FAILURE_CODES.characterNotFound,
    message: '角色不存在',
    details: { what: 'character-1' }
  },
  {
    name: 'legacy INVALID_REQUEST → eleckoi/input/invalid',
    input: new DesktopError(DESKTOP_ERROR_CODES.INVALID_REQUEST, '请输入项目名称。'),
    code: ELECKOI_FAILURE_CODES.inputInvalid,
    message: '请输入项目名称。',
    details: {}
  },
  {
    name: 'legacy FORBIDDEN → eleckoi/safety/refused',
    input: new DesktopError(DESKTOP_ERROR_CODES.FORBIDDEN, '拒绝来自非 ElecKoi 页面进程的调用。'),
    code: ELECKOI_FAILURE_CODES.safetyRefused,
    message: '拒绝来自非 ElecKoi 页面进程的调用。',
    details: {}
  },
  {
    name: 'legacy INTERNAL → eleckoi/internal',
    input: new DesktopError(DESKTOP_ERROR_CODES.INTERNAL, '创作项目索引损坏，无法读取。'),
    code: ELECKOI_FAILURE_CODES.internal,
    message: '创作项目索引损坏，无法读取。',
    details: {}
  },
  {
    name: 'legacy NOT_FOUND 没有唯一对应 → eleckoi/internal 且原码进 details.what',
    input: new DesktopError(DESKTOP_ERROR_CODES.NOT_FOUND, '找不到对应的创作项目。'),
    code: ELECKOI_FAILURE_CODES.internal,
    message: '找不到对应的创作项目。',
    details: { what: 'NOT_FOUND' }
  },
  {
    name: 'legacy CONFLICT 没有唯一对应 → eleckoi/internal 且原码进 details.what',
    input: new DesktopError(DESKTOP_ERROR_CODES.CONFLICT, '保存位置已存在同名目录：角色甲'),
    code: ELECKOI_FAILURE_CODES.internal,
    message: '保存位置已存在同名目录：角色甲',
    details: { what: 'CONFLICT' }
  },
  {
    name: 'legacy RUNTIME_UNAVAILABLE 没有唯一对应 → eleckoi/internal 且原码进 details.what',
    input: new DesktopError(DESKTOP_ERROR_CODES.RUNTIME_UNAVAILABLE, 'DSH 运行时不可用。'),
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'DSH 运行时不可用。',
    details: { what: 'RUNTIME_UNAVAILABLE' }
  },
  {
    name: 'RemoteError 形状但带码表外的码：不猜，折成 eleckoi/internal 并记原码',
    input: {
      isDSHRemoteError: true,
      code: 'gateway/internal',
      message: 'carrier failed',
      details: { endpoint: 'eleckoiCharacters/list' }
    },
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'carrier failed',
    details: { what: 'gateway/internal' }
  },
  {
    // 载体码的出处是 DSH 自己的 API controller（详情就是 `{ issues }`），不是 api-gateway 包。
    name: '网关载体码 gateway/bad-request → contract/invalid-request，载体的 issues 逐条投影',
    input: {
      isDSHRemoteError: true,
      code: 'gateway/bad-request',
      message: 'invalid payload for settings.describe',
      // zod 的 issue：`path` 是数组、还带 `code` 等字段；契约只留 `{ path, message }`。
      details: {
        issues: [
          { code: 'too_small', path: ['parentDirectory'], message: 'Too small: expected string to have >=1 characters' },
          { code: 'invalid_type', path: [], message: 'Invalid input' }
        ]
      }
    },
    code: ELECKOI_FAILURE_CODES.contractInvalidRequest,
    message: 'invalid payload for settings.describe',
    details: {
      issues: [
        { path: 'parentDirectory', message: 'Too small: expected string to have >=1 characters' },
        { path: '', message: 'Invalid input' }
      ]
    }
  },
  {
    name: '网关载体码 gateway/arguments-invalid → contract/invalid-request，用 endpoint 合成一条 issue',
    input: {
      isDSHRemoteError: true,
      code: 'gateway/arguments-invalid',
      message: 'typert gateway: eleckoiCharacters/list: args fields do not match the descriptor: unexpected "x"',
      details: { endpoint: 'eleckoiCharacters/list' }
    },
    code: ELECKOI_FAILURE_CODES.contractInvalidRequest,
    message: 'typert gateway: eleckoiCharacters/list: args fields do not match the descriptor: unexpected "x"',
    details: {
      issues: [{
        path: 'eleckoiCharacters/list',
        message: 'typert gateway: eleckoiCharacters/list: args fields do not match the descriptor: unexpected "x"'
      }]
    }
  },
  {
    name: '网关载体码 gateway/input-invalid → contract/invalid-request，field 优先于 endpoint 进 path',
    input: {
      isDSHRemoteError: true,
      code: 'gateway/input-invalid',
      message: 'typert gateway: eleckoiPersona/save: wire field "name" failed boundary validation',
      details: { endpoint: 'eleckoiPersona/save', field: 'name' }
    },
    code: ELECKOI_FAILURE_CODES.contractInvalidRequest,
    message: 'typert gateway: eleckoiPersona/save: wire field "name" failed boundary validation',
    details: {
      issues: [{
        path: 'name',
        message: 'typert gateway: eleckoiPersona/save: wire field "name" failed boundary validation'
      }]
    }
  },
  {
    name: '网关载体码 gateway/result-invalid → contract/invalid-response，issues 同样带出去',
    input: {
      isDSHRemoteError: true,
      code: 'gateway/result-invalid',
      message: 'typert gateway: eleckoiCharacters/changes: stream Remote method did not return Iterable',
      details: { endpoint: 'eleckoiCharacters/changes', field: 'result' }
    },
    code: ELECKOI_FAILURE_CODES.contractInvalidResponse,
    message: 'typert gateway: eleckoiCharacters/changes: stream Remote method did not return Iterable',
    details: {
      issues: [{
        path: 'result',
        message: 'typert gateway: eleckoiCharacters/changes: stream Remote method did not return Iterable'
      }]
    }
  },
  {
    name: 'RemoteError 形状但带 legacy 码：走防御映射',
    input: { isDSHRemoteError: true, code: 'NOT_FOUND', message: '找不到。', details: {} },
    code: ELECKOI_FAILURE_CODES.internal,
    message: '找不到。',
    details: { what: 'NOT_FOUND' }
  },
  {
    name: '裸 Error → eleckoi/internal 且保留它的 message',
    input: new Error('EACCES: permission denied'),
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'EACCES: permission denied',
    details: {}
  },
  {
    name: '字符串 → eleckoi/internal 且 message 非空',
    input: 'boom',
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'boom',
    details: {}
  },
  {
    name: 'null → eleckoi/internal 且 message 非空',
    input: null,
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'null',
    details: {}
  },
  {
    name: 'undefined → eleckoi/internal 且 message 非空',
    input: undefined,
    code: ELECKOI_FAILURE_CODES.internal,
    message: 'undefined',
    details: {}
  },
  {
    name: '普通对象 → eleckoi/internal 且 message 非空',
    input: { reason: 'not_ready' },
    code: ELECKOI_FAILURE_CODES.internal,
    message: '[object Object]',
    details: {}
  },
  {
    name: '空字符串 → eleckoi/internal 且 message 非空（不留空文案给界面）',
    input: '',
    code: ELECKOI_FAILURE_CODES.internal,
    message: '未提供失败消息',
    details: {}
  },
  {
    name: '缺少结构标记的 { code, details } 对象不是 RemoteError，按未知失败兜底',
    input: { code: ELECKOI_FAILURE_CODES.ioFailed, message: '读取失败', details: { operation: 'read' } },
    code: ELECKOI_FAILURE_CODES.internal,
    message: '[object Object]',
    details: {}
  },
  {
    name: '结构标记为真但 code 不是字符串：不是 RemoteError，按未知失败兜底',
    input: { isDSHRemoteError: true, code: 42, message: '失败' },
    code: ELECKOI_FAILURE_CODES.internal,
    message: '[object Object]',
    details: {}
  }
]

describe('foldFailure：兜底折叠', () => {
  for (const foldCase of FOLD_CASES) {
    it(foldCase.name, () => {
      const folded = foldFailure(foldCase.input)
      expect(folded.code).toBe(foldCase.code)
      expect(folded.message).toBe(foldCase.message)
      expect(folded.details).toStrictEqual(foldCase.details)
    })
  }

  it('两条契约违例码在折叠里都有真生产者，issues 的形状合格（EH-11 的 H 项）', () => {
    // 判据来源：spec 决定 4「每条边界只声明不实现，不算完成」+ ADR 订正 r 的缺口清单。
    // 四个载体码都是实测存在的（出处见 failure.ts 的 GATEWAY_CARRIER_FOLDS 注释）。
    for (const carrier of ['gateway/bad-request', 'gateway/arguments-invalid', 'gateway/input-invalid', 'gateway/result-invalid']) {
      const folded = foldFailure({
        isDSHRemoteError: true,
        code: carrier,
        message: '载体诊断',
        details: { issues: [{ path: 'a.b', message: 'm' }] }
      })

      expect(folded.code, carrier).not.toBe(ELECKOI_FALLBACK_FAILURE_CODE)
      const issues = (folded.details as { readonly issues?: readonly { readonly path: string; readonly message: string }[] }).issues
      expect(Array.isArray(issues), carrier).toBe(true)
      expect(issues?.[0]?.path, carrier).toBe('a.b')
      expect(issues?.[0]?.message, carrier).toBe('m')
      expect(folded.code === ELECKOI_FAILURE_CODES.contractInvalidResponse, carrier).toBe(carrier === 'gateway/result-invalid')
    }
  })

  it('任何输入都产出非空 message 与对象形态的 details', () => {
    for (const foldCase of FOLD_CASES) {
      const folded = foldFailure(foldCase.input)
      expect(folded.message.trim().length, foldCase.name).toBeGreaterThan(0)
      expect(typeof folded.details, foldCase.name).toBe('object')
      expect(Array.isArray(folded.details), foldCase.name).toBe(false)
      expect(folded.details, foldCase.name).not.toBeNull()
    }
  })

  it('永不抛：17 类输入之外再粗扫一圈可疑值', () => {
    const suspicious: readonly unknown[] = [
      Symbol('x'),
      () => {},
      0,
      false,
      NaN,
      [],
      [new Error('nested')],
      new DesktopError(DESKTOP_ERROR_CODES.CONFLICT, ''),
      new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '', null),
      { isDSHRemoteError: true, code: 'eleckoi/io/failed', message: 'x' },
      { isDSHRemoteError: 'true', code: 'eleckoi/io/failed' }
    ]
    for (const value of suspicious) {
      expect(() => foldFailure(value)).not.toThrow()
    }
  })
})

/**
 * 跨 bundle 的 `DesktopError` 副本：识别必须靠**形状**（`name` + string `code`），不能靠
 * `instanceof DesktopError`。
 *
 * 实测依据：`packages/dsh-product-data` 是 tsdown 打的，`tsdown.config.ts` 的 `external` 里没有本包、
 * 而 src 用 `@shared/*` 别名 ⇒ 产物 `packages/dsh-product-data/lib/index.js:12715` 是**内联副本**
 * `var DesktopError = class extends Error { … this.name = "DesktopError" }`。生产里抛出方在
 * `dsh-product-data`、边界② 的折叠方在 `dsh-product-api`，两个副本的原型不同 ⇒ `instanceof` 必为
 * false，契约码与 `details` 会整条丢掉（`rpcFailure` 把它折成 `gateway/internal` + `{}`）。
 * 这个坑在**同进程同副本**的单元测试里看不出来（`instanceof` 对着源码那份是成立的），要到装出来才崩。
 *
 * ⚠️ **不要把 `foldFailure` 的桌面失败识别改回 `instanceof DesktopError`。** 下面这组就是这个回退的
 * 保护：那个对象**不是**本模块 `DesktopError` 的实例（`instanceof` 为 false），却必须被认出来；
 * 反向那条则钉住"识别靠 `name` 这个形状"，别退化成"见谁都认"。
 */
describe('foldFailure：跨 bundle 的 DesktopError 副本靠形状识别', () => {
  // 形状与真实 DesktopError 一致（Error 子类 + name + string code + details），但**刻意不用**
  // `new DesktopError(...)`：那是同一个类，测不到跨副本那条路。
  const foreignDesktopError = Object.assign(new Error('读取角色列表失败：ENOENT'), {
    name: 'DesktopError',
    code: ELECKOI_FAILURE_CODES.ioFailed,
    details: { operation: 'read', path: '/tmp/eleckoi/eh-2/characters.json' }
  })

  it('形状相同就必须保住码与详情，哪怕不是同一个类的实例', () => {
    expect(foreignDesktopError instanceof DesktopError, '前提：它不是本模块那个类的实例').toBe(false)

    const folded = foldFailure(foreignDesktopError)

    expect(folded.code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
    expect(folded.details).toEqual({ operation: 'read', path: '/tmp/eleckoi/eh-2/characters.json' })
  })

  it('反向：name 不对时**不许**认——码折兜底，自带详情也不许漏出去', () => {
    // 没有这条，"结构判定"就可能退化成"见谁都认"（只要带个 string code 就原样传）。带详情的那个
    // 字符串只可能出现在 details 里，所以 `details` 全等 `{}` 同时钉住了"原详情没漏出去"。
    const withoutName = Object.assign(new Error('读取角色列表失败：ENOENT'), {
      code: ELECKOI_FAILURE_CODES.ioFailed,
      details: { operation: 'read', path: '/tmp/eleckoi/eh-2/characters.json' }
    })
    const folded = foldFailure(withoutName)
    expect(folded.code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(folded.details).toEqual({})

    const misnamed = Object.assign(new Error('读取角色列表失败：ENOENT'), {
      name: 'SomeOtherError',
      code: ELECKOI_FAILURE_CODES.ioFailed,
      details: { operation: 'read', path: '/tmp/eleckoi/eh-2/characters.json' }
    })
    const foldedMisnamed = foldFailure(misnamed)
    expect(foldedMisnamed.code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(foldedMisnamed.details).toEqual({})

    // 注：`details.what` 只在**认出了载体**（产品失败 / RemoteError 形状）而码表里没有对应码时才写
    // （见 failure.ts 的 internalFailure 调用点）。这里两个对象都没被认出是载体，所以 what 为空；
    // "认出来、但码不在表里 ⇒ 原码进 details.what"那条路由 FOLD_CASES 里的 `gateway/internal`
    // 与 `eleckoi/nope/nope` 两条用例覆盖。
  })
})

describe('详情必须是能过 JSON 往返的扁平对象', () => {
  const DETAIL_CASES: readonly { readonly name: string; readonly details: EleckoiFailureDetails }[] = [
    { name: 'internal 带 what', details: { what: 'NOT_FOUND' } },
    { name: 'internal 不带 what', details: {} },
    { name: 'contract 带 issues', details: { issues: [{ path: 'name', message: 'Too small' }] } },
    { name: 'input 带 field', details: { field: 'parentDirectory' } },
    { name: 'stale-revision 带 what', details: { what: 'regex-rules' } },
    { name: 'name-taken 带 path', details: { path: '/tmp/eleckoi/projects/角色甲' } },
    { name: 'io 带 operation 与 path', details: { operation: 'read', path: '/tmp/eleckoi/characters.json' } },
    { name: 'io 只带 operation', details: { operation: 'spawn' } },
    { name: 'safety 带 guard', details: { guard: 'untrusted-sender' } },
    { name: 'storage 带 what', details: { what: 'creator-project-index' } },
    { name: 'not-found 带 what', details: { what: 'character-1' } },
    { name: 'sender 带 what', details: { what: 'https://example.invalid/' } }
  ]

  for (const detailCase of DETAIL_CASES) {
    it(`${detailCase.name} 能 JSON 往返且相等`, () => {
      const roundTripped: unknown = JSON.parse(JSON.stringify(detailCase.details))
      expect(roundTripped).toStrictEqual(detailCase.details)
    })
  }

  it('foldFailure 的结果也能 JSON 往返且相等', () => {
    for (const foldCase of FOLD_CASES) {
      const folded = foldFailure(foldCase.input)
      const recordable = { code: folded.code, message: folded.message, details: folded.details }
      expect(JSON.parse(JSON.stringify(recordable))).toStrictEqual(recordable)
    }
  })
})
