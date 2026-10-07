# 酒馆上游行的摘录（`excerpts.json`）

这里放的是 **SillyTavern 上游源码里被我们引用到的那些行**——只有被引用的行，行号是 JSON 的键。

## 为什么需要它

对外兼容文档与两份字段清单里有 28+ 行"酒馆侧引用"（形如 `wi.js:5632` + 一行摘录）。这些引用的
出处（工作区根的 `wi.js`、`../.st-upstream/`）**都不进仓库**，于是：

1. `tests/tavern-docs-generated.test.ts` 的引用闸在干净检出（CI）上直接 `ENOENT`——`pnpm test` 是 CI 的一步；
2. 就算补上兜底，"一条引用都没核对 ⇒ 显式失败"这条仍会红；
3. 清单里每行的 `stReference` + `stSnippet` 原本**没有任何消费者**：写错了没人知道。

把"被引用的那几行"摘进仓库之后，上面三件事在任何机器上都能真核对，评审者也不必再要先搞一份
1.2M 的上游副本才能验证文档里的行号。

## 摘录能证明什么、不能证明什么

- **能**：文档/清单里的 `文件:行号` 确实指着这段原文（在我们的摘录里）；引用的行没有被悄悄抽走。
- **不能**：上游 HEAD 的那一行还是这段原文。那需要真的上游副本；`pnpm check:st-excerpts` 在本机
  检测到副本时会顺手核对新鲜度（不一致就报错），没有副本时只做离线那半。
- 摘录是**稀疏**的（缺的行是空洞，不是空字符串），所以"某段字符串在全文出现几次"这类反证
  **不能**拿摘录做——那会假绿。全文反证只在有整份副本时跑（见 `tests/helpers/stUpstream.ts`）。

## 来源与许可

| 字段 | 值 |
| --- | --- |
| 项目 | [SillyTavern](https://github.com/SillyTavern/SillyTavern) |
| 版本 | v1.19.0 |
| 提交 | `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（2026-09-14） |
| 许可 | AGPL-3.0（本仓库同为 AGPL-3.0-or-later，摘录只用于兼容性核对） |

各文件的 `origin` 就是它在上游仓库里的路径（例如 `wi.js` 对应 `public/scripts/world-info.js`）。
**这是节选，不是完整文件**；不要把它当作上游源码的替代品。

## 怎么维护

```
pnpm generate:st-excerpts   # 从本机上游副本重新摘（ELECKOI_WI_JS / ELECKOI_ST_UPSTREAM 可指定位置）
pnpm check:st-excerpts      # 核对（离线可跑，已接进 pnpm build）
```

新写一条 `wi.js:NNNN` / `characters.js:NNNN` 引用后，两个命令之一会要求你把那一行也摘进来；
`settings.json`（ST 的默认设置档）本机没有副本，所以**只登记、不核对**——这一条登记在
`tests/helpers/stUpstream.ts` 的 `ST_SOURCES` 里，`tavern-docs-generated.test.ts` 会检查
"没有摘录的文件"与那份登记完全一致，不许静默消失。
