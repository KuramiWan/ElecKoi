# RFC #9 诉求 2：子 Agent 的产品作用域（签名级计划）

**状态：2026-10-08。这是 fork 内的留档，不是实现，也不是给上游的正式提议。**
上游那张问题单只写「问题 + 场景 + 怎么算做对了 + 两种可行做法」，不放本文的签名。
代码引用都在 `origin/main` = `d4b6bb9`（ElecKoi v0.2.8）核过。标「推断」的地方我没有跑起来验证。
官方 DSH 包的行号取自未打补丁的官方副本；产品树里 DSH 有 32 个文件被改过，行号在产品树里可能偏移。

## 0. 一句话

产品把子 Agent 排除在自己的作用域之外（`agent-preset-bridge.mjs:176` 的 `if (!child)`），
所以子 Agent 用哪个模型、挂哪个预设、看哪份设定库、能用哪些工具，全由 DSH 会话里的活值决定；
而它写到的那批文件又与主聊天共用路径。先把这两件修掉，再谈给插件一个能指定这些的公共接口。

## 1. 用户可见后果

同一个主聊天里跑三个队友时，用户会看到：

1. 你在主聊天临时换过模型，队友跟着用那个模型（不是产品数据里那一个）。
2. 你在预设里关掉的工具，队友那边照旧能用。
3. 你改了设定库或变量，队友那一轮按哪一份走，取决于时间先后。
4. 两个队友同时跑，会互相覆盖预设相关的那份文件（机制已读到，未复现）。

## 2. 今天的事实

| # | 事实 | 证据 | 怎么确认的 |
| --- | --- | --- | --- |
| 1 | 产品不建子 Agent：产品代码 0 处 `subagents` / `startContinuable` | 全仓检索 `packages/*/src`、`apps/*/src` | 读源码 |
| 2 | 创建链全在官方：`dsh-tool-subagent` → `dsh-subagent` 的 `resume`/`create` | `dsh-tool-subagent:490/527/557`、`dsh-subagent:1069/1076/1082` | 读产物 |
| 3 | 子 Agent 的模型 = 母会话最近一条请求头 | `dsh-subagent:414-424` | 读产物 |
| 4 | 子 Agent 的预设 = 母会话当时的活作用域 | `dsh-subagent:470-482` | 读产物 |
| 5 | 产品对子 Agent 什么都不装 | `agent-preset-bridge.mjs:176` 的 `if (!child)` 挡住 `:177-178` | 读源码 |
| 6 | 快照缺失时**静默继续** | `agent-preset-bridge.mjs:181-185`：`catch` 里 `error.code === 'ENOENT'` 直接 `return` | 读源码 |
| 7 | 子 Agent 有自己名字的快照文件，但文件**内容里**的三个路径是母会话的 | `session-snapshot.mjs:51-65`（`:53` 用 childSessionId）、`session-runtime.mjs:113-115` | 读源码 |
| 8 | 工具的两个面**同源**，不需要新接口 | 官方 `dsh-tools` 的 `view(scope)`：`wireSchemas` ← `ctx.systemPrompt.tools` ← `view(scope)`；执行侧同一个 view | 读产物 |
| 9 | `agent/created` 是「创建后、首步前」的合法点 | 该事件 serial + await；官方 `dsh-tool-subagent` 自己就在这里装东西 | 读产物 |
| 10 | 模板没有用官方给的工具过滤器 | `agent.cordis.yml:56-74` | 读源码 |
| 11 | 预设注册用常量目录、单进程单文件 | `session-runtime.mjs:359-361,381` | 读源码（机制），未复现 |
| 12 | 主聊天第一轮不通知插件 | `session-runtime.mjs:75-76` | 读源码 |
| 13 | `eleckoiConversationLifecycle.prepare` 是观察点，改不了本轮的值 | `conversationLifecycle.ts:43`（无返回）、`:54`（注释自陈不管理路由）、`:97`（入参是副本） | 读源码 |

## 3. 第一步：不新增公共接口

### 3.0 顺序有约束

**先给子 Agent 自己的文件根，再打开安装。** 反过来做，打开的那一刻子 Agent 就会去写主聊天的文件——
现在没坏，只是因为产品把子 Agent 挡在外面（第 5 条）。这两件必须一起改，不能分两次合。

### 3.1 给子 Agent 自己的文件根

`inheritSessionSnapshot(root, parentSessionId, childSessionId)`（`session-snapshot.mjs:51-65`）今天把母会话
快照逐字复制到 `root/<childSessionId>.json`，但里面的 `variableStateFile` / `settingStateFile` /
`contextFile` 仍指向母会话的路径。

改法（推断）：复制时把这三个路径重写到 `root/<childSessionId>/` 下，并落一份子 Agent 自己的桥文件。
顺带查清一件事：`settingStateFile` 目前**全仓只有写、没有任何读者**，要么补读者，要么删掉这个字段。

### 3.2 子 Agent 也装产品侧的请求配置

把 `agent-preset-bridge.mjs:176` 的 `if (!child)` 去掉，让子 Agent 也走 `:177-178`，
但用 3.1 给它的根。`installConversationContext` 要不要一起给子 Agent，由「子 Agent 看什么」的验收决定。

### 3.3 不许静默降级

`agent-preset-bridge.mjs:181-185` 现在遇到 `ENOENT` 就 `return`：快照缺失时子 Agent 静默地没有产品作用域，
不报错、不记录。改成报错；如果确实要容忍某一种情况（例如母会话正好被删），只容忍那一种，并留下记录。

### 3.4 模板启用官方的工具过滤器

`agent.cordis.yml:56-74` 没设 `toolFilter`。官方早就支持 per-child 过滤（`dsh-subagent:436-452`）。
**注意**：PR #10 用预设级的 `subagentModelSelection` 解决了「用哪个模型」（见 §7），
这一条要不要做、怎么做，取决于 #10 定案后还剩什么。

## 4. 第二步：公共接口的候选签名

以下是**候选**，不是定稿。名字、身份键、多参与者优先级都还没定（见 §8）。

```ts
/** 插件为某一个子 Agent 覆盖产品的默认作用域。只允许收窄，不允许新增维度。 */
interface ElecKoiChildScopeParticipant {
  readonly id: string
  resolve?(
    input: ElecKoiChildScopeRequest,
    signal: AbortSignal
  ): ElecKoiChildScopeOverride | undefined | Promise<ElecKoiChildScopeOverride | undefined>
}

interface ElecKoiChildScopeRequest {
  readonly conversationId: string           // 产品身份：同一个主聊天
  readonly runtimeSessionId: string         // 子 Agent 自己的会话
  readonly parentRuntimeSessionId: string   // 主聊天的会话
  readonly name: string                     // 官方起子 Agent 时给的 name
}

interface ElecKoiChildScopeOverride {
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly presetId?: string
  readonly disabledToolGroupIds?: readonly string[]
  readonly view?: 'inherit' | 'fresh'       // 上下文视图：沿用母会话，还是只给角色卡与设定库
}
```

语义（待上游确认的按「待定」标注）：

- 每个子 Agent 只解析一次，按 `runtimeSessionId` 分开；并发互不影响。
- 返回 `undefined` = 用产品默认（沿用主聊天）。**抛错 = 这个子 Agent 失败并报错，不许静默沿用。**
- 解析必须发生在产品写本轮快照之前。`agent/created` 在首步之前，时序允许（第 9 条）。
- 只对 `origin === 'subagent'` 生效；主聊天继续走 `eleckoiConversationLifecycle`。
- 待定：多个参与者的优先级；`presetId` 是产品预设还是 DSH 的 agentPreset；
  `view: 'fresh'` 的确切含义；`name` 是否算稳定标识（今天插件把路由塞进 `description` 再当 `label` 回传，
  靠的是带外通道，不稳定）。

## 5. 怎么算做对了

1. **并发分开**：两个子 Agent 同时起，各自不同的模型与预设，互不覆盖。
2. **不碰主聊天**：两次子 Agent 跑完后，主聊天那三个桥文件的 `sha256` 不变。
3. **不静默**：取不到快照或解析失败时，这个子 Agent 报错，且**不产生任何模型请求**。
4. **能选不同模型**：真机上子 Agent 能选到与主聊天不同的模型（跟一次真机，写清平台）。
5. 主聊天第一轮仍不通知插件——现状不变，那是另一张票（见 §8）。

## 6. 不做

- 成员通信、roster、成员上限、收据表（上游在 ADR-0027 里已划给各自能力）。
- 子 Agent 的显示（不进「实际请求预览」）与收尾清理（快照不删）——另开一张。
- DSH 侧的 `spawnTeammate` 透传——另提 DSH。
- 任何新的产品表，任何迁移。

## 7. 与 PR #10 的关系（要紧）

要改的每个文件，#10 都在改（`gh api --paginate` 拿的完整清单，816 个文件）：

| 文件 | #10 的改动 |
| --- | --- |
| `agent-preset-bridge.mjs` | +13/−1，其中已经加了 `if (child) installRequestConfig(..., { compatibilitySettings: false })` |
| `session-runtime.mjs` | +175/−17 |
| `conversation-context.mjs` | +170/−37 |
| `request-config.mjs` | +19/−2 |
| `session-snapshot.mjs` | +1/−0 |
| `tool-policy.mjs` | +1/−0 |
| `preset-model-bindings.mjs` | 新增 +27，从预设读 `subagentModelSelection` |

也就是说 #10 已经做了两件本文原本要做的事：打开 `if (!child)` 的一半、用**预设级**开关决定子 Agent 的模型。
所以：

- 动手时不要 rebase #10，而是**在 #10 定案后按本文的步骤重放一遍**（改动小、集中）。
- §3.4 与 §4 里的「模型」那一条，要先看 #10 的 `resolvePresetModelBindings` 定成什么形状。
- 本文剩下的、#10 没做的：**子 Agent 的文件根（§3.1）**、**不许静默降级（§3.3）**、
  **per-child（而不是预设级）的覆盖（§4）**。

## 8. 还没定的

- 公共接口的名字与归属：新产品服务，还是并进 `eleckoiConversationLifecycle`。
- 身份键：`runtimeSessionId` 够不够；要不要带子 Agent 的序号。
- 多参与者优先级。
- 子 Agent 的显示与收尾（另开一张：不进请求预览、快照不删、`turn/end` 对子 Agent 跳过）。
- 主聊天第一轮不通知插件（另开一张）。

## 9. 证据强度

- **读源码确认**（本机 `wt/rfc9-ask2` = `d4b6bb9`）：第 1、5、6、7、10、11、12、13 条。
- **读官方产物确认**（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/`，0.2.0-rc.2）：
  第 2、3、4、8、9 条。这些行号在产品树里可能偏移。
- **读 PR #10 的补丁**（GitHub API）：§7 的表格。
- **未验证**：没有把插件真装进未打补丁的 v0.2.8 看现象；第 11 条的并发覆盖只读到机制，没复现；
  §4 的签名是我写的候选，上游没有表态；§3、§5 的改动量与验收是估的。
