# ADR 0027：通过官方 DSH 合同开放聊天流程参与入口

## 状态

已采纳，2026-10-06。

## 决定

以锁定的 DSH `0.2.0-rc.2`、提交 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 为准，产品 Host 提供 `ctx.eleckoiConversationLifecycle.register()`。第三方 Host 插件通过 Cordis `inject` 使用服务，注册生成前准备、保存后收尾、消息回退处理。注册归调用插件的 effect 管理，插件卸载取消并等待正在执行的回调。客户端调用使用 Typert `@Remote`、构建生成的声明及 `ctx.remote`。

官方来源：[Cordis 教程](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/cordis-tutorial/index.zh.md)、[架构](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/architecture.zh.md)、[Session.flush](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/packages/core/session/src/index.ts)、[API Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/api-gateway.zh.md)。

## 行为及所有权

1. 生成准备沿用产品已有的资料、设定库结构、预设及官方模型选择，不改变触发规则、注入位置或成员模型策略。准备回调完成后才写入本次请求资料；调用取消信号传递给插件。每次重新生成使用新的操作编号，聊天和 Session 编号不变。
2. `session/event` 是同步事实通知，不是可等待的完成回调；`agent/turn-stopping` 在 `turn/end` 之前，不能把它当成正式保存完成。产品在 `turn/end` 后安排独立的保存工作，调用官方 `ctx.sessions.flush(session)`，再保存产品变量，最后等待插件收尾。客户端和下一次准备通过产品 Remote/service 等待这项工作，官方 Agent 的 idle 状态本身不代表产品收尾完成。
3. 本批未发布变更移除生成结果表及重启结果查询；每条聊天只在 Host 内存保留当前操作的等待 Promise，下一次准备替换，删除聊天及 Host 卸载清空。同一当前操作不重复安排保存；变量在生成期间被其他操作修改时拒绝旧结果覆盖。数据库 v8 → v9 只新增开场白变量版本绑定，已有开发库的原子整理见 [数据库说明](../DATABASE.md)。
4. 消息删除及重新生成先让全部插件准备回退方案，再在现有同 Session 编辑流程中应用。回调或产品编辑抛错时按相反顺序调用插件 rollback，恢复产品状态、资料文件和 Session 日志。恢复失败明确报告，不能静默当成成功。同一聊天的准备与回退互斥，其他聊天独立。

## 实际边界

DSH Session、产品 SQLite 和第三方插件自身文件不属于一个跨存储事务。收尾失败通过当前调用及变更事件报告，已经保存的正文和变量保留。Host 重启后不提供历史收尾结果，也不自动重放插件副作用。消息回退的 rollback 处理运行期异常，不承诺突然断电时第三方文件自动恢复。第三方插件必须自行保存其长期记忆及恢复进度。

本次入口服务于所有 Host 插件。团队分工、成员通信、资料权限限制、独立成员模型、试演和执行记录界面仍由各自能力负责。整条聊天删除及直接修改消息正文不冒充本次消息回退入口。

公开调用、示例及逐项验证见 [插件参与聊天流程](../plugins/conversation-lifecycle.md)。
