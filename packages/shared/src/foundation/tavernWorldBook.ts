type JsonObject = Record<string, unknown>

/** SillyTavern 全局 world_info_depth 的默认值。 */
export const TAVERN_DEFAULT_SCAN_DEPTH = 2

/**
 * 解析酒馆世界书条目的关键词扫描深度。
 * 四级回退：extensions.scan_depth → 顶层 scanDepth → 书级 scan_depth → 默认 2；非法的级别视为未声明。
 * 顶层 scanDepth 用于酒馆原生 worlds/*.json，extensions.scan_depth 用于卡内嵌世界书。
 * 保留作者显式填写的扫描范围，最小深度沿用本地关键词窗口的 1。
 */
export function tavernEntryScanDepth(entry: JsonObject, book?: JsonObject | undefined): number {
  const entryDepth = scanDepthValue(record(entry.extensions)?.scan_depth) ?? scanDepthValue(entry.scanDepth)
  const resolved = entryDepth ?? scanDepthValue(book?.scan_depth) ?? TAVERN_DEFAULT_SCAN_DEPTH
  return Math.max(resolved, 1)
}

function scanDepthValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}
