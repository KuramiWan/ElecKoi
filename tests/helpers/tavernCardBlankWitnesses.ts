import { expect } from 'vitest'
import { decodeCharacterCard } from '../../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import type { DecodedCharacterCard } from '../../packages/dsh-product-data/src/domain/characterTransfer/characterTransferTypes'
import { decodeFixture, loadFixture, pngWithChunks } from './tavernCardFixtures'

/**
 * 【空白证据】没实现、没判据的项，**不是靠文字声明**，而是靠一条可执行用例证明"今天确实是空白"。
 *
 * 为什么要有这一层（2026-10-01 的决定）：
 *   `it.todo('extensions.probability —— 缺可注入随机源')` 只是一行账目文字：它不观察任何东西，
 *   也没人能在评审里核实。空白必须**可执行**：
 *     ① 它今天**通过**（证明"这个能力/落点/取值今天不存在"）；
 *     ② 一旦该项被实现，它**变红**（证明"账目被迫更新"），与回归网的双向硬失败同一个手法。
 *
 * 双重保险：
 *   · 值级：夹具给该字段设的值（哨兵）今天在导入结果里找不到；
 *   · 结构级：导入结果里**没有能承载它的字段**（条目的键集合是冻结的），所以换个名字搬进来也会红。
 *
 * 归零闸在 `character-card-fidelity-target.test.ts` 第 5 层：
 *   `blankWitnesses` 必须清空（每条都先实现、再转成目标断言）才可能全绿。
 *   `nonGapWitnesses`（设计如此 / 双方都不读 / 载体不支持）允许留存，但每条必须带公开或 ST 侧依据。
 */

type Entry = NonNullable<DecodedCharacterCard['settingLibrary']>['entries'][number]

export interface BlankWitness {
  /** 清单里的字段路径；`face:` / `class:` 前缀表示"整面"或"整类"而不是单行 */
  path: string
  group: string
  /** 今天为什么是空白：缺什么前置件 */
  missing: string
  fixture: string
  /** 可执行证据（今天必须通过；该项落地后必须变红） */
  observe: (decoded: DecodedCharacterCard) => void
}

export interface NonGapWitness {
  path: string
  group: string
  /** 允许留存的依据（公开声明或 ST 源码），必须是可核实的 */
  basis: string
  fixture: string
  observe: (decoded: DecodedCharacterCard) => void
}

const EXT_FIXTURE = 'v3-worldbook-extensions.json'
const EXT_ENTRY_TITLE = '扩展面 条目'
const BOOK = 'data.character_book.entries[].'

/** 导入后的世界书条目应该**恰好**是这些字段（emptyEntry 的形状）。新增字段 = 有新能力落地。 */
export const IMPORTED_ENTRY_KEYS = [
  'agentReadStrategy', 'agentSelectionHint', 'conditionKeywords', 'content', 'contentMode',
  'createdAt', 'defaultOpeningMessageId', 'dynamicMode', 'enabled', 'groupId', 'iconId', 'id',
  'insertRole', 'keywordCondition', 'keywordIgnoreCase', 'keywordRecursionDepth', 'keywordScanDepth',
  'keywordUseRegex', 'keywordWholeWord', 'keywords', 'kind', 'openingMessages', 'order',
  'position', 'promptPositionId', 'title', 'treeViewOrder', 'triggerMode', 'updatedAt',
  'viewOrder', 'groupViewOrder'
] as const

/** 解码结果里承载"卡里来的东西"的三个信封，字段集合也冻结（信封里没地方放新结构 = 该能力没有入口） */
export const PACKAGE_KEYS = ['assets', 'character', 'regexRules', 'settingLibraryJson', 'variableConfigJson'] as const
export const CHARACTER_KEYS = [
  'frontendBeautyEnabled', 'group', 'imagePrompt', 'name', 'opening', 'profileAge', 'profileBirthday',
  'profileHeight', 'profileLike', 'profileSex', 'showOpening'
] as const
/** 变量配置的信封：`_.set` 之类"运行时可执行规则"没有地方可放（有的话必须先加字段） */
export const VARIABLE_CONFIG_KEYS = [
  'activeVersionId', 'characterId', 'expandedObjectIds', 'initialStateJson', 'name', 'objects',
  'schemaCode', 'variables', 'versions'
] as const

function worldEntries(decoded: DecodedCharacterCard): Entry[] {
  return decoded.settingLibrary?.entries.filter((entry) => entry.id.startsWith('tavern-world-entry-')) ?? []
}

function entryByTitle(decoded: DecodedCharacterCard, title: string): Entry {
  const entry = worldEntries(decoded).find((item) => item.title === title)
  expect(entry, `夹具里应有世界书条目「${title}」`).toBeTruthy()
  return entry as Entry
}

function serialized(decoded: DecodedCharacterCard): string {
  return JSON.stringify(decoded)
}

/** 值级证据：夹具里给该字段设的哨兵今天不在导入结果里 */
function valueAbsent(decoded: DecodedCharacterCard, value: string, why: string): void {
  expect(serialized(decoded).includes(value), why).toBe(false)
}

/** 结构级证据：领域对象里没有这个键（换个名字搬进来也逃不掉上面那条） */
function noKey(target: object, key: string, why: string): void {
  expect(Object.prototype.hasOwnProperty.call(target, key), why).toBe(false)
}

function expectKeys(target: object, keys: readonly string[], what: string): void {
  expect(Object.keys(target).sort(), `${what}的字段集合变了：说明有新能力落地，请把对应空白转成目标断言`).toEqual([...keys].sort())
}

function expectExtensionEntry(decoded: DecodedCharacterCard): Entry {
  const entry = entryByTitle(decoded, EXT_ENTRY_TITLE)
  expectKeys(entry, IMPORTED_ENTRY_KEYS, '导入后的世界书条目')
  return entry
}

/** 扩展面夹具里那条"什么都设了"的条目 —— 12 条暂缓 + 12 条可写 + 3 条设计如此都用它 */
function extensionCheck(check: (entry: Entry, decoded: DecodedCharacterCard) => void): (decoded: DecodedCharacterCard) => void {
  return (decoded) => check(expectExtensionEntry(decoded), decoded)
}

const NOT_A_CARD = '酒馆角色卡必须是 PNG 或 JSON 文件'

/**
 * 必须**归零**的空白账：每条都只有"空白证据"，没有目标判据。
 * 实现一条 → 对应用例变红 → 把它转成目标断言并从本表删除。
 */
export const blankWitnesses: BlankWitness[] = [
  // ── 【暂缓】要等前置件（12）──────────────────────────────────────────────
  {
    path: BOOK + 'extensions.probability', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '可注入的随机源（酒馆在匹配与分组淘汰之后掷一次骰，wi.js:5041-5042）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987651', 'probability 的值今天不应有落点')
      noKey(entry, 'probability', '领域模型里不该有 probability 落点')
    })
  },
  {
    path: BOOK + 'extensions.useProbability', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '同上（probability:100 与 useProbability:false 运行时等价，wi.js:5030）',
    observe: extensionCheck((entry) => noKey(entry, 'useProbability', '领域模型里不该有 useProbability 落点'))
  },
  {
    path: BOOK + 'extensions.group', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '同组只留一个（wi.js:5418/5419/5444/5451）＋可注入随机源',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, 'PROBE-DROP-ext-group', 'group 的值今天不应有落点')
      noKey(entry, 'group', '领域模型里不该有 inclusion group 落点')
    })
  },
  {
    path: BOOK + 'extensions.group_weight', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '权重轮盘（默认权重 100）＋可注入随机源',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987655', 'group_weight 的值今天不应有落点')
      noKey(entry, 'groupWeight', '领域模型里不该有 groupWeight 落点')
    })
  },
  {
    path: BOOK + 'extensions.group_override', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '带 override 的条目按 order 降序取第一（wi.js:5444）',
    observe: extensionCheck((entry) => noKey(entry, 'groupOverride', '领域模型里不该有 groupOverride 落点'))
  },
  {
    path: BOOK + 'extensions.use_group_scoring', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '关键词得分模型（电子爱今天只有布尔命中，wi.js:462-472）',
    observe: extensionCheck((entry) => noKey(entry, 'useGroupScoring', '领域模型里不该有组内计分落点'))
  },
  {
    path: BOOK + 'extensions.sticky', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '运行时激活状态（生效期跳过关键词匹配、且不重掷概率）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987656', 'sticky 的值今天不应有落点')
      noKey(entry, 'sticky', '领域模型里不该有 sticky 落点')
    })
  },
  {
    path: BOOK + 'extensions.cooldown', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '运行时激活状态（粘性结束立刻起冷却，wi.js:518-529）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987657', 'cooldown 的值今天不应有落点')
      noKey(entry, 'cooldown', '领域模型里不该有 cooldown 落点')
    })
  },
  {
    path: BOOK + 'extensions.ignore_budget', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '注入预算功能本身（电子爱没有预算这个概念）',
    observe: extensionCheck((entry) => noKey(entry, 'ignoreBudget', '领域模型里不该有预算豁免落点'))
  },
  {
    path: BOOK + 'extensions.exclude_recursion', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '新语义：递归扫描时跳过本条目（wi.js:4870）',
    observe: extensionCheck((entry) => noKey(entry, 'excludeRecursion', '领域模型里不该有 exclude_recursion 落点'))
  },
  {
    path: BOOK + 'extensions.delay_until_recursion', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '新语义 + 层级（布尔 true ≡ 层级 1，wi.js:4756）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987661', 'delay_until_recursion 的值今天不应有落点')
      noKey(entry, 'delayUntilRecursion', '领域模型里不该有递归时延落点')
    })
  },
  {
    path: BOOK + 'extensions.outlet_name', group: '【暂缓】要等前置件', fixture: EXT_FIXTURE,
    missing: '定"出口"的消费方（ST 侧由前端读 outlet）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, 'PROBE-DROP-ext-outlet', 'outlet_name 的值今天不应有落点')
      noKey(entry, 'outlet', '领域模型里不该有 outlet 落点')
    })
  },

  // ── 【可写未写】落点已清楚，但要改产品代码（12）────────────────────────────
  {
    path: BOOK + 'extensions.prevent_recursion', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '落点已定（keywordRecursionDepth: 0，wi.js:5080/5139-5142），但导入侧没读它',
    observe: extensionCheck((entry) => {
      expect(entry.keywordRecursionDepth, '卡里写了 prevent_recursion，今天的递归深度仍是默认 0').toBe(0)
    })
  },
  {
    path: BOOK + 'position', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: 'ST 8 种位置到电子爱锚点的对应表（wi.js:855-864）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987653', 'position 的值今天不应有落点')
      expect(entry.position, '导入条目的 position 今天恒为 null').toBeNull()
    })
  },
  {
    path: BOOK + 'extensions.position', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '同上（导入时应数字优先，wi.js:5636）',
    observe: extensionCheck((entry) => {
      expect(entry.position, '导入条目的 position 今天恒为 null').toBeNull()
    })
  },
  {
    path: BOOK + 'extensions.depth', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '注入深度（电子爱今天没有这个概念，wi.js:5645）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987652', 'depth 的值今天不应有落点')
      noKey(entry, 'depth', '领域模型里不该有插入深度落点')
    })
  },
  {
    path: BOOK + 'extensions.match_persona_description', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把 persona 文本接进匹配器（wi.js:299-316）',
    observe: extensionCheck((entry) => noKey(entry, 'matchPersonaDescription', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.match_character_description', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把角色描述接进匹配器',
    observe: extensionCheck((entry) => noKey(entry, 'matchCharacterDescription', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.match_character_personality', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把人格接进匹配器',
    observe: extensionCheck((entry) => noKey(entry, 'matchCharacterPersonality', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.match_character_depth_prompt', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把深度提示接进匹配器',
    observe: extensionCheck((entry) => noKey(entry, 'matchCharacterDepthPrompt', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.match_scenario', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把场景接进匹配器',
    observe: extensionCheck((entry) => noKey(entry, 'matchScenario', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.match_creator_notes', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '把作者注释接进匹配器',
    observe: extensionCheck((entry) => noKey(entry, 'matchCreatorNotes', '领域模型里不该有 match_* 落点'))
  },
  {
    path: BOOK + 'extensions.triggers', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '生成类型白名单过滤（wi.js:4807-4813，不需要 STScript）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, 'PROBE-DROP-ext-triggers', 'triggers 的值今天不应有落点')
      noKey(entry, 'triggers', '领域模型里不该有生成类型触发落点')
    })
  },
  {
    path: BOOK + 'extensions.delay', group: '【可写未写】要改产品代码', fixture: EXT_FIXTURE,
    missing: '"聊天至少 N 条"的绝对门槛（wi.js:672）',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987658', 'delay 的值今天不应有落点')
      noKey(entry, 'delay', '领域模型里不该有 delay 落点')
    })
  },

  // ── 【信封 / 无值级判据】不是内容，但同样是已知缺口（4）────────────────────
  {
    path: 'spec', group: '【信封】格式标记', fixture: 'v3-full.json',
    missing: '领域模型里没有承载卡规范版本的位置；要先定"读它来做什么"（解码今天只要求 data 存在）',
    observe: (decoded) => {
      expectKeys(decoded.packageData, PACKAGE_KEYS, '解码信封')
      expectKeys(decoded.packageData.character, CHARACTER_KEYS, '角色基础字段')
      valueAbsent(decoded, 'chara_card_v3', 'spec 的值今天不应有落点')
    }
  },
  {
    path: 'spec_version', group: '【信封】格式标记', fixture: 'v3-full.json',
    missing: '同上；酒馆用它做分支解析，电子爱不读',
    observe: (decoded) => {
      expectKeys(decoded.packageData.character, CHARACTER_KEYS, '角色基础字段')
      noKey(decoded.packageData.character, 'specVersion', '领域模型里不该有 spec_version 落点')
    }
  },
  {
    path: 'data.extensions.depth_prompt.role', group: '【无值级判据】短值', fixture: 'v3-full.json',
    missing: '注入角色是短枚举（0/1/2），没有哨兵；真卡语料 12/13 张带它',
    observe: (decoded) => {
      expectKeys(decoded.packageData, PACKAGE_KEYS, '解码信封')
      noKey(decoded.packageData, 'depthPrompt', '领域模型里不该有 depth_prompt 落点')
      noKey(decoded.packageData.character, 'depthPromptRole', '换个名字搬进来也算落地')
    }
  },
  {
    path: 'data.extensions.fav', group: '【无值级判据】短值', fixture: 'v3-full.json',
    missing: '布尔标记，没有哨兵；且酒馆侧是否读它也未核实',
    observe: (decoded) => {
      expectKeys(decoded.packageData.character, CHARACTER_KEYS, '角色基础字段')
      noKey(decoded.packageData.character, 'fav', '领域模型里不该有 fav 落点')
    }
  },
  {
    path: 'data.extensions.regex_scripts[].trimStrings', group: '【无值级判据】布尔', fixture: 'regex-scripts.json',
    missing: '布尔；ST 侧读取证据在 ST 的 regex 扩展（不在 world-info.js）',
    observe: (decoded) => {
      expect(decoded.regexRules.length, '夹具应至少导入一条正则规则').toBeGreaterThan(0)
      for (const rule of decoded.regexRules) {
        noKey(rule, 'trimStrings', '领域模型里不该有 trimStrings 落点')
        noKey(rule, 'trim_strings', '换个名字搬进来也算落地')
      }
    }
  },

  // ── 【还没有入口】整面（4）────────────────────────────────────────────────
  {
    path: 'face:world-book-source', group: '【还没有入口】整面', fixture: 'v3-full.json',
    missing: '**从世界书一侧进来**的通路完全没有：卡里的 `extensions.world` 不被读（见清单 `data.extensions.world`，P1-1），解码器也没有任何"按名字取一本 worlds/*.json"的入口（`decodeCharacterCard(bytes, format)` 只有两个参数），所以"卡 + 独立世界书"这个最常见的形态今天无从表达',
    observe: (decoded) => {
      valueAbsent(decoded, 'PROBE-DROP-world', 'extensions.world 指向的书名今天不应有落点')
      noKey(decoded.packageData, 'characterBook', '包里今天没有承载"卡指向的世界书"的字段')
    }
  },
  {
    path: 'face:variables-runtime', group: '【还没有入口】整面', fixture: 'mvu-card.json',
    missing: '卡里 `_.set` / `<UpdateVariable>` 的解析与执行（电子爱只有 Agent 工具补丁）',
    observe: (decoded) => {
      const config = decoded.variableConfig
      expect(config, 'mvu 卡应导入出变量配置').toBeTruthy()
      expectKeys(config as object, VARIABLE_CONFIG_KEYS, '变量配置信封')
    }
  },
  {
    path: 'face:carrier-charx', group: '【还没有入口】整面', fixture: 'v3-full.json',
    missing: '`.charx`（zip 容器，酒馆主流导出格式之一）—— 可手写最小 ZIP 造字节后再实现',
    observe: () => {
      const bytes = Uint8Array.from(Buffer.from('PK\u0003\u0004charx-container'))
      expect(() => decodeCharacterCard(bytes, 'sillytavern'), '.charx 今天仍被拒收').toThrow(NOT_A_CARD)
    }
  },
  {
    path: 'face:carrier-webp', group: '【还没有入口】整面', fixture: 'v3-full.json',
    missing: '`.webp`（RIFF 容器）—— 容器支持要先取证 ST 侧行为',
    observe: () => {
      const bytes = Uint8Array.from(Buffer.from('RIFF0000WEBPVP8 '))
      expect(() => decodeCharacterCard(bytes, 'sillytavern'), '.webp 今天仍被拒收').toThrow(NOT_A_CARD)
    }
  },
  {
    path: 'face:ccv3-fallback', group: '【还没有入口】整面', fixture: 'v3-full.json',
    missing: '`ccv3` 块损坏时回退到 `chara`（酒馆侧行为未取证）',
    observe: () => {
      const card = loadFixture('v3-full.json').json
      const broken = pngWithChunks([
        { keyword: 'ccv3', payload: Buffer.from('这不是 JSON').toString('base64') },
        { keyword: 'chara', payload: Buffer.from(JSON.stringify(card)).toString('base64') }
      ])
      expect(() => decodeCharacterCard(broken, 'sillytavern'), 'ccv3 坏了今天不回退到 chara').toThrow()
    }
  }
]

/**
 * 允许留存的"非缺口"：设计如此（有公开依据）、双方都不读、载体不支持。
 * 每条必须有可核实的依据，且同样要有可执行证据（不能只是声明）。
 */
export const nonGapWitnesses: NonGapWitness[] = [
  {
    path: BOOK + 'extensions.display_index', group: '【设计如此】有公开依据', fixture: EXT_FIXTURE,
    basis: 'wi.js:2170-2176：只被编辑器列表与拖拽读，运行时 0 处读取',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, '987660', 'display_index 的值今天不应有落点')
      expect(entry.viewOrder, '导入条目的 viewOrder 今天恒为 0').toBe(0)
    })
  },
  {
    path: BOOK + 'extensions.vectorized', group: '【设计如此】有公开依据', fixture: EXT_FIXTURE,
    basis: 'wi.js 全文无运行时读取；消费方是 ST 的向量扩展',
    observe: extensionCheck((entry) => noKey(entry, 'vectorized', '领域模型里不该有向量化落点'))
  },
  {
    path: BOOK + 'extensions.automation_id', group: '【设计如此】有公开依据', fixture: EXT_FIXTURE,
    basis: 'wi.js 全文无运行时读取；消费方是 Quick Reply 扩展',
    observe: extensionCheck((entry, decoded) => {
      valueAbsent(decoded, 'PROBE-DROP-ext-automation', 'automation_id 的值今天不应有落点')
      noKey(entry, 'automationId', '领域模型里不该有自动化落点')
    })
  },
  {
    path: 'class:unused（10 行）', group: '【双方都不读】不是缺口', fixture: 'v3-full.json',
    basis: '清单 stIgnores：ST 的卡导入路径同样不读这 10 个键（world-info.js 对照见清单每行 stReference）',
    observe: (decoded) => {
      const used = serialized(decoded)
      for (const key of ['character_book.description', 'token_budget', 'recursive_scanning', 'priority', 'character_filter']) {
        expect(used.includes(key), `双方都不读的键 ${key} 不该出现在落点里`).toBe(false)
      }
    }
  },
  {
    path: 'class:unsupported-carrier（6 行）', group: '【载体不支持】字段不可达', fixture: 'v3-full.json',
    basis: 'CONTEXT.md:75 —— 纯 V1 扁平卡整体被拒收，六个 $root 字段无从谈映射',
    observe: () => {
      expect(decodeFixture('v1-flat.json').decoded, 'V1 扁平卡今天仍被拒收').toBeUndefined()
    }
  }
]
