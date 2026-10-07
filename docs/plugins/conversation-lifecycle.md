# 插件参与聊天流程

这组入口让 Host 插件在 ElecKoi 已有聊天流程中一起工作。可用于记忆、检查、资料准备等插件，不要求启用智能体团队。

## 已开放的三处入口

| 需要做的事 | 入口 | 程序会做什么 |
| --- | --- | --- |
| 用户发消息时先准备资料 | `prepare` | 提供本次输入、角色资料、完整设定库配置、预设、模型及操作编号；等插件完成再准备模型请求 |
| 正式保存后更新插件记忆 | `afterSave` | 先确认官方 Session 持久保存及产品变量保存，再等待插件；失败时保留已经保存的正文和变量 |
| 删除消息或重新生成时退回插件记忆 | `prepareRestore` | 告诉插件回退位置及产品目标状态；插件提供 apply/rollback，任何一步失败都尝试恢复之前的状态 |

三个回调通过 `ctx.eleckoiConversationLifecycle.register()` 一次登记，可只提供需要的回调。注册项随调用插件卸载自动删除，停用时给正在运行的回调发出取消信号，并等待它完成。回调应遵守 `signal`，自己等待子任务结束；不要启动未等待的后台工作。

设定库的 `entries`、触发方式、必读/选读配置及 `promptPositions` 保留完整结构。接口没有把它们转换成普通文本，也没有重新定义现有插入规则。`runtime.conversationContext.history` 只包含产品准备的开场前缀；完整历史继续用官方 Session 查询。`model` 是本次准备选择，实际请求路由仍以官方 `agent/request` 和日志为准。

## Host 注册示例

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@eleckoi/dsh-product-api'

export const name = 'example-chat-memory'
export const inject = ['eleckoiConversationLifecycle']

export function apply(ctx: Context) {
  const memory = new Map<string, number>()
  ctx.eleckoiConversationLifecycle.register({
    id: 'example-chat-memory',
    async prepare(input, signal) {
      signal.throwIfAborted()
      // input.runtime 保留角色、设定库、变量、预设的完整准备数据。
      // 这里等待自己的任务；Agent 创建、通信、请求修改使用 DSH 官方能力。
    },
    async afterSave(result, signal) {
      signal.throwIfAborted()
      memory.set(result.conversationId, result.turn)
    },
    prepareRestore(input) {
      const previous = memory.get(input.conversationId)
      return {
        apply() { memory.set(input.conversationId, input.fromTurn - 1) },
        rollback() {
          if (previous === undefined) memory.delete(input.conversationId)
          else memory.set(input.conversationId, previous)
        }
      }
    }
  })
}
```

示例只演示流程，不是长期记忆存储。重启后需要保留的内容由插件使用自己的正式存储能力保存。`prepareRestore` 先准备方案，改动在 apply 中进行；rollback 必须能够还原部分完成的 apply，且不能重复产生副作用。

## 等待本次保存和插件收尾

```ts
const prepared = await ctx.remote.eleckoiConversations.preparePrompt(conversationId, text, signal)
if (!prepared.ok) throw prepared.error
const operationId = prepared.value.operationId
// 用官方 Session 输入能力开始生成，并等待这次官方运行结束。
const finished = await ctx.remote.eleckoiConversations.waitForGeneration(conversationId, operationId)
if (!finished.ok) throw finished.error
```

`waitForGeneration` 只等待当前进程已经开始的保存工作，不启动模型。调用方先等待这次官方 Session 运行结束，再等待产品保存；尚未进入保存流程或操作不属于当前轮次时明确报错。正式输入框和 ElecKoi 的发送/重新生成流程已接入。

每条聊天只保留当前操作的等待 Promise，下一次准备替换，删除聊天及 Host 卸载清空。保存或插件收尾失败通过调用错误及变更事件报告；插件收尾失败不撤销已经保存的正文和变量。停止生成时不调用 afterSave、不提交本轮变量，是否停止仍以官方 Session 结果为准。

这组入口没有生成结果表、历史结果查询或重启前的收尾状态恢复。Host 重启后旧操作编号不能继续等待，也不会自动重放插件工作。`afterSave` 只提供本轮操作、聊天、Session 和轮次编号；插件长期记忆及恢复由插件自己的正式存储能力负责。

## 范围与验证

界面使用官方 Slots，Agent 工具、通信、模型和上下文修改使用 DSH 官方服务及事件。入口不分配资料权限，也不新增团队模型设置界面。prepare 的参数是独立副本；改变副本不会改写产品设定或请求。

消息回退覆盖 `deleteMessagesFrom` 和 `regenerateMessage`，保留原聊天及 Session 编号。整条聊天删除、直接编辑正文、突然断电后第三方文件恢复不属于这组回调的保证。运行期 rollback 失败会报告错误；插件应根据自己的持久记录处理恢复。

| 实际流程 | 验证位置 |
| --- | --- |
| 回调等待、顺序、取消、Cordis 卸载、同聊天互斥 | `tests/dsh-conversation-lifecycle.test.ts` |
| 真正官方 AgentLoop、Session.flush、保存后收尾、失败结果、磁盘重开 | `tests/dsh-conversation-generation-save.test.js` |
| 历史状态恢复、原 Session 重新生成、准备失败恢复 | `tests/dsh-historical-runtime-state.test.js`、`tests/dsh-old-chat-generation.test.js` |
| 官方 Typert Remote 调用、完整数据库迁移及结构合同 | `tests/dsh-product-remote.test.ts`、`tests/database.test.ts` |

方法与参数由 [Host 完整参考](api-host.md)、[Remote 完整声明](api-remote.md)、[Host 数据类型](types-host.md) 自动生成。`pnpm check:plugin-docs` 检查类型与 manifest 成员是否遗漏，流程测试验证实际行为。实现依据及跨存储边界见 [ADR 0027](../adr/0027-conversation-plugin-lifecycle.md)。
