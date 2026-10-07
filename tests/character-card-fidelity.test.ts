import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import { readPngText } from '../packages/dsh-product-data/src/storage/media/PngTextChunkCodec'
import type { DecodedCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterTransferTypes'
import { staticCoverage, tavernCardFields, type TavernFieldExpectation } from './helpers/tavernCardFieldManifest'
import {
  canonicalPaths,
  coverageFor,
  decodeFixture,
  fixtureNames,
  fixturePath,
  loadFixture,
  pngCarrier,
  resolveLanding,
  unexercisedByFixtures,
  valueMapExemptions,
  valuesAt
} from './helpers/tavernCardFixtures'

const fixtures = fixtureNames()
const manifestSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'tavernCardFieldManifest.ts'),
  'utf8'
).split('\n')

/**
 * 自愈式失败信息：给出清单里的行号与改法。
 * 条目路径在清单里写作 `${BOOK}.xxx`，所以按去掉 BOOK 前缀的后缀匹配，并用行首的构造器名消歧。
 */
function manifestLocation(field: TavernFieldExpectation): string {
  const builder = field.status === 'mapped'
    ? field.alignment === 'deviates' ? 'deviates(' : field.alignment === 'st-unread' ? 'stUnread(' : 'mapped('
    : field.stIgnores ? 'unused(' : field.droppedReason === 'unsupported-carrier' ? 'unsupported(' : 'dropped('
  const suffix = field.path.startsWith('data.character_book.entries[]')
    ? field.path.slice('data.character_book.entries[]'.length)
    : field.path
  const index = manifestSource.findIndex((line) => line.includes(builder) && line.includes(suffix))
  return index < 0
    ? 'tests/helpers/tavernCardFieldManifest.ts（未定位到行号）'
    : `tests/helpers/tavernCardFieldManifest.ts:${index + 1}`
}

function reportOf(fixture: string): string {
  const coverage = coverageFor(fixture)
  const label = (coverage.fixture + (coverage.rejected ? ' 拒收' : '')).padEnd(32)
  return [
    label,
    String(coverage.present.length).padStart(4),
    String(coverage.presentMapped).padStart(7),
    String(coverage.presentDropped).padStart(8),
    String(coverage.deviationFailures.length).padStart(6),
    String(coverage.undeclared.length).padStart(7)
  ].join(' ')
}

function decodedFixture(fixture: string): DecodedCharacterCard {
  const { decoded, error } = decodeFixture(fixture)
  if (!decoded) throw new Error(`${fixture} 解码失败：${error ?? '未知原因'}`)
  return decoded
}

type SettingEntry = NonNullable<DecodedCharacterCard['settingLibrary']>['entries'][number]

/** 世界书条目（不含开场白 / 角色描述这两个导入时合成的条目） */
function worldEntries(fixture: string): SettingEntry[] {
  const library = decodedFixture(fixture).settingLibrary
  if (!library) throw new Error(`${fixture} 没有设定库`)
  return library.entries.filter((entry) => entry.id.startsWith('tavern-world-entry-'))
}

describe('酒馆角色卡导入的字段映射覆盖率（仅主进程导入路径，不含渲染层独立世界书导入）', () => {
  it('夹具里出现的字段都在清单里声明过', () => {
    const problems: string[] = []
    for (const fixture of fixtures) {
      const { undeclared } = coverageFor(fixture)
      for (const path of undeclared) problems.push(`${fixture}: ${path}`)
    }
    expect(problems, `以下字段出现在夹具里但清单未声明，请在 tavernCardFieldManifest.ts 补上：\n${problems.join('\n')}`)
      .toEqual([])
  })

  it('mapped 字段在主进程导入路径上都有可观察落点', () => {
    const problems: string[] = []
    for (const fixture of fixtures) {
      for (const failure of coverageFor(fixture).mappedFailures) {
        const field = tavernCardFields.find((item) => item.path === failure.path)
        problems.push(`${fixture}: ${failure.path} → 落点 ${failure.landing} 解析不到（清单 ${field ? manifestLocation(field) : '?'}）`)
      }
    }
    expect(problems, `清单声明这些字段被读取，但结果里找不到落点：\n${problems.join('\n')}`).toEqual([])
  })

  it('dropped 字段没有被读取（值级哨兵扫描）', () => {
    const problems: string[] = []
    for (const fixture of fixtures) {
      for (const failure of coverageFor(fixture).droppedFailures) {
        const field = tavernCardFields.find((item) => item.path === failure.path)
        problems.push(
          `${fixture}: ${failure.path} 的哨兵 "${failure.sentinel}" 出现在导入结果里——修复可能已经落地。`
          + `\n    请打开 ${field ? manifestLocation(field) : '?'}，把 dropped(...) 改成 mapped(..., '<落点路径>') 并补 alignment。`
        )
      }
    }
    expect(problems, `以下字段按清单应为 dropped，但结果里出现了它们的值：\n${problems.join('\n')}`).toEqual([])
  })

  it('valueMap 豁免只给平坦的标量字典', () => {
    const problems: string[] = []
    for (const fixture of fixtures) {
      for (const path of coverageFor(fixture).valueMapViolations) {
        problems.push(
          `${fixture}: ${path} 下面出现了嵌套结构。`
          + '\n    valueMap 只豁免"键名是数据、值是标量"的字典：'
          + '要么把结构化的键逐条声明进清单，要么去掉这行的 valueMap 标记。'
        )
      }
    }
    expect(problems, `以下被豁免的扩展袋里放了结构，等于绕过了"未声明字段硬失败"：\n${problems.join('\n')}`).toEqual([])
  })

  it('deviates 字段的当前落点值与清单记录一致', () => {
    const problems: string[] = []
    for (const fixture of fixtures) {
      for (const failure of coverageFor(fixture).deviationFailures) {
        const field = tavernCardFields.find((item) => item.path === failure.path)
        problems.push(
          `${fixture}: ${failure.path} 的落点值不再包含 ${failure.observed}（实际：${failure.actual}）。`
          + `\n    若语义已与 ST 对齐，请把 ${field ? manifestLocation(field) : '?'} 改成 mapped(...) + alignment: 'aligned'；否则更新 deviation.observed。`
        )
      }
    }
    expect(problems, `以下 deviates 字段的现状与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('打印字段映射覆盖率报告', () => {
    const lines: string[] = []
    lines.push('字段映射覆盖率（夹具口径）')
    lines.push('夹具'.padEnd(30) + ' 字段  mapped  dropped  分歧  未声明')
    let presentMapped = 0
    let presentDropped = 0
    let sentinelChecked = 0
    let declarationOnly = 0
    let valueMapViolations = 0
    const declarationOnlyPaths = new Map<string, string[]>()
    for (const fixture of fixtures) {
      const coverage = coverageFor(fixture)
      presentMapped += coverage.presentMapped
      presentDropped += coverage.presentDropped
      sentinelChecked += coverage.sentinelChecks
      declarationOnly += coverage.declarationOnly.length
      valueMapViolations += coverage.valueMapViolations.length
      for (const path of coverage.declarationOnly) {
        declarationOnlyPaths.set(path, [...(declarationOnlyPaths.get(path) ?? []), fixture])
      }
      lines.push(reportOf(fixture))
    }
    const reference = staticCoverage()
    const occurrences = presentMapped + presentDropped
    lines.push('')
    lines.push(`主数（夹具口径，按出现次数加权）：mapped ${presentMapped} / ${occurrences} = ${((presentMapped / occurrences) * 100).toFixed(1)}%`)
    lines.push(`参考数（清单静态口径，按行去重）：mapped ${reference.mapped} / 共 ${reference.total} = ${((reference.mapped / reference.total) * 100).toFixed(1)}%`)
    lines.push(`dropped 值级哨兵扫描覆盖：${sentinelChecked} / ${presentDropped}（其余 ${declarationOnly} 条只有声明级，没有可扫的值）`)
    lines.push(`  这些字段的值太短或为布尔，扫不到"修复已落地"：`)
    for (const [path, names] of [...declarationOnlyPaths].sort((left, right) => right[1].length - left[1].length)) {
      lines.push(`    - ${path}（${names.join('、')}）`)
    }
    const exemptions = valueMapExemptions()
    lines.push(`被 valueMap 豁免的行（${exemptions.length} 条，其下的键不再逐条声明，只靠值级哨兵兜底）：`)
    for (const item of exemptions) lines.push(`  - ${item.path}（${item.status}）`)
    // `stIgnores` 是"双方都不读"的声明行，它们**不需要**被夹具演练；只有需要判据的行漏演练才是问题
    const unexercised = unexercisedByFixtures(fixtures).filter((field) => !field.stIgnores)
    const declaredNonGaps = tavernCardFields.filter((field) => field.stIgnores).length
    const stReadable = tavernCardFields.length - declaredNonGaps
    lines.push(`参考数的另一种读法：在**酒馆会读**的字段里 mapped ${reference.mapped} / ${stReadable} = ${((reference.mapped / stReadable) * 100).toFixed(1)}%（分母已排除 ${declaredNonGaps} 条"双方都不读"的声明行）`)
    lines.push(`清单里需要演练、但没有任何夹具演练到的行（${unexercised.length} / ${tavernCardFields.length} 条，已排除"双方都不读"的声明行）：`)
    for (const field of unexercised) lines.push(`  - ${field.path}（${field.status}）`)
    console.log(`\n${lines.join('\n')}\n`)

    expect(fixtures.length).toBeGreaterThan(0)
    expect(reference.mapped).toBeGreaterThan(0)
    expect(reference.mapped).toBeLessThan(reference.total)

    // 主数是 CI 断言的那一个，参考数只打印。基准取清单静态口径：
    // 夹具的意义是验证"能落地的字段真的落地了"，所以实际出现的字段里能落地的比例
    // 不该低于清单里 mapped 的占比；低于它说明新加的夹具只在放大"未映射面"。
    const mainRatio = presentMapped / occurrences
    const referenceRatio = reference.mapped / reference.total
    expect(mainRatio, `主数 ${(mainRatio * 100).toFixed(1)}% 低于参考数 ${(referenceRatio * 100).toFixed(1)}%`)
      .toBeGreaterThanOrEqual(referenceRatio)
    // 每个出现在夹具里的 dropped 字段都要么被值级扫描、要么被记为声明级、要么是豁免袋的形状违规
    expect(sentinelChecked + declarationOnly + valueMapViolations).toBe(presentDropped)
    for (const fixture of fixtures) {
      const coverage = coverageFor(fixture)
      if (coverage.rejected) continue
      expect(coverage.presentMapped, `${fixture} 没有验证任何 mapped 字段`).toBeGreaterThan(0)
    }
  })

  it('清单里的落点语法自身可用（对每个 mapped 字段都能构造解析）', () => {
    const { decoded } = decodeFixture('v3-full.json')
    expect(decoded).toBeTruthy()
    const missingLanding = tavernCardFields.filter((field) => field.status === 'mapped' && !field.landing)
    expect(missingLanding.map((field) => field.path), 'mapped 行必须给出落点').toEqual([])
    for (const field of tavernCardFields) {
      const landing = field.landing
      if (field.status !== 'mapped' || !landing) continue
      expect(() => resolveLanding(decoded, landing), `${field.path} → ${landing}`).not.toThrow()
    }
    expect(canonicalPaths(loadFixture('v3-full.json').json).length).toBeGreaterThan(0)
  })
})

/**
 * 字段映射之外的少量定性断言：载体形态（拒收 / 条目容器）与几处内容变换。
 * 这些不是"演出保真"——只固定当前导入行为，改动应当让这里变红并被人读到。
 */
describe('不被接受的载体', () => {
  const card = loadFixture('v3-full.json').json
  const notACard = '酒馆角色卡必须是 PNG 或 JSON 文件'

  it('.charx（zip 容器）被拒收', () => {
    expect(() => decodeCharacterCard(Uint8Array.from(Buffer.from('PK\u0003\u0004charx-container')), 'sillytavern'))
      .toThrow(notACard)
  })

  it('.webp（RIFF 容器）被拒收', () => {
    expect(() => decodeCharacterCard(Uint8Array.from(Buffer.from('RIFF0000WEBPVP8 ')), 'sillytavern'))
      .toThrow(notACard)
  })

  it('不以 { 开头的伪 JSON 文本被拒收', () => {
    expect(() => decodeCharacterCard(new TextEncoder().encode('这不是 JSON'), 'sillytavern'))
      .toThrow(notACard)
  })

  it('只有 iTXt 文本块的 PNG 拿不到卡数据，tEXt 的对照能拿到', () => {
    expect(decodeCharacterCard(pngCarrier(card, 'chara'), 'sillytavern').packageData.character.name)
      .toBe('PROBE 完整卡')
    expect(() => decodeCharacterCard(pngCarrier(card, 'chara', 'iTXt'), 'sillytavern'))
      .toThrow('图片里没有酒馆角色卡数据')
  })
})

describe('载体形态与内容变换（定性断言）', () => {
  it('V1 扁平卡被拒收，且是唯一被拒收的夹具', () => {
    const rejected = fixtures.filter((fixture) => coverageFor(fixture).rejected)
    expect(rejected).toEqual(['v1-flat.json'])
    expect(coverageFor('v1-flat.json').rejected).toContain('酒馆角色卡缺少角色数据')
  })

  it('世界书条目容器的数组与对象形态都能导入，顺序与重名可预测', () => {
    expect(worldEntries('v3-worldbook-array.json').map((entry) => entry.title))
      .toEqual(['重名条目', '重名条目 (2)', '关闭条目', '常驻条目', '缺省 enabled 条目', 'disable 条目'])
    // entries 写成对象时：数字键升序，非数字键排最后
    expect(worldEntries('v3-worldbook-object.json').map((entry) => entry.title))
      .toEqual(['第一条', '第二条', '第十条', '非数字键条'])
  })

  it('关闭的条目落成 enabled: false，常驻条目落成 required 且不带关键词', () => {
    const entries = worldEntries('v3-worldbook-array.json')
    const closed = entries.find((entry) => entry.title === '关闭条目')
    const constant = entries.find((entry) => entry.title === '常驻条目')
    expect(closed?.enabled).toBe(false)
    expect(constant?.agentReadStrategy).toBe('required')
    expect(constant?.keywords).toEqual([])
  })

  it('enabled 的缺省值是 deviates：ElecKoi 缺 enabled 即启用，ST 会停用', () => {
    const entries = worldEntries('v3-worldbook-array.json')
    // ElecKoi characterCardFormats.ts:371 缺 enabled ⇒ 启用；
    // ST wi.js:5640 `disable: !entry.enabled` 缺 enabled ⇒ 停用。缺省值相反（清单该行 alignment: 'deviates'）。
    expect(entries.find((entry) => entry.title === '缺省 enabled 条目')?.enabled).toBe(true)
    // ElecKoi 还会读 disable（只在没有 enabled 时），ST 的卡导入不读这个键
    expect(entries.find((entry) => entry.title === 'disable 条目')?.enabled).toBe(false)
  })

  it('summary 的计数与世界书 / 开场白 / 正则 / 变量条数一致', () => {
    expect(decodedFixture('v3-full.json').summary).toBe('剧情小说模式 · 世界书 2 · 开场白 2 · 正则 1 · 变量 0')
  })

  it('MVU：显式变量、schema 脚本与更新规则都能导入，_.set 不产生变量', () => {
    const config = decodedFixture('mvu-card.json').variableConfig
    expect(config?.variables.map((item) => item.title)).toEqual(['好感度', '阶段'])
    expect(config?.variables.find((item) => item.title === '好感度')?.updateRule).toContain('PROBE-MVU-check')
    expect(config?.initialStateJson).toContain('100001')
    // [initvar] / [mvu_update] 是 MVU 基础设施条目，不进设定库
    expect(worldEntries('mvu-card.json').map((entry) => entry.title)).toEqual(['变量普通条目'])
  })

  it('EJS 控制器与 getwi 引用被识别成 ejs / ejs_reference，TavernHelper 不执行', () => {
    const decoded = decodedFixture('frontend-card.json')
    const entries = worldEntries('frontend-card.json')
    expect(entries.find((entry) => entry.title === 'EJS 控制器')?.contentMode).toBe('ejs')
    expect(entries.find((entry) => entry.title === '前端材料条目')?.dynamicMode).toBe('ejs_reference')
    expect(decoded.variableConfig).toBeUndefined()
  })

  it('非法正则整条丢弃，合法规则的全部开关都落到规则上', () => {
    const rules = decodedFixture('regex-scripts.json').regexRules
    expect(rules.map((rule) => rule.name)).toEqual(['合法替换'])
    expect(rules[0]).toMatchObject({
      targets: ['UserInput', 'AiOutput', 'SlashCommand', 'SettingContent', 'Reasoning'],
      enabled: true,
      displayOnly: true,
      promptOnly: false,
      runOnEdit: true
    })
  })
})

/** 把一个对象里所有字符串值原样收集起来（不转义），用于"源头有、结果里没有"的比对 */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim().length >= 12) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out)
  }
  return out
}

/**
 * 语料画像用的**结构**检测器：卡里有没有把世界书条目键写成 `/…/flags` 形态。
 *
 * ⚠️ 2026-10-05 修：第一版是一句对 `JSON.stringify` 结果的正则
 * （`/\/keys\/?\s*:\s*\[\s*"\//`），它要求 `keys` **前面**有一个字面 `/`——而 JSON 里键名前面是 `"`
 * ⇒ 结构上永远匹配不到，于是"keys 写成 /…/ 形态 0"是一句**假零**（独立评审 E-2 发现并实测：
 * 语料里其实有 82 条）。现在按结构走：只在 `key` / `keys` / `secondary_keys` / `keysecondary`
 * 这些数组里看字符串值，并且要真的像 `/…/flags`。
 *
 * 这个函数不依赖语料目录，所以它自己有自检用例（见下面"语料发现器自检"），坏掉会当场红，
 * 而不是靠"跑一次语料看看数"。
 */
const KEY_ARRAY_NAMES = new Set(['key', 'keys', 'secondary_keys', 'keysecondary'])
const SLASH_DELIMITED = /^\/(?:[^/\\]|\\.)+\/[dgimsuvy]*$/

export function slashKeyStats(json: unknown): { entries: number; keys: number } {
  let entries = 0
  let keys = 0
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [name, item] of Object.entries(value)) {
      if (KEY_ARRAY_NAMES.has(name) && Array.isArray(item)) {
        const hits = item.filter((entry) => typeof entry === 'string' && SLASH_DELIMITED.test(entry))
        if (hits.length) {
          entries += 1
          keys += hits.length
        }
        continue
      }
      walk(item)
    }
  }
  walk(json)
  return { entries, keys }
}

const corpus = process.env.ELECKOI_TAVERN_CARD_CORPUS?.trim()

/**
 * 从 PNG 里取出卡 JSON：与生产解码路径同一个读法（`ccv3` 优先、再 `chara`，base64 或裸 JSON）。
 * 有了它，语料通道才能对 **PNG 卡**（酒馆卡的主流载体）做字段枚举——否则它只解得出"能导入"。
 */
function cardJsonFromFile(bytes: Uint8Array): unknown {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const chunks = readPngText(bytes)
    const encoded = chunks.get('ccv3')?.trim() || chunks.get('chara')?.trim()
    if (!encoded) return undefined
    const text = encoded.startsWith('{') ? encoded : Buffer.from(encoded, 'base64').toString('utf8')
    try { return JSON.parse(text) } catch { return undefined }
  }
  const text = new TextDecoder().decode(bytes).trim()
  if (!text.startsWith('{')) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

/**
 * 语料发现器的自检：**不依赖语料目录**，所以默认模式也跑。
 *
 * 起因：`withSlashKeys` 曾经只有一个坏正则驱动，坏了好几个月没人知道（它只被打印、
 * 从没被断言）。检测器本身是"发现器"的仪器，仪器必须有校准——这里用一份内联 JSON 钉住它。
 */
describe('语料发现器自检（/…/flags 键检测）', () => {
  it('SLASH_DELIMITED / slashKeyStats 能认出结构上的正则键，且不误报', () => {
    const withRegexKeys = {
      data: {
        character_book: {
          entries: [
            { keys: ['/^PROBE-REGEX-\\d+$/i'], content: 'a' },
            { key: ['PROBE-PLAIN'], secondary_keys: ['/^(A|B)$/'], content: 'b' },
            { key: ['plain', 'also/not/regex', '/unterminated'], content: 'c' }
          ]
        }
      }
    }
    expect(slashKeyStats(withRegexKeys), '两条正则键应被认出（条目 2、键 3）').toEqual({ entries: 2, keys: 2 })
    // 反向：普通字符串键、含 `/` 但不以 `/` 开头、只有一个 `/` 的，都不算
    expect(slashKeyStats({ entries: [{ key: ['a/b', '/', 'PROBE-PLAIN'] }] })).toEqual({ entries: 0, keys: 0 })
    // 顶层 `keys` 也是被扫的名字（卡规范键名形态）
    expect(slashKeyStats({ keys: ['/x/i'] })).toEqual({ entries: 1, keys: 1 })
    // 关键回归：第一版那句正则对同一份 JSON 是**恒定 false**（这就是"假零"的成因）
    const text = JSON.stringify(withRegexKeys)
    expect(/\/keys\/?\s*:\s*\[\s*"\//.test(text), '旧正则恒 false —— 保留这句是为了钉住"假零"的成因').toBe(false)
  })
})

describe.skipIf(!corpus)('真实卡语料通道（发现器：只报告，永不失败）', () => {
  it('结构画像、清单盲区、缺口命中率与疑似丢失', () => {
    const directory = corpus as string
    const manifest = new Set(tavernCardFields.map((field) => field.path))
    const mappedFields = tavernCardFields.filter((field) => field.status === 'mapped')
    const files = readdirSync(directory)
      .filter((name) => !name.includes(':Zone.Identifier') && !name.startsWith('.'))
      .sort()
    // 清单声明的扩展命名空间：`data.extensions.<ns>` 与 `entries[].extensions.<ns>`
    // 落在**已知**命名空间下的新键是结构化盲区（要补清单行）；整个命名空间都没声明的是第三方扩展袋
    // （数量无界，聚合报告即可——否则每次跑真实卡都是几十行噪声）。
    const knownNamespaces = new Set<string>()
    for (const field of tavernCardFields) {
      const dataMatch = /^data\.extensions\.([^.\[]+)/.exec(field.path)
      if (dataMatch?.[1]) knownNamespaces.add(`data.extensions.${dataMatch[1]}`)
    }
    function classify(path: string): { kind: 'structured' } | { kind: 'third-party'; namespace: string } {
      const dataMatch = /^data\.extensions\.([^.\[]+)/.exec(path)
      if (dataMatch?.[1] && !knownNamespaces.has(`data.extensions.${dataMatch[1]}`)) {
        return { kind: 'third-party', namespace: `data.extensions.${dataMatch[1]}` }
      }
      // 条目级 extensions 是**扁平的**自由袋（键本身就是字段名，没有命名空间层级）：
      // 清单声明的是 wi.js 会读的那些键，其余一律算"开放袋"，聚合成一行即可。
      if (/^data\.character_book\.entries\[\]\.extensions\./.test(path)) {
        return { kind: 'third-party', namespace: 'entries[].extensions.*（条目级扩展袋）' }
      }
      return { kind: 'structured' }
    }
    const undeclared = new Map<string, number>()
    const thirdPartyBags = new Map<string, number>()
    const gapHits = new Map<string, number>()
    const mappedMissing = new Map<string, number>()
    const carriers = new Map<string, number>()
    const rejectedList: { file: string; reason: string }[] = []
    const structure = {
      total: 0, decoded: 0, rejected: 0, unreadable: 0,
      withBook: 0, withBookEntries: 0, entryCount: 0, withMvu: 0, withRegex: 0,
      withExternalWorld: 0, withEjsController: 0, withGetwi: 0, withSlashKeys: 0,
      slashKeyEntries: 0, slashKeyCount: 0, withAssets: 0, firstMesOnly: 0, v1Flat: 0
    }

    for (const file of files) {
      structure.total += 1
      const extension = file.toLowerCase().slice(file.lastIndexOf('.'))
      carriers.set(extension, (carriers.get(extension) ?? 0) + 1)
      const bytes = new Uint8Array(readFileSync(join(directory, file)))
      const json = cardJsonFromFile(bytes)

      let decoded: DecodedCharacterCard | undefined
      try {
        decoded = decodeCharacterCard(bytes, 'sillytavern')
        structure.decoded += 1
      } catch (error) {
        structure.rejected += 1
        rejectedList.push({ file, reason: error instanceof Error ? error.message : String(error) })
        continue
      }

      if (!json) {
        structure.unreadable += 1
        continue
      }
      const text = JSON.stringify(json)
      if (text.includes('"character_book"')) structure.withBook += 1
      if (text.includes('tavern_helper')) structure.withMvu += 1
      if (text.includes('regex_scripts')) structure.withRegex += 1
      if (text.includes('"assets"')) structure.withAssets += 1
      if (text.includes('<%')) structure.withEjsController += 1
      if (text.includes('getwi')) structure.withGetwi += 1
      const slash = slashKeyStats(json)
      if (slash.entries) structure.withSlashKeys += 1
      structure.slashKeyEntries += slash.entries
      structure.slashKeyCount += slash.keys
      const book = (json as { data?: { character_book?: { entries?: unknown[] }; extensions?: { world?: unknown } } }).data
      if (book?.character_book) {
        const entries = book.character_book.entries
        if (Array.isArray(entries)) {
          structure.withBookEntries += 1
          structure.entryCount += entries.length
        }
      }
      if (book?.extensions?.world) structure.withExternalWorld += 1
      if (!(json as { data?: unknown }).data) structure.v1Flat += 1
      const root = json as { data?: { first_mes?: unknown } }
      if (root.data && !book?.character_book && root.data.first_mes) structure.firstMesOnly += 1

      const present = new Set(canonicalPaths(json))
      for (const path of present) {
        if (manifest.has(path)) continue
        const verdict = classify(path)
        if (verdict.kind === 'third-party') thirdPartyBags.set(verdict.namespace, (thirdPartyBags.get(verdict.namespace) ?? 0) + 1)
        else undeclared.set(path, (undeclared.get(path) ?? 0) + 1)
      }
      for (const field of tavernCardFields) {
        if (field.status !== 'dropped' || field.stIgnores) continue
        if (present.has(field.path)) gapHits.set(field.path, (gapHits.get(field.path) ?? 0) + 1)
      }
      // 疑似丢失：清单说"读到了"，而卡里那段够长的文本在解码结果里找不到。
      // 必须比对**原始字符串值**，不能比对 JSON.stringify：正文里的真实换行会被转义成 \n，
      // 那样凡是带换行的文本都会被误报成"丢了"（第一版就踩了这个坑）。
      const decodedText = collectStrings(decoded).join('\n')
      for (const field of mappedFields) {
        for (const value of valuesAt(json, field.path)) {
          if (typeof value !== 'string' || value.trim().length < 12) continue
          if (value.includes('{{')) continue
          if (!decodedText.includes(value)) mappedMissing.set(field.path, (mappedMissing.get(field.path) ?? 0) + 1)
        }
      }
    }

    const gapRows = [...gapHits.entries()].sort((left, right) => right[1] - left[1])
    const neverSeen = tavernCardFields
      .filter((field) => field.status === 'dropped' && !field.stIgnores && !gapHits.has(field.path))
      .map((field) => field.path)
    const lines = [
      `语料目录：${directory}`,
      `文件 ${structure.total}（载体：${[...carriers.entries()].map(([extension, count]) => `${extension}×${count}`).join('、')}）`
        + ` · 成功导入 ${structure.decoded} · 拒收 ${structure.rejected} · 取不到 JSON ${structure.unreadable}`,
      `含卡内世界书 ${structure.withBook}（其中条目可枚举 ${structure.withBookEntries}，条目合计 ${structure.entryCount}）`
        + ` · 含 MVU ${structure.withMvu} · 含正则 ${structure.withRegex} · 含素材 ${structure.withAssets}`,
      `卡里写了 extensions.world（指向独立世界书）${structure.withExternalWorld} —— 这类卡的独立世界书今天不在测量面内`,
      `含 EJS 控制器(<%) ${structure.withEjsController} · 含 getwi ${structure.withGetwi}`
        + ` · 键写成 /…/flags 形态：${structure.withSlashKeys} 张卡 / ${structure.slashKeyEntries} 个条目 / ${structure.slashKeyCount} 条键`,
      `V1 扁平卡（无 data）${structure.v1Flat} · 只有 first_mes 没别的 ${structure.firstMesOnly}`,
      ...rejectedList.slice(0, 10).map((item) => `   [拒收] ${item.file} —— ${item.reason}`),
      '',
      `① 结构化盲区：语料里出现、清单未声明、且落在**已知命名空间**下的字段路径 ${undeclared.size} 条（这些要补进清单）`,
      ...[...undeclared.entries()].sort((left, right) => right[1] - left[1]).slice(0, 40).map(([path, count]) => `   - ${path} ×${count} 张`),
      undeclared.size === 0 ? '   （没有——清单在这批卡上是闭合的）' : '',
      '',
      `①b 第三方扩展袋：${thirdPartyBags.size} 个未声明的扩展命名空间（数量无界，聚合报告；不影响兼容结论）`,
      ...[...thirdPartyBags.entries()].sort((left, right) => right[1] - left[1]).map(([namespace, count]) => `   - ${namespace} ×${count} 个键`),
      '',
      `② 已知缺口在真实卡里的命中率（前 30，决定修复优先级）`,
      ...gapRows.slice(0, 30).map(([path, count]) => `   - ${path} ×${count} 张`),
      gapRows.length === 0 ? '   （这批卡没有出现任何已知缺口字段）' : '',
      '',
      `③ 这批卡没出现过的已知缺口字段 ${neverSeen.length} 条（清单里可能有"真实卡用不上"的行）`,
      `   ${neverSeen.slice(0, 20).join('、')}${neverSeen.length > 20 ? ' …' : ''}`,
      '',
      `④ 疑似丢失（清单说 mapped，卡里的长文本在导入结果里找不到）：${mappedMissing.size} 条`,
      ...[...mappedMissing.entries()].sort((left, right) => right[1] - left[1]).slice(0, 20).map(([path, count]) => `   - ${path} ×${count}`)
    ].filter((line) => line !== '')
    console.log(`\n${lines.join('\n')}\n`)
    expect(fixturePath('v3-full.json')).toContain('tavern-cards')
  })
})
