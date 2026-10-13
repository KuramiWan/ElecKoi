# 错误契约闸的豁免账本与失效条件

[返回公开课题目录](README.md) | [English](error-contract-exemptions.en.md)

**状态：有账本、无方案——账本里的豁免全是「已知的失败被丢弃点」，每条都写明失效条件；账本只减不增。**
（**条数与上限以闸现算为准**：跑 `pnpm check:error-contract`，通过时那一行就是扫描文件数、命中数与
`MAX_EXEMPTIONS`。本文不把数字当第二份真相，下面那几张表都标了快照日期。）

`scripts/check-error-contract.mjs`（`pnpm check:error-contract`）断言的是一条集合等式：
**实际命中集合 == 账本集合**。命中集合由闸自己的三条正则现算，账本在
`scripts/error-contract-exemptions.json`，上限是闸里写死的冻结数字 `MAX_EXEMPTIONS`。
多一条命中、少一条命中、动一次上限，都是红。

这份文档是**每条豁免的失效条件**的落点。账本里每条豁免的 `tracking` 都指到下面某一族；
族里写的条件一旦成立，就要**显式删掉那几条豁免、并把 `MAX_EXEMPTIONS` 一起下调**——
「只减不增」的意思就是：命中消失不会被自动放过，必须留下一次可见的减法。

## 族 A：丢码的存量抛出点

`new Error(<失败>.error.message)`——从失败里只取 message、重新包成裸 `Error`，码与详情就此消失
（ADR 0002 决定 6 的规则 1）。规则的**接收者是通配的**（不写死 `result`），也不要求前面有 `throw`：
`finish(new Error(<…>.error.message))` 一样把码压成字符串。下面**四处**因此都在账本里：

| 位置 | 为什么漏在外面 |
| --- | --- |
| `packages/dsh-product-api/src/client/index.ts:25` | 载体是 `status`（Remote 就绪握手），不是 `result`；这一处**是真的拆信封**（`status` 是官方 `RemoteResult`），属于下一批可减的豁免 |
| `packages/dsh-client-conversations/src/client.js:311` | 载体是流快照的 `promptError`，且写法是 `finish(new Error(...))`（没有 `throw`） |
| `packages/dsh-client-conversations/src/client.js:333` | 同上（流状态里的 `reason.error?.message`） |
| `packages/dsh-client-roleplay/src/host/session-runtime.mjs:266` | 载体是 DSH 事件载荷 `event.data.reason.error`，不是产品 Remote 信封 |

**失效条件**：这四处改成保留失败实例（`throw result.error` 或契约失败对象），四条豁免随之删除。
后两处（流状态载体）若判定不该走契约码，则改成把失败对象整体留进快照、由呈现面解析。
（第 1 行那处已经判定为真的丢码，只是本线没修——见
[错误契约](../error-contract.md) 的「还差什么」第 10 条。）
（原先还有第五处 `packages/dsh-client-conversations/src/client.js:1769`：变量名叫 `accepted`，
EH-4a 的第六个提交已把它改成保留失败实例，对应的豁免已从账本删除、`MAX_EXEMPTIONS` 同步下调。）

**已知漏报面**：`if (!x.ok) throw new Error('…')`（抛出时不读 `.error.message`）不在规则 1 里——
它与普通抛出在文本上不可分，而按守卫配对的写法会把 `fetch` 的 `if (!response.ok)` 也抓进来
（`apps/web/src/ui/ui/AvatarSlotsEditor.jsx:62`、`packages/dsh-product-api/src/tavily.ts:39` 是 HTTP
`Response.ok`，不是产品 RemoteResult）。这条漏报写在闸的文件头里，不靠这份文档兜。

## 族 B：包侧（`packages/`）即发即弃的读取与刷新

连接重置、快照失效、会话切换之后的 `void this.refresh().catch(() => {})` 一类写法：这次读取的失败被丢弃，
订阅者看到的仍是上一份快照（ADR 0002 决定 6 的规则 3）。

**失效条件**：这条链上的失败接上失败出口（写进快照的失败字段、进 logger、或渲染层的失败面），
按文件逐个删除对应豁免。ADR 0002 决定 12 已经给三个**写队列的队列尾巴**接了出口（EH-4a 的
`ab09210`），这一族是它的续集：**读取**这条路还没接。

## 族 C：渲染层（`apps/web/`）即发即弃的调用

窗口自身的显示调用、偏好写入的调用方拒绝、启动时载入会话列表、事件队列的链式接续：失败被丢弃。

**失效条件**：每一处接上界面上的失败面（`role="alert"` 或失败对话框）之后删除豁免。
注意 ADR 0002 决定 12 明令**不给四个副窗口补 toast 面**（它们各自已有就地失败面），
所以窗口显示调用那一组的失效条件不是"补一个提示"，而是"这条调用有了可呈现的失败语义"。

## 族 D：只有注释说明或真空的 `catch` 体

`try { … } catch { /* 解释 */ }` 与 `} catch {}`：catch 体里只有注释、或者什么都没有。
注释是解释，不是豁免声明——决定 6 要的是账本里的一条登记。

**失效条件**：把 catch 体改成显式处理（记日志、折成契约码、或把"忽略"写成有名字的判定），
或者把它的理由收进这条链自己的失败语义里。纯粹补一句注释不算失效。

## 为什么是这么多条（权威值由闸现算）

**数字的唯一真相是闸的现算结果，不是本文。** 两条命令：

```bash
# 权威输出行（通过时只有一行）：扫描文件数、命中数、MAX_EXEMPTIONS
pnpm check:error-contract

# 账本条数与逐规则 / 逐族分布（闸不打印它，得 import 它的 checkErrorContract 自己汇总）
node -e "import('./scripts/check-error-contract.mjs').then(m=>{const r=m.checkErrorContract(process.cwd());const c={};for(const e of r.exemptions)c[e.tracking.split(' ').pop()]=(c[e.tracking.split(' ').pop()]??0)+1;console.log('命中/豁免',r.hits.length,'/',r.exemptions.length,'上限',m.MAX_EXEMPTIONS,'分族',c)})"
```

下面是 **2026-10-12（EH-11 之后）的现场快照**，只作阅读辅助；对不上就以命令的输出为准：

| 项 | 快照值 |
| --- | --- |
| 扫描的源文件（`apps/` + `packages/` 的 `.ts .tsx .js .jsx .mjs`，排除 `node_modules`/`dist`/`lib`/`out`） | 517 |
| 命中（三条规则合计） | 65 |
| 其中「禁止丢码」`no-code-drop` | 4 |
| 其中「空 catch 必须有豁免声明」`empty-catch` | 61 |
| 其中「契约违例必须给对码与完整 issues」`contract-invalid-details` | 0（它报的是违例，不是计数） |
| 分族：族 A / 族 B / 族 C / 族 D | 4 / 41 / 14 / 6 |
| `MAX_EXEMPTIONS`（闸里的冻结数字） | 65 |

为什么**不手写**权威数字：闸的正则与账本一变，手抄的数就是错的（这一族已经被抓过两次——
规格/ADR 里"43 处 / 40 处"复现不出来，见 ADR 0002 的「实现订正 c」；`66 → 65` 的重播见订正 p）。
分族计数随账本走，别把这张表当第二份真相。
