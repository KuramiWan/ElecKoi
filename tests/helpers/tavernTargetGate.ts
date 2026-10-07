/**
 * 目标套件的**总开关**：三个文件共用一个口径。
 *
 * ⚠️ 禁写 `Boolean(process.env.X?.trim())`。第一版就是那样，于是 `ELECKOI_TAVERN_COMPAT_TARGET=0`
 * 与 `=false` 都会把 49 条红断言**打开**（独立评审实测：`=0` 时 4 failed）——
 * 谁在 CI 里用 `0` 表示"关"，就会炸出一整套红。
 *
 * 只认显式的开：`1` / `true`（大小写不敏感，允许前后空白）。其余（含空、`0`、`false`、`no`）一律算关。
 */
export function tavernTargetEnabled(): boolean {
  const flag = process.env.ELECKOI_TAVERN_COMPAT_TARGET?.trim().toLowerCase()
  return flag === '1' || flag === 'true'
}
