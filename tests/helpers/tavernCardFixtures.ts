import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeCharacterCard } from '../../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import type { DecodedCharacterCard } from '../../packages/dsh-product-data/src/domain/characterTransfer/characterTransferTypes'
import { tavernCardFields, type TavernFieldExpectation } from './tavernCardFieldManifest'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(here, '..', 'fixtures', 'tavern-cards')

/**
 * 清单里标了 `valueMap` 的路径是「用户数据字典」：键名是数据不是结构，不再下钻。
 * 唯一真相仍在清单里，harness 只是执行它的声明。
 */
const declaredValueMaps = tavernCardFields.filter((field) => field.valueMap)

/** 被 valueMap 豁免的行：它们下面的键不再逐条声明，必须在报告里可见 */
export function valueMapExemptions(): { path: string; status: TavernFieldExpectation['status'] }[] {
  return declaredValueMaps.map((field) => ({ path: field.path, status: field.status }))
}

/**
 * `character_book.entries` 写成**对象映射**时，规范化路径也按 `[]` 记。
 *
 * 理由在 ElecKoi 侧不在 ST 侧：解码器的 `worldBookEntries()` 把两种形态当同一种读
 * （characterCardFormats.ts:352-358，数字键升序、非数字键排后）；ST 的卡导入写的是
 * `characterBook.entries.forEach(...)`（wi.js:5620），碰上对象会直接抛错。所以这条是
 * **度量 ElecKoi 的额外宽容度**；代价是清单里看不出某个夹具用的是数组还是对象映射。
 */
const ENTRY_MAP_PATH = 'data.character_book.entries'

/** 落点语法里的选择器：无 / 任意元素 / 键值筛选 */
type Selector = { kind: 'none' } | { kind: 'any' } | { kind: 'predicate'; key: string; value: string }

interface Segment {
  prop: string
  selector: Selector
}

export interface FixtureCoverage {
  fixture: string
  /** 夹具里出现的叶子路径 */
  present: string[]
  /** 夹具里出现但清单没声明的路径（硬失败） */
  undeclared: string[]
  /** mapped 字段的落点解析不到（硬失败） */
  mappedFailures: { path: string; landing: string }[]
  /** dropped 字段的哨兵出现在结果里（硬失败：修复已落地，请改清单） */
  droppedFailures: { path: string; sentinel: string }[]
  /** deviates 字段的当前值与清单不符（硬失败：请更新清单） */
  deviationFailures: { path: string; observed: string; actual: string }[]
  /** 夹具里出现的、清单声明为 mapped 的字段数（主数的分子） */
  presentMapped: number
  /** 夹具里出现的、清单声明为 dropped 的字段数（主数的分母另一半） */
  presentDropped: number
  /** dropped 字段：做过的值级哨兵扫描数 */
  sentinelChecks: number
  /** dropped 字段：仅声明级（布尔或短值，无法做哨兵） */
  declarationOnly: string[]
  /** dropped 的 valueMap 行里出现了嵌套结构（该豁免只允许平坦标量字典） */
  valueMapViolations: string[]
  /** 解码被拒收时填这里（V1 扁平卡等） */
  rejected?: string
}

export function fixtureNames(): string[] {
  if (!existsSync(fixtureRoot)) return []
  return readdirSync(fixtureRoot).filter((name) => name.endsWith('.json')).sort()
}

export function fixturePath(name: string): string {
  return join(fixtureRoot, name)
}

export function loadFixture(name: string): { json: unknown; bytes: Uint8Array } {
  const json: unknown = JSON.parse(readFileSync(fixturePath(name), 'utf8'))
  return { json, bytes: new TextEncoder().encode(JSON.stringify(json)) }
}

/** 合成一个只带一个文本块的 PNG（仓库的 readPngText 只认 tEXt，且不校验 CRC） */
export function pngCarrier(json: unknown, keyword: string, chunkType = 'tEXt'): Uint8Array {
  const payload = Buffer.from(JSON.stringify(json)).toString('base64')
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const text = Uint8Array.from(Buffer.from(`${keyword}\0${payload}`, 'latin1'))
  const chunk = new Uint8Array(text.length + 12)
  new DataView(chunk.buffer).setUint32(0, text.length, false)
  chunk.set(new TextEncoder().encode(chunkType), 4)
  chunk.set(text, 8)
  return concat([signature, chunk, chunkWithType('IEND', new Uint8Array())])
}

/** 合成一个带**多个** tEXt 文本块的 PNG（用于「ccv3 坏块 + chara 好块」这类对照） */
export function pngWithChunks(chunks: { keyword: string; payload: string }[]): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts: Uint8Array[] = [signature]
  for (const { keyword, payload } of chunks) {
    const text = Uint8Array.from(Buffer.from(`${keyword}\0${payload}`, 'latin1'))
    const chunk = new Uint8Array(text.length + 12)
    new DataView(chunk.buffer).setUint32(0, text.length, false)
    chunk.set(new TextEncoder().encode('tEXt'), 4)
    chunk.set(text, 8)
    parts.push(chunk)
  }
  parts.push(chunkWithType('IEND', new Uint8Array()))
  return concat(parts)
}

function chunkWithType(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12)
  new DataView(result.buffer).setUint32(0, data.length, false)
  result.set(new TextEncoder().encode(type), 4)
  result.set(data, 8)
  return result
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** 夹具的叶子路径集合。无 data 的 V1 扁平卡整体挂到 $root 前缀下 */
export function canonicalPaths(value: unknown): string[] {
  const root = isRecord(value) && isRecord(value.data) ? value : undefined
  const prefix = root ? '' : '$root'
  const found = new Set<string>()
  walk(value, prefix, found)
  return [...found].sort()
}

function walk(value: unknown, prefix: string, found: Set<string>): void {
  if (declaredValueMaps.some((field) => field.path === prefix)) {
    found.add(prefix)
    return
  }
  if (Array.isArray(value)) {
    const objects = value.filter(isRecord)
    if (objects.length) {
      for (const item of objects) walk(item, `${prefix}[]`, found)
      return
    }
    found.add(prefix)
    return
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (!entries.length) return
    if (prefix === ENTRY_MAP_PATH && entries.every(([, item]) => isRecord(item))) {
      for (const [, item] of entries) walk(item, `${prefix}[]`, found)
      return
    }
    for (const [key, item] of entries) walk(item, prefix ? `${prefix}.${key}` : key, found)
    return
  }
  found.add(prefix)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 按清单里的落点语法解析，返回所有命中的值 */
export function resolveLanding(root: unknown, landing: string): unknown[] {
  return resolve(root, landing.split('.').map(parseSegment))
}

function resolve(value: unknown, segments: Segment[]): unknown[] {
  const head = segments[0]
  if (!head) return [value]
  const rest = segments.slice(1)
  const properties = head.prop ? readProperty(value, head.prop) : [value]
  return select(properties, head.selector).flatMap((item) => resolve(item, rest))
}

function readProperty(value: unknown, prop: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => readProperty(item, prop))
  if (isRecord(value)) return Object.hasOwn(value, prop) ? [value[prop]] : []
  return []
}

function select(values: unknown[], selector: Selector): unknown[] {
  if (selector.kind === 'none') return values
  if (selector.kind === 'any') return values.flatMap((value) => (Array.isArray(value) ? value : []))
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter((item) => isRecord(item) && String(item[selector.key]) === selector.value)
    }
    return isRecord(value) && String(value[selector.key]) === selector.value ? [value] : []
  })
}

function parseSegment(segment: string): Segment {
  const open = segment.indexOf('[')
  if (open < 0) return { prop: segment, selector: { kind: 'none' } }
  const prop = segment.slice(0, open)
  const inner = segment.slice(open + 1, -1)
  if (!inner) return { prop, selector: { kind: 'any' } }
  const separator = inner.indexOf('=')
  return {
    prop,
    selector: separator < 0
      ? { kind: 'any' }
      : { kind: 'predicate', key: inner.slice(0, separator), value: inner.slice(separator + 1) }
  }
}

/** 取某个叶子路径上的值（用于提取哨兵） */
export function valuesAt(root: unknown, path: string): unknown[] {
  return resolve(root, path.split('.').map((segment) => (
    segment.endsWith('[]')
      ? { prop: segment.slice(0, -2), selector: { kind: 'any' } as Selector }
      : { prop: segment, selector: { kind: 'none' } as Selector }
  )))
}

function observable(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function hasObservable(values: unknown[]): boolean {
  return values.some(observable)
}

function sentinelOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length >= 12) return value
  if (typeof value === 'number' && Math.abs(value) >= 100000) return String(value)
  return undefined
}

/** 结构 = 对象或数组（valueMap 豁免只接受"键名是数据、值是标量"的字典） */
function containsStructure(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return false
}

/**
 * 某个路径上能当哨兵用的值（字符串 ≥12 字符 / 数字 ≥10 万）。
 * 回归套件用它断言"值不得出现"，目标套件用它断言"值必须存活"——同一批哨兵，两个方向。
 */
export function sentinelsAt(root: unknown, path: string): string[] {
  return [...new Set(valuesAt(root, path).flatMap(sentinelsIn))]
}

/** valueMap 只有一整棵子树可查：把子树里的哨兵都收出来 */
function sentinelsIn(value: unknown): string[] {
  const own = sentinelOf(value)
  if (own) return [own]
  if (Array.isArray(value)) return value.flatMap(sentinelsIn)
  if (isRecord(value)) return Object.values(value).flatMap(sentinelsIn)
  return []
}

export function decodeFixture(name: string): { decoded?: DecodedCharacterCard; error?: string } {
  const { bytes } = loadFixture(name)
  try {
    return { decoded: decodeCharacterCard(bytes, 'sillytavern') }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function coverageFor(fixture: string): FixtureCoverage {
  const { json } = loadFixture(fixture)
  const manifest = new Map<string, TavernFieldExpectation>(
    tavernCardFields.map((field) => [field.path, field])
  )
  const present = canonicalPaths(json)
  const coverage: FixtureCoverage = {
    fixture,
    present,
    undeclared: present.filter((path) => !manifest.has(path)),
    mappedFailures: [],
    droppedFailures: [],
    deviationFailures: [],
    presentMapped: 0,
    presentDropped: 0,
    sentinelChecks: 0,
    declarationOnly: [],
    valueMapViolations: []
  }
  const { decoded, error } = decodeFixture(fixture)
  if (!decoded) {
    if (error) coverage.rejected = error
    return coverage
  }
  const serialized = JSON.stringify(decoded)
  const presentSet = new Set(present)
  for (const path of present) {
    const field = manifest.get(path)
    if (!field) continue
    if (field.status === 'mapped') {
      coverage.presentMapped += 1
      if (!field.landing) continue
      const values = resolveLanding(decoded, field.landing)
      if (!hasObservable(values)) {
        coverage.mappedFailures.push({ path, landing: field.landing })
        continue
      }
      if (field.deviation) {
        const actual = JSON.stringify(values)
        if (!actual.includes(field.deviation.observed)) {
          coverage.deviationFailures.push({ path, observed: field.deviation.observed, actual: actual.slice(0, 200) })
        }
      }
      continue
    }
    coverage.presentDropped += 1
    const raw = valuesAt(json, path)
    // 豁免只给"键名是数据、值是标量"的字典；里面出现结构就说明这个袋子不该被豁免
    if (field.valueMap && raw.some((value) => isRecord(value) && Object.values(value).some(containsStructure))) {
      coverage.valueMapViolations.push(path)
      continue
    }
    // 整棵子树里的**每个**哨兵都要不出现（原来只取第一个，等于给后面的哨兵放水）
    const sentinels = [...new Set(raw.flatMap(sentinelsIn))]
    if (!sentinels.length) {
      coverage.declarationOnly.push(path)
      continue
    }
    coverage.sentinelChecks += 1
    for (const sentinel of sentinels) {
      if (serialized.includes(sentinel)) coverage.droppedFailures.push({ path, sentinel })
    }
  }
  // 容器行（自身不会是叶子路径，例如 data.character_book）：只要夹具里有它的后代就检查落点
  for (const field of tavernCardFields) {
    if (field.status !== 'mapped' || !field.landing || presentSet.has(field.path)) continue
    const exercised = present.some((path) => path.startsWith(`${field.path}.`) || path.startsWith(`${field.path}[]`))
    if (!exercised) continue
    if (!hasObservable(resolveLanding(decoded, field.landing))) {
      coverage.mappedFailures.push({ path: field.path, landing: field.landing })
    }
  }
  return coverage
}

/** 清单里没有任何夹具演练到的行（既没出现、也没有后代出现）：只报告，用来暴露清单里的死条目 */
export function unexercisedByFixtures(fixtures: string[]): TavernFieldExpectation[] {
  const present = new Set<string>()
  for (const fixture of fixtures) for (const path of coverageFor(fixture).present) present.add(path)
  const all = [...present]
  return tavernCardFields.filter((field) => !all.some((path) => (
    path === field.path
    || path.startsWith(`${field.path}.`)
    || path.startsWith(`${field.path}[]`)
  )))
}
