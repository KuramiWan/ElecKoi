/**
 * 【R2 目标套件·伴生文件】世界书注入模型。
 *
 * 为什么是 .js：本用例要驱动 `resources/dsh/conversation-context.mjs` 这个**未带类型声明**的运行时 seam，
 * 而 `tsconfig.node.json` 只检查 tests 目录下的 .ts 文件。仓库里驱动该模块的既有用例（`dsh-conversation-context.test.js`）
 * 同样是 .js——这里follow同样的做法。
 *
 * 开关与主文件相同：默认跳过；要跑就设 ELECKOI_TAVERN_COMPAT_TARGET=1。
 */
import { describe, expect, it } from 'vitest'
import { settingInjections } from '../resources/dsh/conversation-context.mjs'
import { decodeFixture } from './helpers/tavernCardFixtures'
import { decodeCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import { COMPANION_TARGETS } from './helpers/tavernRedLedger'
import { tavernTargetEnabled } from './helpers/tavernTargetGate'

const enabled = tavernTargetEnabled()

/**
 * 本文件的目标断言登记表：调用 `targetIt()` 才算一条红。
 * 台账（`tavernRedLedger.ts`）里 `COMPANION_TARGETS` 必须等于这里的条数——
 * 下面最后一条闸门在**运行期**核，所以"悄悄删一条红断言、顺手把台账改小"要改三处且会被这里拦住。
 */
const registeredTargets = []
function targetIt(title, body) {
  registeredTargets.push(title)
  it(title, body)
}

describe.skipIf(!enabled)('【R2 目标套件】世界书注入模型：今天应当红', () => {
  targetIt('关键词命中的卡内嵌世界书条目应被注入本轮请求（酒馆行为；电子爱改走 Agent 工具检索）', () => {
    const decoded = decodeFixture('v3-worldbook-array.json').decoded
    expect(decoded.settingLibrary, '夹具应能导入').toBeTruthy()

    // 历史里出现了条目关键词（PROBE-KEY-arr-1）：酒馆此时会把该条目的正文插进这一轮的提示词
    const history = [{
      id: 'message-user-1',
      role: 'user',
      content: [{ type: 'text', text: '我刚才说到 PROBE-KEY-arr-1' }],
      source: { kind: 'user' }
    }]
    const injected = settingInjections({ history, settingLibrary: decoded.settingLibrary })
    const contents = injected.map((entry) => entry.content).join('\n')

    // 先确认这个 seam 是通的：常驻（agentReadStrategy: required）条目今天就会被注入成「Agent 必读」
    expect(contents, '常驻条目应被注入（说明注入 seam 本身是通的）').toContain('PROBE-ARR-常驻')

    // 目标：关键词命中的条目也要进本轮请求。今天不会——导入侧把这类条目一律标成 agent_tool，
    // 只有 Agent 主动检索才看得到。差的是导入侧的 triggerMode / 插入位置，不是缺框架。
    expect(contents, '酒馆在关键词命中时把条目正文注入本轮请求；电子爱把这类条目交给 Agent 检索')
      .toContain('PROBE-ARR-重名甲')
  })
})

/**
 * 一张只有常量条目、且数组顺序与 insertion_order **相反**的卡：
 *   数组 [后插入(insertion_order 100), 先插入(insertion_order 10)]
 * 酒馆按 insertion_order 先后注入；电子爱今天按数组顺序（导入时 order 与 treeViewOrder 都写成 index + 1，
 * required 缓存又按 treeViewOrder 排）。这张卡同时喂给下面一条红用例和一条空白证据。
 */
function orderedCard() {
  const entry = (name, order, content) => ({
    name, content, keys: [`PROBE-KEY-ord-${order}`], constant: true, insertion_order: order
  })
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'PROBE 顺序卡',
      first_mes: 'PROBE 顺序卡开场',
      character_book: { name: '顺序世界书', entries: [entry('后插入', 100, 'PROBE-ORD-后'), entry('先插入', 10, 'PROBE-ORD-先')] }
    }
  }
}

function orderedDecoded() {
  const decoded = decodeCharacterCard(new TextEncoder().encode(JSON.stringify(orderedCard())), 'sillytavern')
  expect(decoded.settingLibrary, '顺序卡应能导入').toBeTruthy()
  return decoded
}

function injectedOrderTitles() {
  return settingInjections({ history: [], settingLibrary: orderedDecoded().settingLibrary }).map((entry) => entry.traceTitle)
}

/**
 * 【空白证据·投影面】与 `.ts` 主文件第 5 层同一个口径：没实现、没判据的项也要有可执行证据。
 * 每条今天**通过**（证明"这个通路今天不存在"），一旦落地就变红。
 */
const PROJECTION_BLANK_WITNESSES = [
  {
    path: 'face:first-turn',
    group: '【还没有入口】整面',
    missing: '首轮对话与启动流程（缺 DSH 运行时 + 本地模型端点）',
    observe: () => {
      const decoded = decodeFixture('v3-full.json').decoded
      expect(decoded.settingLibrary, '夹具应能导入').toBeTruthy()
      // 卡里的 first_mes 被搬成一个 kind: 'opening' 的条目（characterCardFormats.ts:100-114），
      // 但本轮投影会过滤掉 opening（conversation-context.mjs 的 `entry.kind !== 'opening'`）。
      const opening = decoded.settingLibrary.entries.find((entry) => entry.kind === 'opening')
      expect(opening, '卡里应带出一个开场白条目').toBeTruthy()
      expect(opening.content, '开场白正文应有内容，否则这条证据是空的').toContain('PROBE 开场白甲')
      const injected = settingInjections({ history: [], settingLibrary: decoded.settingLibrary })
      expect(injected.map((entry) => entry.id), '开场白条目今天不得进入注入列表').not.toContain(opening.id)
      expect(injected.map((entry) => entry.content).join('\n'), '开场白正文今天不得进入提示词').not.toContain(opening.content)
    }
  },
  {
    path: 'face:insertion-order-projection',
    group: '【还没有入口】位序的行为层',
    missing: 'insertion_order 要真正决定注入顺序：导入侧必须同时把 treeViewOrder 写对（或投影按条目自己的 order 排），'
      + '否则投影按数组下标排——今天就是数组顺序',
    observe: () => {
      // 根因也要一起观察，否则这条证据只说了"看起来是数组顺序"，说不出为什么：
      // 导入侧把 order 与 treeViewOrder 都写成 index + 1（characterCardFormats.ts:199），
      // required 缓存又按 treeViewOrder 排（required-setting-cache.mjs），所以卡里写的 100 / 10 到不了投影。
      const entries = orderedDecoded().settingLibrary.entries.filter((entry) => entry.groupId === 'tavern-world-book')
      expect(entries.map((entry) => [entry.title, entry.order, entry.treeViewOrder]),
        '导入侧今天把 order / treeViewOrder 写成数组下标，而不是 insertion_order')
        .toEqual([['后插入', 1, 1], ['先插入', 2, 2]])
      // 后果：注入顺序 = 数组顺序 ⇒ insertion_order 还没影响行为。
      // 一旦行为层落地（导入侧写对 treeViewOrder，或投影改用条目自己的 order），本证据变红，请转成目标断言。
      expect(injectedOrderTitles(), '插入顺序今天仍与 insertion_order 无关（按数组顺序）')
        .toEqual(['Agent 必读 · 后插入', 'Agent 必读 · 先插入'])
    }
  }
]

describe('【空白证据·投影面】没实现、没判据的项，也必须有可执行证据', () => {
  for (const witness of PROJECTION_BLANK_WITNESSES) {
    it(`${witness.group} · ${witness.path}（缺：${witness.missing}）`, () => {
      witness.observe()
    })
  }
})

describe.skipIf(!enabled)('【R2 目标套件】注入顺序的行为层：今天应当红', () => {
  targetIt('只有 insertion_order 不同的两张卡，注入顺序应不同（酒馆按 insertion_order 决定先后）', () => {
    // 映射层那条在 .ts 主文件里（断言 order 字段）。这条钉行为：投影出来的先后必须由 insertion_order 决定，
    // 而不是数组顺序。今天会红——这就是"字段被断言了，但行为没变"的那一半。
    expect(injectedOrderTitles(), '酒馆按 insertion_order 决定注入先后').toEqual(['Agent 必读 · 先插入', 'Agent 必读 · 后插入'])
  })
})

describe.skipIf(!enabled)('【R2 目标套件·闸门】空白账归零（投影面）', () => {
  targetIt('投影侧的空白面必须清空：有入口后先写成目标断言，再把这条从空白账里删掉', () => {
    expect(PROJECTION_BLANK_WITNESSES.map((witness) => witness.path), '投影侧仍有只有"空白证据"、没有目标判据的面').toEqual([])
  })
})

/**
 * 台账核对：本文件的目标断言条数必须等于 `tavernRedLedger.ts` 的 `COMPANION_TARGETS`。
 *
 * ⚠️ 三轮验证发现的**硬伤**（独立验证 F1）：这条断言原来接在上面那条归零闸的 `expect(...).toEqual([])`
 * **之后**——而归零闸今天必抛（投影侧还有 2 条空白面）⇒ 计数断言**从未执行过**，是死代码。
 * 后果比"期望值写歪"更强：**加**一条 `targetIt` 就能让真实红数 50 与台账/文档的 49 脱钩而全绿。
 * 现在拆成**独立 `it`**，并且**不受开关门控**（`describe.skipIf` 仍会执行定义体，所以两种模式下
 * `registeredTargets` 都是满的；见 `tavern-world-file-target.test.js` 里同样的做法）。
 */
describe('【台账】伴生文件的目标断言条数 == tavernRedLedger.ts（不受开关门控）', () => {
  it('targetIt 注册了几条，台账就必须写几条', () => {
    expect(registeredTargets.length, '本文件目标断言条数与 tavernRedLedger.ts 的 COMPANION_TARGETS 不一致')
      .toBe(COMPANION_TARGETS)
  })
})
