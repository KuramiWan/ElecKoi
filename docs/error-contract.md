<!-- 由 pnpm generate:error-contract-doc 生成，请勿手改。 -->

# ElecKoi 失败契约

这份文档把 ElecKoi 的失败码、每条码的参数化详情、用户文案通道与四条契约规则写成对外可读的一页。
它从契约源码生成（真源见文末），所以不会与实现漂移：手改产物会被 `pnpm check:error-contract-doc`
拒绝，`pnpm build` 也跑这一步。

适合三类读者：非 TypeScript 实现者（照抄码字符串与参数名）、第三方插件作者（按 `code` 判断失败种类）、
维护者（哪条码带哪些参数、默认走哪个通道、用户看到的无参数说法是什么）。

## 1. 失败对象与码的形态

任何边界遇到无法判别的失败，一律折成兜底码 `eleckoi/internal`，并把原码或短诊断记进 `details.what`；
**不许猜**成某个域码——猜错等于给调用方一个假的可判别失败。

失败对象的形状（跨边界可以 `JSON.stringify` 往返，详情是扁平 JSON 对象）：

```json
{ "code": "<码表里的一条>", "message": "<开发者诊断>", "details": {} }
```

- `code`：给程序的分支依据；形态 `eleckoi/<域>/<原因>`（全小写 ASCII、连字符分词），唯一例外是兜底码 `eleckoi/internal`（只有两段）。判定正则：`/^eleckoi\/(?:internal|[a-z][a-z-]*\/[a-z][a-z-]*)$/`。
- `message`：开发者诊断（原始中文句，可以带 id 与路径）。它进日志，**不是**给用户看的句子。
- `details`：参数化详情，只放参数（见 §3），不许放拼好的句子。

**用户可见文案只有一个解析点**（渲染层 `apps/web/src/utils/failureTexts.js`）：宿主、插件与领域层
永不拼用户可见句子；非 TypeScript 实现自己写文案，契约只保证 `code` + `details` 足以说出正确的话。

## 2. 四条契约规则

`pnpm check:error-contract` 用四条规则守这份契约（实现见文末真源）。规则只看**代码位置**：
同样一段文本出现在字符串或注释里不算（作者脚本示例、文档字面量因此不会被误判）。

1. **禁止丢码**：不许把带码的失败压成一句话（例如 `new Error(result.error.message)`）。
   宿主已经把 `code` 与 `details` 交出来了，调用方必须原样传下去，或者交给 `resolveFailure` 解析。
2. **契约违例必须带 `issues`**：`eleckoi/contract/invalid-request` 与 `-response` 的详情必须是
   **非空**数组，元素带 `path` 与 `message`。丢了 issues，用户就不知道哪一个字段不合要求。
3. **空 catch 必须写成具名声明**：处理体为空时只能写成 `.catch(failureAlreadyPublished)`、
   `.catch(rejectionIsAwaitedElsewhere)`、`.catch(bestEffort)` 之一，或者写一个非空处理体；
   `catch {}` 与只含注释的 `catch {}` 都算裸吞。
4. **不许裸抛**：领域、宿主与客户端插件层的 `throw new Error(` 必须改成带契约码的构造
   （`DesktopError` / `productFailure`）。规则 1–3 是绝对值（命中即失败）；规则 4 是收口进度尺，
   数字必须归零，归零后闸按绝对值判失败（`--strict`）。

## 3. 详情参数（闭集）

详情只放参数，不放拼好的句子。参数名是**闭集**：不在这 8 个里的新参数属于契约变更。
最初六个（`field` / `issues` / `path` / `operation` / `guard` / `what`）之外，扩表时新增了
`expected` / `actual`，用来表达「要求什么、实际是什么」。

| 参数 | 含义 | 要求这个参数的码 |
| --- | --- | --- |
| `field` | 出问题的字段或配置项名（用户填的、模型配置的）。 | `eleckoi/input/invalid`、`eleckoi/model/config-invalid`、`eleckoi/media/invalid` |
| `issues` | 合同违例的逐条诊断：`{ path, message }` 数组。 | `eleckoi/contract/invalid-request`、`eleckoi/contract/invalid-response` |
| `path` | 涉及的文件系统路径（操作对象、被占用的目录）。 | `eleckoi/data/shape-invalid`、`eleckoi/lookup/duplicate`、`eleckoi/creator-project/name-taken`、`eleckoi/plugin/load-failed`、`eleckoi/io/failed` |
| `operation` | 动作名（`read` / `write` / `delete` / `spawn` / `request` …）。 | `eleckoi/io/failed`、`eleckoi/net/operation-failed`、`eleckoi/ipc/call-failed` |
| `guard` | 拒绝执行的那道护栏名（如 `untrusted-sender`）。 | `eleckoi/safety/refused`、`eleckoi/security/denied`、`eleckoi/sender/untrusted` |
| `what` | 涉及的**东西**（名词短语，会被拼进用户句，如「角色」「预设分组」）；不是 id。 | `eleckoi/internal`、`eleckoi/data/shape-invalid`、`eleckoi/data/legacy-mismatch`、`eleckoi/input/unsupported`、`eleckoi/lookup/not-found`、`eleckoi/lookup/duplicate`、`eleckoi/character/not-found`、`eleckoi/creator-project/not-found`、`eleckoi/agent-preset/not-found`、`eleckoi/conflict/stale-revision`、`eleckoi/state/mismatch`、`eleckoi/state/precondition`、`eleckoi/security/denied`、`eleckoi/sender/untrusted`、`eleckoi/lifecycle/not-ready`、`eleckoi/lifecycle/disposed`、`eleckoi/plugin/load-failed`、`eleckoi/net/operation-failed`、`eleckoi/timeout/expired`、`eleckoi/storage/corrupt`、`eleckoi/db/schema-mismatch`、`eleckoi/model/config-invalid`、`eleckoi/media/invalid`、`eleckoi/ipc/call-failed` |
| `expected` | 当前版本或支持范围要求的形态（如 `schema v3`）。 | `eleckoi/data/legacy-mismatch`、`eleckoi/input/unsupported`、`eleckoi/db/schema-mismatch` |
| `actual` | 实际观察到的形态。 | —（当前没有码要求） |

## 4. 呈现通道：默认由码给，只能上调

每条码有一个**默认通道**：

- `app`（应用级）：失败不属于某一个窗口或面板（宿主进程、库、存储、调用来源），要弹应用级对话框或窗口级提示；
- `inline`（功能内）：就地显示在发生的那块界面里（目录读失败、保存冲突这类）。

调用点可以**上调**（`upgradeTo: "app"`），而**没有下调的位置**——解析函数的参数里根本没有那个方向，
把严重失败藏成一行小字这条在结构上做不到。

默认走应用级的码（5 条）：`eleckoi/sender/untrusted`、`eleckoi/lifecycle/disposed`、`eleckoi/plugin/load-failed`、`eleckoi/storage/corrupt`、`eleckoi/db/schema-mismatch`。

## 5. 码表（30 条，逐码一行）

顺序即跨语言实现、文档表格与逐条断言的**列举顺序**（先兜底，再按「谁的问题」分组），别各自重排。
「语义键」是契约源码里那条常量的键（给代码读）；「详情参数」是该码会带的参数（必填 / 可选见
[详情形状](../packages/shared/src/contracts/errors/details.ts)）；「用户句」是**没有详情参数时**渲染层给用户的说法。

| 码 | 语义键 | 详情参数 | 默认通道 | 用户句（无参数时） |
| --- | --- | --- | --- | --- |
| `eleckoi/internal` | `internal` | `what` | 功能内（inline） | —（兜底码没有固定说法：有 `details.what` 时用调用方给的说法，否则用原始失败的 `message`） |
| `eleckoi/contract/invalid-request` | `contractInvalidRequest` | `issues` | 功能内（inline） | 请求内容不符合要求，已拒绝。 |
| `eleckoi/contract/invalid-response` | `contractInvalidResponse` | `issues` | 功能内（inline） | 服务返回的内容不符合要求，已拒绝。 |
| `eleckoi/data/shape-invalid` | `dataShapeInvalid` | `what`、`path` | 功能内（inline） | 数据格式不符合要求。 |
| `eleckoi/data/legacy-mismatch` | `dataLegacyMismatch` | `what`、`expected` | 功能内（inline） | 这份数据来自旧版本，当前版本读不了。 |
| `eleckoi/input/invalid` | `inputInvalid` | `field` | 功能内（inline） | 输入不合法。 |
| `eleckoi/input/unsupported` | `inputUnsupported` | `what`、`expected` | 功能内（inline） | 不支持这个格式、版本或能力。 |
| `eleckoi/lookup/not-found` | `lookupNotFound` | `what` | 功能内（inline） | 找不到要操作的内容。 |
| `eleckoi/lookup/duplicate` | `lookupDuplicate` | `what`、`path` | 功能内（inline） | 已存在同名内容。 |
| `eleckoi/character/not-found` | `characterNotFound` | `what` | 功能内（inline） | 角色不存在或已被删除。 |
| `eleckoi/creator-project/not-found` | `creatorProjectNotFound` | `what` | 功能内（inline） | 创作项目不存在或已被删除。 |
| `eleckoi/agent-preset/not-found` | `agentPresetNotFound` | `what` | 功能内（inline） | Agent 预设不存在或已被删除。 |
| `eleckoi/creator-project/name-taken` | `creatorProjectNameTaken` | `path` | 功能内（inline） | 保存位置已存在同名目录。 |
| `eleckoi/conflict/stale-revision` | `conflictStaleRevision` | `what` | 功能内（inline） | 内容已在别处被修改，请刷新后重试。 |
| `eleckoi/state/mismatch` | `stateMismatch` | `what` | 功能内（inline） | 内容状态对不上，请刷新后重试。 |
| `eleckoi/state/precondition` | `statePrecondition` | `what` | 功能内（inline） | 请先完成前置操作。 |
| `eleckoi/safety/refused` | `safetyRefused` | `guard` | 功能内（inline） | 操作被拒绝。 |
| `eleckoi/security/denied` | `securityDenied` | `what`、`guard` | 功能内（inline） | 没有权限执行这个操作。 |
| `eleckoi/sender/untrusted` | `senderUntrusted` | `what`、`guard` | 应用级（app） | 该操作被拒绝：调用来源不可信。 |
| `eleckoi/lifecycle/not-ready` | `lifecycleNotReady` | `what` | 功能内（inline） | 服务还没准备好，请稍后再试。 |
| `eleckoi/lifecycle/disposed` | `lifecycleDisposed` | `what` | 应用级（app） | 这个功能已关闭，请重新打开。 |
| `eleckoi/plugin/load-failed` | `pluginLoadFailed` | `what`、`path` | 应用级（app） | 插件服务没有启动起来，请重新打开插件中心。 |
| `eleckoi/io/failed` | `ioFailed` | `operation`、`path` | 功能内（inline） | 读写失败。 |
| `eleckoi/net/operation-failed` | `netOperationFailed` | `operation`、`what` | 功能内（inline） | 网络请求失败，请检查网络连接后重试。 |
| `eleckoi/timeout/expired` | `timeoutExpired` | `what` | 功能内（inline） | 操作超时，请重试。 |
| `eleckoi/storage/corrupt` | `storageCorrupt` | `what` | 应用级（app） | 存储内容已损坏，读不出来。 |
| `eleckoi/db/schema-mismatch` | `dbSchemaMismatch` | `what`、`expected` | 应用级（app） | 本地数据库结构不对，请重新安装或升级后再试。 |
| `eleckoi/model/config-invalid` | `modelConfigInvalid` | `field`、`what` | 功能内（inline） | 模型配置不合法。 |
| `eleckoi/media/invalid` | `mediaInvalid` | `what`、`field` | 功能内（inline） | 图片或音频不符合要求。 |
| `eleckoi/ipc/call-failed` | `ipcCallFailed` | `what`、`operation` | 功能内（inline） | 与后台服务通信失败，请重试。 |

## 6. 真源与维护

| 内容 | 真源 |
| --- | --- |
| 码字符串与顺序 | [codes.ts](../packages/shared/src/contracts/errors/codes.ts) |
| 每条码的参数 | [details.ts](../packages/shared/src/contracts/errors/details.ts) |
| 用户句与默认通道 | [failureTexts.js](../apps/web/src/utils/failureTexts.js) |
| 四条规则的实现 | [check-error-contract.mjs](../scripts/check-error-contract.mjs) |

改契约的顺序：先改真源，再 `pnpm generate:error-contract-doc` 重生成，然后把产物一起提交。
`pnpm check:error-contract-doc`（`pnpm build` 的一步）会拒绝过期产物。

这份文档不记录当前裸抛处数——数字看 `pnpm check:error-contract` 的输出。

