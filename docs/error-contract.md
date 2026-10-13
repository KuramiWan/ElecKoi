# ElecKoi 错误契约

这份文档是 **13 条失败码、每条码的参数化详情、①–⑥ 每条边界的翻译规则** 的规范形态。
它**语言中立**：照着它就能实现，不必读 TypeScript，也不必读本仓库的源码。

| 读者 | 从这里拿走什么 |
| --- | --- |
| 非 TypeScript 实现者（Android 端在独立仓库，见 [多应用工作区目录](adr/0028-multi-application-workspace.md)） | 码的**字面值**、详情的**形状**、每条边界把哪些失败折成什么码 |
| 第三方插件作者 | 按 `code` 判断失败种类；`message` 是开发者诊断，**不是**给用户的句子 |
| 三个月后的贡献者 | 「为什么这样」（§1）、「边界在哪」（§4）、「还差什么」（§6） |

**为什么这份文档必须自足**：这份契约的决策记录与规格是**工作区文档**（`docs/adr/0002-error-handling-interface.md`
与 `spec-error-handling-interface.md`），**都不在仓库里**。所以本文件把理由、边界与缺口一并写清，
读者不必去找那两份文件。仓库里的源码（`packages/product-shared/src/contracts/errors/` 与各边界的适配器）
只是它的一种实现；**实现与本文冲突时，先改决策记录、再改代码**。

## 0. 这份文档里的引用：哪些在仓库内，哪些在仓库外

这份契约的**决策记录、规格与勘查材料都是仓库外的工作区文件**，编号与仓库内的 ADR 不是一套。
读代码或读本文遇到引用时，先看这一节：

1. **`ADR 0002 决定 N`** 指工作区的 `docs/adr/0002-error-handling-interface.md`
   —— 本线（错误处理接口）的决策记录，决定 1–15 加末尾的「实现订正」一节。
   仓库内的 `docs/adr/` 只有 0012–0029，**没有 0002**，所以这个编号在仓库里查不到。
   `spec-error-handling-interface.md`、`notes/eh-explore-*.md`、`tickets/EH-*.md`、
   `tickets/EH-*.status.md` 同理，全是工作区材料（`CONTEXT.md`、`HANDOFF-*.md` 也一样）。
2. **仓库内的权威就是本文。** 「为什么这样、边界在哪、还差什么」都写在这里，读者不必去找那两份文件。
   实现与本文冲突时，顺序是：先改工作区的决策记录，再改代码，最后改本文。
3. 所以那些引用在本仓库里**解析不到**——点不开，也 `grep` 不到对应文件。它们是**溯源信息**：
   说明这条判据来自哪次核查、哪张票、哪个提交，**不是可点击的链接**。
   别为了"让引用能点开"把它们删掉或改成仓库内的路径；需要事实时看引用所在的那句话本身，
   以及本文对应的小节。

## 1. 为什么这样

### 1.1 这套契约不是新建的抽象，是恢复

`docs/adr/0017-dsh-remote-replaces-desktop-gateway.md` 用 DSH Remote 取代 Desktop Gateway 时，
把当时**端到端可用**的错误语义一起删了：

- `DesktopError.serialize()`（码 + 详情序列化）被砍掉，无替代；
- `failure(error)` 边界包裹（非 `DesktopError` 一律折成 `INTERNAL` + message）被删，无替代；
- 两条"输入/输出按合同校验"的用例被删，无替代。

替代通道 **DSH Remote 本来能承载**这套信息（官方 `RemoteError` 带 `code` 与 `details`），但当时新通道上
`RemoteError` 的使用数是 **0**，22 处调用点把码与详情拆掉、只留 message。所以**这套契约写进代码之前**的状态是
**能力回归**，不是白纸；本线交付的是恢复 + 补齐（失败可观测性与机器闸是旧系统从来没有的部分）。

### 1.2 四条不许越过的界线

1. **不得自建信封、不得包装旧 Gateway**（ADR 0017 明令：壳保留的 IPC 必须独立、最小，不得形成第二套业务 Gateway）；
   失败语义只能骑官方通道已有的设施（`RemoteError`）。
2. **业务失败用「抛出」表达**，不用 `{ ok, error }` 返回信封。失败码是**公开契约**：
   加码是纯增量，改名是破坏性变更。
3. **`code` 给程序，`details` 给程序，`message` 是开发者诊断。** 详情必须**参数化**
   （`field` / `path` / `operation` 这类值），**不许**是拼好的句子。
4. **用户可见文案只有一个解析点**，在渲染层（`apps/web/src/utils/failureText.js`）：
   宿主侧**永不**拼用户可见句子。非 TypeScript 实现（Android、另一种语言的第三方客户端）自己写文案——
   契约只保证 `code` + `details` 足以让实现者说出正确的话。

### 1.3 兜底与不猜

**任何边界遇到无法判别的失败，一律折成 `eleckoi/internal`**，并把原来的码或短诊断种类记进
`details.what` 做诊断。**不许猜**成某个域码——猜错等于给调用方一个假的可判别失败。
1.3 这条是本契约唯一的"全局规则"，它保证「任何边界都能产出同一个可记录对象」：

```
{ code: <13 条之一>, message: <开发者诊断>, details: <该码的参数化详情，至少是 {}> }
```

## 2. 13 条失败码（字面值）

`code` 的形态是 `eleckoi/<域>/<原因>`（全小写 ASCII、连字符分词）。**唯一的例外是兜底码
`eleckoi/internal`，它只有两段。** 判定形态的正则：

```
^eleckoi/(?:internal|[a-z][a-z-]*/[a-z][a-z-]*)$
```

顺序与下表一致；跨语言实现、文档表格、逐条断言都用这个顺序，别各自重排。

| # | 码（字面值） | 含义 | 详情参数 |
| --- | --- | --- | --- |
| 1 | `eleckoi/internal` | 兜底：不属于任何已点名语义的失败 | `what?` |
| 2 | `eleckoi/contract/invalid-request` | 调用方送进来的载荷不合合同 | `issues` |
| 3 | `eleckoi/contract/invalid-response` | 服务返回的载荷不合合同 | `issues` |
| 4 | `eleckoi/input/invalid` | 用户输入不合法 | `field` |
| 5 | `eleckoi/conflict/stale-revision` | 乐观并发校验失配（东西在别处被改过） | `what` |
| 6 | `eleckoi/creator-project/name-taken` | 创建创作项目时目标目录已有同名目录 | `path` |
| 7 | `eleckoi/io/failed` | 文件系统或外部 IO 操作失败 | `operation`、`path?` |
| 8 | `eleckoi/safety/refused` | 护栏**拒绝执行**（不是「执行了但失败」） | `guard` |
| 9 | `eleckoi/storage/corrupt` | 存储里的内容损坏、解析不出来 | `what` |
| 10 | `eleckoi/character/not-found` | 找不到请求的角色 | `what` |
| 11 | `eleckoi/creator-project/not-found` | 找不到请求的创作项目 | `what` |
| 12 | `eleckoi/agent-preset/not-found` | 找不到请求的 Agent 预设 | `what` |
| 13 | `eleckoi/sender/untrusted` | 调用来自不可信的渲染进程 / frame | `what`、`guard` |

三个 `not-found` 分成三条码而不是一条，理由有二：① 失败码是公开契约，**加码是纯增量、改名是破坏性的**；
② 三个域的恢复动作本来就不同（回角色列表 / 刷新项目列表 / 重选预设）。这是本契约里
"形状压过严格必要性"的唯一一处。

**跨边界收到不认识的码怎么办**：`eleckoi/internal`（原码进 `details.what`）。不许原样透传未知码，
也不许把未知码当成成功。

## 3. 每条码的参数化详情

### 3.1 参数名闭集（只有六个）

| 参数 | 含义 | 用在哪条码 |
| --- | --- | --- |
| `field` | 出问题的**用户输入字段名** | `eleckoi/input/invalid` |
| `issues` | 合同违例的逐条诊断，数组 | `eleckoi/contract/invalid-request` / `invalid-response` |
| `path` | 涉及的**文件系统路径**（`name-taken` 是被占用的目录；`io/failed` 是操作对象，有就带上） | `eleckoi/creator-project/name-taken`、`eleckoi/io/failed` |
| `operation` | IO 动作名（`read` / `write` / `delete` / `spawn` …） | `eleckoi/io/failed` |
| `guard` | **拒绝执行的那道护栏**的名字（如 `untrusted-sender`、`assertTrustedDshClientFrame`） | `eleckoi/safety/refused`、`eleckoi/sender/untrusted` |
| `what` | 涉及的**东西的名字**：找不到的东西（角色 / 项目 / 预设 id）、损坏的东西、被改过的资源、观察到的发送方，或兜底码里被折掉的原码 | 兜底码、`conflict/stale-revision`、`storage/corrupt`、三个 `not-found`、`sender/untrusted` |

**不在这六个里的新参数属于契约变更**——先改决策记录，再改实现。

### 3.2 每条码的详情形状（JSON 字面）

```jsonc
// eleckoi/internal
{ "what": "gateway/cancelled" }            // 可省略；「未认出载体」的失败给 {}

// eleckoi/contract/invalid-request 与 eleckoi/contract/invalid-response
{ "issues": [ { "path": "name", "message": "Too small: expected string to have >=1 characters" } ] }
// path 是失败字段的路径（点号连接；整个载荷失败时是空字符串 ""）
// message 是 codec 的原文诊断，不改写文案

// eleckoi/input/invalid
{ "field": "parentDirectory" }

// eleckoi/conflict/stale-revision
{ "what": "regex-rules" }                  // 被改过的那种资源

// eleckoi/creator-project/name-taken
{ "path": "D:\\ElecKoi\\projects\\我的角色" }

// eleckoi/io/failed
{ "operation": "read", "path": "…/manifest.json" }   // path 可省略

// eleckoi/safety/refused
{ "guard": "creator-project-manifest-matches-index" }

// eleckoi/storage/corrupt
{ "what": "creator-project-manifest" }

// eleckoi/character/not-found / creator-project/not-found / agent-preset/not-found
{ "what": "<调用方请求的标识>" }

// eleckoi/sender/untrusted
{ "what": "dsh-app://app/view?chat=…", "guard": "assertTrustedDshClientFrame" }
```

### 3.3 详情的硬约束（跨语言实现也要守）

1. **顶层必须是扁平 JSON 对象。** 线上只看"值是不是对象"，不做深校验，但契约要求它是能
   `JSON.stringify` 往返的值：不放 `undefined`、函数、`Date`、类实例、循环引用。
   没有详情时给 `{}`，**不是** `null`。
2. **详情里只有参数，没有句子。** 想给用户一句话 → 那是渲染层解析点的事（§1.2 第 4 条）。
3. **`issues` 的元素形状固定为 `{ path, message }` 两项**，`path` 与 `message` 都是字符串。
4. `message`（信封上的那个，不是 `issues[].message`）是**开发者诊断文案**：说清哪个操作、
   哪个对象/路径失败。它今天恰好是中文，但**它不属于契约**——实现者不许依赖它的具体字句。

## 4. ①–⑥ 每条边界的翻译规则

边界闭集是 ① 领域内抛出 ② 宿主 Remote 出口 ③ 宿主 ↔ DSH 子进程协议 ④ DSH 运行时插件失败出口
⑤ Electron IPC（主进程 ↔ 渲染层）⑥ 渲染层。另有四项作为形状或约束体现：
⑦ 观测（每条边界的产物都是同一个可记录对象，能直接喂日志）、⑧ 测试与闸（`check:error-contract`）、
⑨ Android（只保证契约可被实现，不写实现、不建机制）、⑩ 第三方插件内部（**排除**，不是我们的边界）。

### 4.0 六条边界共用的折叠函数

未知失败的折叠只有**一份**，优先级从高到低：

| 顺序 | 判定（**只认形状，不许用 `instanceof`**） | 结果 |
| --- | --- | --- |
| 1 | 产品失败形状：`name === 'DesktopError'` 且有 string `code`，是契约码 | 码与详情**原样保留** |
| 2 | 同形状，但是 legacy 码（`INTERNAL` / `INVALID_REQUEST` / `FORBIDDEN` / `NOT_FOUND` / `CONFLICT` / `RUNTIME_UNAVAILABLE`） | `INTERNAL → eleckoi/internal`、`INVALID_REQUEST → eleckoi/input/invalid`、`FORBIDDEN → eleckoi/safety/refused`；其余三条没有唯一对应 ⇒ `eleckoi/internal` + `details.what = 原码`。**防御映射**，新代码不许再用 legacy 码 |
| 3 | Remote 失败形状：`isDSHRemoteError === true` 且有 string `code`，是契约码 | 码与 `details` 原样保留 |
| 4 | 同形状但码不在契约表里 | `eleckoi/internal` + `details.what = 原码` |
| 5 | **其余一切**（裸 `Error`、字符串、`null`、普通对象……） | `eleckoi/internal` + `message`（非 `Error` 用它的字符串化形式），**`details` 是 `{}`** |

**为什么"只认形状"是契约条款而不是实现细节**：契约包在同一个进程里可能有**两份模块实例**
（打包器把契约包内联进某些产物、路径别名指向源码而按包名导入指向构建产物），所以
`x instanceof DesktopError` 会假、码会静默丢掉。非 TypeScript 实现同理：**按字段判定，不按类的身份判定**。
判定用的标记是字面量 `name === 'DesktopError'` 与 `isDSHRemoteError === true`——它们是值，不是原型链。

### 4.1 ① 领域内抛出（`packages/dsh-product-data` 的仓储与领域服务）

- **失败以什么形态移动**：进程内的抛出。失败在这里**第一次获得**契约码与参数化详情。
- **落点**：`packages/dsh-product-data/src/contractFailure.ts` 的 `contractFailure(code, message, details)`
  ——领域侧**唯一**的构造点，`code` 只接受契约码（legacy 码在这里过不了编译），
  `details` 的形状由码强制。
- **翻译规则**（有序）：

| 判断依据 | 折成的码 |
| --- | --- |
| 入参不合合同（codec 失败） | `eleckoi/contract/invalid-request` |
| 返回的载荷不合合同（codec 失败） | `eleckoi/contract/invalid-response` |
| 用户输入不合法 | `eleckoi/input/invalid` |
| 乐观并发校验失配 | `eleckoi/conflict/stale-revision` |
| 目标目录已存在同名目录 | `eleckoi/creator-project/name-taken` |
| 请求的角色 / 创作项目 / Agent 预设不存在 | 对应的 `…/not-found` |
| 文件系统或外部 IO 调用失败 | `eleckoi/io/failed` |
| 护栏拒绝执行 | `eleckoi/safety/refused` |
| 存储内容损坏、解析不出来 | `eleckoi/storage/corrupt` |
| 已经是带契约码的失败 | **不折**，原样保留 |

- **兜底**：`eleckoi/internal`。
- **实现现状**：上表 12 条里有 9 条今天有抛出点（见 §5）；`eleckoi/contract/invalid-request` 与
  `eleckoi/contract/invalid-response` 在这一层今天**没有**抛出点（见 §6 第 13 条）。

### 4.2 ② 宿主 Remote 出口（`packages/dsh-product-api`）

- **失败以什么形态移动**：官方 `RemoteError{ code, message, details }`。
- **为什么必须在这一层翻译**：网关的折叠函数是模块私有的、没有错误映射钩子；网关认得的只有
  **结构标记**——`{ isDSHRemoteError: true, code: string, message, details }` 会被**原样透传**，
  其它一切（`DesktopError`、`ZodError`、裸 `Error`、字符串）都被换成
  `{ code: 'gateway/internal', message: <原文案>, details: {} }`：**码与详情不是被改写，是被丢掉**。
- **落点**：11 个带 `@Remote` 的服务类各自在构造函数末尾装一次失败翻译
  （`installRemoteFailureTranslation`），把每个远程方法的同步抛出与异步拒绝都折成 `RemoteError`；
  折叠本身调用共用的折叠函数（§4.0），**不另写一份**。
- **翻译规则**（有序）：

| 判断依据 | 折成的码 |
| --- | --- |
| 已带契约码的失败（产品失败形状或 Remote 失败形状） | **不折**，原样保留 |
| 入参 codec 失败（网关的 `gateway/arguments-invalid` 一类） | `eleckoi/contract/invalid-request` |
| 出参 codec 失败（网关的 `gateway/result-invalid` 一类） | `eleckoi/contract/invalid-response` |
| 网关载体码 `gateway/bad-request` | `eleckoi/contract/invalid-request` |
| 网关载体码 `gateway/internal` 或 `gateway/cancelled` | `eleckoi/internal` |
| 码不在契约码表里（例如更新的宿主发来的码） | `eleckoi/internal` + `details.what = 原码` |

- **兜底**：`eleckoi/internal`。
- **实现现状**：今天实现的是"已带契约码 → 不折 / legacy → 防御映射 / **网关的合同违例载体码 → 折成
  `contract/invalid-*` 并把 `issues` 放进详情** / 其它 → 兜底"（§4.0 + EH-11 的 H 项）。
  载体码与出处（实测 `@deepseek-ai/*@0.2.0-rc.2`）：
  `gateway/bad-request`（**DSH 自己的 API controller** 的入参 codec 失败，详情就是 `{ issues }`）、
  `gateway/arguments-invalid` / `gateway/input-invalid`（网关 dispatch 的入参校验，详情 `{ endpoint, field? }`）
  → `eleckoi/contract/invalid-request`；`gateway/result-invalid`（出参 codec 失败）→ `invalid-response`。
  载体自带 `issues` 就逐条投影成 `{ path, message }`（zod 的数组 `path` 按点号连接），只带
  `{ endpoint, field? }` 就用 `field` 或 `endpoint` 与 message 合成一条。**载体码本身不成为商品码**——
  它只是折法的输入。
  表中目标**就是兜底码**的两行（`gateway/internal`、`gateway/cancelled`）与通用兜底等价；
  ①（领域内抛出）与 ⑤（IPC 入参）那两条 codec 折法今天**仍没有实现**（见 §6 第 13 条）。

### 4.3 ③ 宿主 ↔ DSH 子进程协议（`apps/desktop-host`）

- **协议版本**：子进程协议有自己的版本常量，当前为 **2**。`ready` 帧带它，**生产侧与消费侧读同一个常量**；
  偏斜或缺失即失败（两端同仓、同一次构建发布，不存在版本偏斜的兼容层）。
  ⚠️ 这与 `ElecKoiHostStatus.protocolVersion`（宿主 ↔ 客户端的 Remote 状态）是**两件事**，
  后者保持 **1**。
- **帧**：

```
ready  : { type: "ready", protocolVersion: 2, url, injections }
fatal  : { type: "fatal", code?, message, stack?, logPath? }   // code 是契约码
```

- **诊断用指针不用正文**：`stack` 与 `logPath` 承载诊断，不把整段日志塞进 `message`。
- **帧里没有放详情的位置**：③ 边界消费到的失败对象，其 `details` 是 `{}`——帧只有上表那四个字段。
  想让 `details` 结构化过帧属于协议变更（见 §4.4 的已知限制）。
- **翻译规则**（有序）：

| 判断依据 | 折成的码 |
| --- | --- |
| `fatal` 帧带契约码 | **不折**，原样保留（`code` / `message` / `stack` / `logPath` 一个不丢） |
| `fatal` 帧未带码 | `eleckoi/internal` |
| 协议版本偏斜或握手失败 | `eleckoi/internal` |
| 子进程未产出可读诊断（`logPath` 缺失或读不到） | `eleckoi/internal` |

- **兜底**：`eleckoi/internal`。
- **注意**：帧是另一个进程送来的 JSON，所以 `code` 的**合同值**是契约码，但消费侧必须过一遍码表
  （不在表里折兜底 + 原码进 `details.what`），不许因为"类型上应该是契约码"就假设它在表里。

### 4.4 ④ DSH 运行时插件失败出口（`apps/desktop/resources/dsh/`）

- **范围**：**插件失败**——`apply()` 抛出、注册失败。**agent 面向的工具结果**（`fail(status, detail)`）
  沿用既有写法，**不在**本契约范围。
- **翻译规则**：插件抛出已带契约码的失败 → 不折；插件抛出未分类失败 → `eleckoi/internal`。兜底 `eleckoi/internal`。
- **出口**：折叠后的可记录对象抛成产品失败形状，Cordis 把它标成 entry 失败，子进程 `fatal` 帧带上码。
- **⚠️ 已知限制**：`fatal` 帧只有 `code` / `message` / `stack` / `logPath` 四个字段，
  **详情放不进帧**。完整对象（含 `plugin` / `details`）作为**一行 JSON** 走子进程 stderr → 宿主诊断回调 →
  宿主日志文件，标记是 `eleckoi/runtime-plugin-failure`（级别 `info`）。也就是说：
  **思路「同一个可记录对象」在日志里完整，②③ 两层只能读到 `code` 与 `message`。**
  想让详情结构化过帧就得改协议帧形状（先改决策记录，再动代码）。见 §6 第 14 条。

### 4.5 ⑤ 主进程 ↔ 渲染层（Electron IPC）

- **线上形状**（普通对象，不是抛出的 `Error`）：

```jsonc
{ "isDSHRemoteError": true, "code": "eleckoi/io/failed", "message": "…", "details": { "operation": "read" } }
```

- **为什么是"返回的对象"而不是"抛出的 Error"**：`ipcMain.handle` 的 handler 抛出时跨进程只带得走
  message——contextBridge 会丢掉 `Error` 的自定义属性。所以码与详情只能作为**可结构化克隆的普通对象**
  移动。判别标记**复用**官方 Remote 失败的那个标记，不另造一种方言，这样渲染层的唯一解析点一行不改就能保住码。
- **方向**：主进程侧把 handler 的抛出折成该对象**返回**；preload 侧见到标记就把它变成一次**拒绝**。
  成功返回值原样透传——**这不是第二套业务信封**，通道名与语义不变。
- **先验身份再看载荷**：发送方不可信时抛 `eleckoi/sender/untrusted`，详情 `{ guard, what }`。
- **翻译规则**（有序）：

| 判断依据 | 折成的码 |
| --- | --- |
| 发送方不是可信的 ElecKoi 页面或 frame | `eleckoi/sender/untrusted` |
| 入参不合合同（codec 失败） | `eleckoi/contract/invalid-request` |
| 通道不存在或调用形态不对 | `eleckoi/internal` |
| 主进程侧失败已带契约码 | **不折**，原样保留 |

- **兜底**：`eleckoi/internal`。
- **实现现状**：今天覆盖 **9 条 invoke 通道**（请求/响应、有失败方向）；另有 3 条通道**没有失败方向**
  （2 条 main→渲染层的推送事件 `dsh-desktop:browser-open-requested` 与 `dsh-desktop:updates-changed`，
  加 1 条单向 `send` 的 `eleckoi:dsh-native-theme`），所以没有可随行的码。
  **宿主失败通知那条推送（`dsh-desktop:host-failure`）有失败方向**：它送的就是失败对象
  `{ isDSHRemoteError: true, code, message, details, stack?, logPath? }`（`DesktopHostFailureNotice`），
  用户在对话框里看得到码、参数化详情与诊断尾部；宿主**不**拼用户可见句子（ADR 决定 4/8）。
  线上判定**只认标记、不校验码**：标记为真就说明主进程报过一次失败，绝不把"码不认识"当成功载荷。
  表中"通道不存在或调用形态不对 → 兜底码"与通用兜底等价；"入参不合合同 → `invalid-request`"
  今天**没有实现**（见 §6 第 13 条）。

### 4.6 ⑥ 渲染层（`apps/web` 与 12 个 `dsh-client-*`）

- **失败以什么形态移动**：官方 `RemoteResult` 的 `ok: false` 分支里 `error` **已经是** `RemoteError` 实例，
  所以正常失败路径就是把那个实例**整个抛出**（不是只取 `message` 重新包一个 `Error`）。
- **翻译规则**（有序）：

| 判断依据 | 折成的码 |
| --- | --- |
| Remote 失败形状（`isDSHRemoteError === true` 且有 string `code`） | **不折**，原样保留 |
| 结构上不带码的失败 | `eleckoi/internal` |
| 本层自己抛出的契约失败 | **不折**，原样保留 |
| 信封本身不成立（`result` 缺失，或 `ok` 不是真而 `error` 缺失/不可用） | `eleckoi/contract/invalid-response` + `issues`（`path` 是 `result` 或 `result.error`） |

- **兜底**：`eleckoi/internal`。
- **用户可见文案的解析点就在这一层**（`apps/web/src/utils/failureText.js`）：它把任意抛出折成契约形状，
  再**按码**给一句用户可见文案，并把 `code` / `details` 原样交给界面展示与复制。
  认不出的码只给一句通用说法（折叠已经把原码放进 `details.what`，所以原码不会被吞）。
  只有**真正没有码语义的裸 `Error`** 才用它的 `message` 当文案。
- **本层禁止再拆信封**：`throw new Error(<失败>.error.message)` 这类写法会把码与详情压成字符串，
  是本契约的头号违例（机器闸的第一条规则）。

### 4.7 ⑦–⑩

- **⑦ 观测**：每条边界的产物都是同一个可记录对象（§1.3 的形状），所以任何边界都能直接喂日志出口：
  主进程日志文件（`AppLog`，带轮转与保留期）、子进程诊断、进程级未处理拒绝与未捕获异常、渲染层未处理拒绝。
  日志出口**自己失败**不能带走调用方（降级为只走 stdout + 一条 stderr 诊断）。
- **⑧ 测试与闸**：三条机器规则 + 只减不增的豁免账本（§7）。
- **⑨ Android**：本契约语言中立、可被实现即可；**不为它写实现、不建跨语言机制**。
- **⑩ 第三方插件内部**：不是我们的边界；插件通过官方通道报错时按本契约的形状走。

## 5. 今天谁在生产这些码（快照）

2026-10-11（集成分支 tip 与 EH-9 合并后）现场 `grep` 的结果，**以现算为准**：

| 码 | 今天的生产者 |
| --- | --- |
| `eleckoi/internal` | 共用折叠函数的兜底（每条边界都可能产出）；边界③ 的"帧未带码" |
| `eleckoi/contract/invalid-request` | 共用折叠函数的**网关合同违例折法**（`gateway/bad-request` 等载体码，EH-11 的 H 项）；详情带 `issues` |
| `eleckoi/contract/invalid-response` | 边界⑥ 的信封不成立分支（`packages/dsh-product-api/src/client/invalidResponse.ts`）；共用折叠函数的 `gateway/result-invalid` 折法 |
| `eleckoi/input/invalid` | 边界① 5 处 |
| `eleckoi/conflict/stale-revision` | 边界① 4 处（正则规则与 Agent 预设的乐观并发） |
| `eleckoi/creator-project/name-taken` | 边界① 1 处 |
| `eleckoi/io/failed` | 边界① 1 处 |
| `eleckoi/safety/refused` | 边界① 3 处（创作项目清单归属三类护栏） |
| `eleckoi/storage/corrupt` | 边界① 3 处（清单与索引解析） |
| `eleckoi/character/not-found` | 边界① 1 处 |
| `eleckoi/creator-project/not-found` | 边界① 2 处 |
| `eleckoi/agent-preset/not-found` | 边界① 2 处（`get` / `save`） |
| `eleckoi/sender/untrusted` | 边界⑤ 的活守卫（`apps/desktop/src/main/platform/electron/validateSender.ts`） |

## 6. 还差什么

**这一节是"未做"清单，不许读成"已完成"。** 每条都写明覆盖范围与失效条件。

1. **边界⑤ 的 contextBridge 跨 world 保真未验证。** 本机无 X server 与 xvfb，
   `electron --ozone-platform=headless` 段错误（EXIT=139），所以"普通对象拒绝原因跨 world 是否保住
   `code` / `details`"只能靠 Electron 官方类型表推断（`Error` 的自定义属性会丢，所以选了普通对象）。
   需要一次**真机冒烟**：不可信发送方 / 更新通道失败时，渲染层 console 能否打出 `code`。
   若真机上前者也不成立，症状是"渲染层只拿到一个没有码的空对象"——解析点会把它折成兜底码
   （不静默成功），但码确实会丢。
2. **打包后 `app.asar` 的真机加载未跑。** 只跑了 `check:electron-dsh`；`build:unpack` 依赖必然停在
   `check:licenses` 的 `pnpm build`（本机平台相关的第三方清单），所以这条**没有执行证据**。
3. **`eleckoi/io/failed` 的用例在 Windows 上 `skipIf`。** 造那条失败要 `EACCES`，而 Windows 的只读属性
   不拦目录删除，CI（`windows-latest`）上跳过。覆盖范围：**本机 Linux 已验，CI 不计**。
4. **`AgentPresetRepository` 的同语义裸 `Error` 残留。** `setActive` / `assignGroup` 仍抛
   `'找不到这个预设。'`，`readActiveRegexRules` / `replaceActiveRegexRules` 亦然。它们今天折成
   `eleckoi/internal`（判据：未被点名的裸 `Error` 不预铺）。这是**下一批**可拆的码，不是遗漏。
5. **偏斜 `ready` 帧 → 兜底码只有分段证据。** 有"判 false + 诊断"与"无码折 `internal`"两段，
   但**没有**一条端到端断言那条失败产出的 `code === 'eleckoi/internal'`。
6. **边界表 ② 的措辞比实现宽。** 表写"未命中 folds 的失败一律折成兜底码，并**在 `details.what` 里
   记下原码或短诊断种类**"，而实现里**未认出载体**的失败给的是 `eleckoi/internal` + `details: {}`
   （只有"认出载体但码表外"才写 `what`）。要么把表的措辞收窄到实现的行为，要么改实现——
   **先改决策记录再动代码**，别只改一边。
7. **契约包的公开出口说法已变。** `exports` 现在给 `types → 构建产出的 .d.ts` + `default → 构建产出的 .js`，
   **不再**是"直接指向源码 `.ts`"（指向源码在运行时加载必失败）。凡引用旧说法的地方都要改。
   另外，契约**不进生成式插件参考**（[接口总表](plugins/api-reference.md)）：进那份参考的唯一机制是
   "被某个**已登记服务的公开成员**签名引用"，而契约包既不是宿主 `runtime-manifest` 的 bundle、
   也没有开发者接口登记。所以第三方插件作者拿到码表的正式途径是**本文档**与
   `@eleckoi/product-shared` 的包导出。
8. **契约包成了"必须先构建才有产物"的包。** 按包名导入走构建产物，路径别名走**源码** ⇒
   同一进程可能存在契约包的**两份模块实例**；因此契约里**所有**判定都必须保持**结构判定**
   （不许回退 `instanceof`，有回归用例钉住）。
9. **两条"代理判据"的教训。** 有一条验收 `grep` 逼着实现用**码字面量**而不是常量引用——
   好在 `contractFailure(code, …)` 的第一参类型让打错码无法编译，一致性由类型系统守，
   所以"字面量"不构成第二份真相。同类还有一条已作废的 `grep … 期望空` 判据：
   **按变量名/文本片段写的验收判据会漏**（另一例见 §7 的规则 1 漏报面）。
10. **`packages/dsh-product-api/src/client/index.ts:20` 是真的拆信封、且未修。**
    Remote 就绪握手的 `status` 是官方 `RemoteResult`（有 `ok` 字段），`status.error.message` 把码丢了。
    它在豁免账本第 A 族里（`MAX_EXEMPTIONS` 之内），**属于下一批可减的豁免**，本线没修。
11. **真机冒烟（EH-4a 的残余风险）。** 12 个 `dsh-client-*` 是运行时经模块装载器装配的独立 bundle，
    跨 bundle 取共享代码靠 `require`；真机上若到达顺序不如预期，那一行 `require` 会抛
    `missed the module table`。本机**跑不了真页面**（无 X server，只有 `check:electron-dsh`），
    所以这条只能靠真机冒烟：某个写操作失败时渲染层 console 能否打出 `code`。
12. **`eh-gates.sh` 的 `check:error-contract` 步骤只对"含 EH-9 合并的树"成立。**
    较早的票树（如 `wt/eh-0`、`wt/eh-4a`、`wt/eh-8`）的 `package.json` 里**没有**这个脚本，
    对它们跑 `eh-gates.sh` 仍会**假红**（`gates.sh` 把"点名了不存在的步骤"按设计判 FAIL）。
    下一批工作的人要知道：**票树必须基于集成分支当前 tip**，否则会看到与改动无关的假红。
    这些旧票树会在收尾时清理，但这条教训比树本身活得久。
13. **边界表里声明、且折法与兜底码不同的那几条折法：② 已经实现（EH-11 的 H 项），① 与 ⑤ 还没有。**
    - **② 已实现**：共用折叠函数（`packages/product-shared/src/foundation/failure.ts`）把网关的合同违例
      载体码折成 `contract/invalid-*` 并把 `issues` 放进详情——`gateway/bad-request`（DSH controller 的
      入参 codec 失败，详情就是 `{ issues }`）、`gateway/arguments-invalid` / `gateway/input-invalid`
      （网关门自己的入参校验，详情 `{ endpoint, field? }`）→ `invalid-request`；
      `gateway/result-invalid`（出参 codec 失败）→ `invalid-response`。用例在
      `tests/error-contract.test.ts` 的 `FOLD_CASES`（四个载体码各一条，断言码与 `issues` 逐字）。
      ⇒ `eleckoi/contract/invalid-request` **今天有生产者**（§5）。
    - **① 没有实现**：`dsh-product-data` 里**没有**"入参/出参不合合同 → `contract/invalid-*`"的抛出点
      （那层不做 codec 校验，也没有点名消费者）。**⑤ 没有实现**：`desktopShellIpc.ts` 不做入参 codec 校验，
      所以"入参不合合同 → `invalid-request`"在那条边界上不产出。
    - 表里另有几条折法的目标**就是**兜底码——`gateway/internal`、`gateway/cancelled`、③ 的"协议版本偏斜"、
      ⑤ 的"通道不存在或调用形态不对"——它们与通用兜底等价，不算缺口。
    不预铺 ① 与 ⑤ 是有意的（没有点名消费者就不铺码），但读者不许把"表里有"当成"已经做了"。
14. **边界④ 的 `details` 过不了帧（已知限制）。** 见 §4.4：完整对象只在日志里，
    ②③ 两层只读得到 `code` 与 `message`；结构化过帧属于协议变更。
15. **一处注释与契约正文不一致（住在实现文件里）。** 同包 `contracts/errors/codes.ts` 对
    `sender/untrusted` 的注释只写了 `what`（实际形状是 `{ what, guard }`，两者都必填，以 §3 为准）。
    （EH-11 已顺手改掉另一处：`boundaries.ts` 的 ② 表注释原先引旧行号
    `dsh-api-gateway/lib/index.js:1425-1441`，实际是 `1425-1443`——那次正好在改那张表。）
16. **闸的两条已知限制**（`check:error-contract`，如实记下）。
    ① 规则"禁止丢码"的**已知漏报面**：`if (!x.ok) throw new Error('…')`（抛出时不读 `.error.message`）
    抓不到——它与普通抛出在文本上不可分，而按守卫配对的写法会把两处 HTTP `fetch` 的 `Response.ok`
    误抓（`apps/web/src/ui/ui/AvatarSlotsEditor.jsx:62`、`packages/dsh-product-api/src/tavily.ts:39`）。
    ② 规则"契约违例必须给对码"仍然**只查"已经产出的违例必须给对码与完整 `issues`"，不查"漏给的违例"**
    （那需要一份"校验点登记表"；① 与 ⑤ 的折法没实现，扫它会是红的）。
    **但它今天不再是空转的**：EH-11 的 H 项把产能放进共用的折叠函数之后，规则 2 会真的扫到那两个产出点
    （`foundation/failure.ts` 的两个 `code:` 位置），突变演练里"把对象字面量里的 `issues` 去掉"当场变红
    （`logs/eh-gate-mutation-r2-gateway-carrier-red.log`）。
    闸的**非恒真**另有独立证据：在集成分支上追加一行丢码写法 ⇒ 红（"命中规则「禁止丢码」但账本里没有登记"），
    还原 ⇒ 绿。
17. **客户端共用的 unwrap 入口现在在热路径上**（EH-11 的 E 项带来的、已接受的取舍）。
    9 个 `packages/dsh-client-*/src/client.js` 从"信封不成立才 `require`"改成每次 `ok:false` 都走
    `require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)`——它把 23 份抄写的三元式收成一个入口
    （收掉重复是独立评审提出的判断项，不是硬违规）。
    模块解析仍在**调用时**发生（不是 factory 顶层求值），所以没有"本行先于依赖到达"的时序风险：
    9 个包的 `package.json` 的 `dsh.client.inject` **全部**列出 `@eleckoi/dsh-product-api`，
    `ELECKOI_DESKTOP_BUNDLES`（`apps/desktop-host/src/desktopPluginBundles.ts`）与
    `runtime-manifest.json` 的 `desktopProfile.bundles` 也都有它。
    **代价**：`packages/dsh-product-api/lib/client.js` 是构建产物，而**今天没有任何闸断言它导出了这个符号**；
    若用了旧产物，失败会从"只有信封不成立那条罕见路径"扩散到**每一次失败 unwrap**。
    这一条没有真机证据（本机无 X server 与 xvfb）。
    **失效条件**：做一次真机冒烟覆盖该入口，或给 `check:electron-dsh` 加一条"产物导出了 `unwrapOrFail`"的断言——
    两者任一成立，这条就可以删。

## 7. 怎么核对与维护

```bash
# 契约闸：三条规则 + 账本集合等式（「实际命中集合 == 账本集合」，多一条少一条都红）
pnpm check:error-contract

# 文档自身的闸（链接、ADR 编号与索引）
pnpm check:docs
```

- 通过时只打印一行：扫描文件数、命中数、`MAX_EXEMPTIONS`。**这三个数以命令的输出为准，别手抄**
  （本文与 [豁免账本那篇](open-problems/error-contract-exemptions.md) 里的数字都标了快照日期）。
  **账本条数与逐规则分布不在输出里**，要现算得 import 闸的 `checkErrorContract` 自己汇总
  （现算命令写在豁免账本那篇里）。
- **豁免账本**（只减不增）：`scripts/error-contract-exemptions.json` 里每条含
  `rule / file / line / reason / tracking`；`MAX_EXEMPTIONS` 是闸里冻结的数字，改它必须在 diff 里显式可见。
  每条豁免的**失效条件**写在 [错误契约闸的豁免账本与失效条件](open-problems/error-contract-exemptions.md)
  ——**没有失效条件的豁免不允许存在**，那是机器判据不是口头约定。
- **命中的位置按 `file` + `line` 冻结**：任何命中行**上方**的改动都会让账本失配。
  这时要**重播账本**，规矩是：重播自己一个提交；提交信息写明「命中 N → M」、只减少、无新增豁免；
  写清行号位移只涉及哪些文件；`MAX_EXEMPTIONS` 跟着一起改并 stage；重播后复跑闸与突变演练。
  **重播不等于放宽**：规则一个字不动，任何新增命中仍然会红。
- **改契约的顺序**：先改决策记录（13 条码、六个参数名、①–⑥ 边界闭集是**冻结**的），再改实现，
  最后改本文件。加码是纯增量、改名是破坏性变更；新增参数名属于契约变更。

## 8. UI 改动的申报（本线改了哪些视觉、为什么）

`.github/PULL_REQUEST_TEMPLATE/desktop.md` 要求「UI 未定稿阶段没有借底层改造擅自改变 JSX/CSS 视觉」，
并要求在 PR 描述里申报。本线不开 PR，所以申报写在这里（票 EH-11 的 D 项）。

**改了什么**（相对本线基线 `d4b6bb9`：7 个文件、+283/−21）：

| 文件 | 提交 | 改动 |
| --- | --- | --- |
| `apps/web/src/ui/ui/FailureAlert.jsx`（新增，+32） | `1ff8a3d`（EH-4b 第 1 步） | 就地失败面：`role="alert"` + 解析点给的说法 + 失败码 + 参数化详情 |
| `apps/web/src/ui/styles/failure-alert.css`（新增，+58） | 同上 | 上面那个组件的样式 |
| `apps/web/src/app/hooks/useNotices.js`（+45） | `4531497`（EH-8 第 1 步） | 修掉 notice 队列单槽的三个缺陷：两条错误只显示后一条、错误后接非错误时详情在 3.2 秒后无声丢掉、`id = Date.now()` 同毫秒撞号 |
| `apps/web/src/ui/ui/AppToast.jsx`（+23/−…） | 同上 | 跟随上面的队列语义（非 error 分支今天没有生产者） |
| `apps/web/src/ui/ui/AppErrorDialog.jsx`（+70/−…） | `4531497` + `7e1be1e`（EH-8 第 2 步） | 对话框显示失败码、参数化详情、诊断尾部，并支持一键复制 |
| `apps/web/src/ui/styles/app-error-dialog.css`（+66/−…） | 同上两个提交 | 上面那些新增字段的样式 |
| `apps/web/src/app/windows/MainWindow.jsx`（+10/−…） | `f4f6fb0`（EH-11 的 G 项） | 只换接线：订阅宿主送来的**失败对象**、交给解析点拼文案；不新增视觉元素 |

**为什么这么改。** ADR 0002 决定 12 就是要求呈现面这样做：`AppErrorDialog` 显示失败码 + 参数化详情 +
诊断尾部 + 一键复制；notice 队列那三个单槽缺陷是同一决定点名要修的。EH-11 的 G 项把插件退出那条通知
从「宿主拼好的一句固定中文」改成「宿主送失败对象、渲染层解析点拼文案」，是决定 4/8 的落地——
对话框本来就显示 `code` / `details` / 诊断，所以这次**没有**新增视觉元素。

**范围与不动的部分。** 改动只落在上表这 7 个文件，没有动布局、主题或其它窗口的视觉。
ADR 0002 决定 12 明令**不给四个副窗口补 toast 面**（它们各自已有就地失败面），本次也没有补。
`AppErrorDialog.describeNotice` / `copyTextOfNotice` 与 `FailureAlert` 仍各自渲染同一套 code + facts 的
`<dl>` 形状（重复，评审 Standards 轴第 7 条记过），本次**没有**合并——那是另一件事，不在 EH-11 的范围里。
