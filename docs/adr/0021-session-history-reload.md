# ADR 0021：同一 Session 的历史修改与客户端重载

## 状态

已采纳，2026-10-02。

## 原因

锁定 DSH `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 的 `ClientSessions` 由主视图、侧栏等消费者共同 retain。释放单个产品页面引用不能结束共享代。Host 关闭写入句柄会发送 `api-session/removed`；旧 Client Session 的 `removed` 状态不会因重新加入目录而复位。日志回退后旧投影的序号水位也不再有效。

官方公开客户端合同没有用于同一 Session 日志回退的重载方法；官方分叉另建 Session 不符合产品要求。

## 决定

- 在锁定的 Session Controller 包上追加明确的 `ctx.sessions.reloadHistory(sessionId)` 合同。它通过已有 Session 的历史重开机制更新全部共享消费者，保留 Session、binding 与订阅者身份，清除旧投影水位、关闭状态和旧请求错误。
- 产品 Client 在编辑、删除、回退期间暂停自动重连，等待原 Session 的关闭通知，再重载当前历史。不得只重置页面状态或隐藏关闭错误。
- 重新生成分为准备和执行两个 Remote 操作。准备阶段保留待重放的正式用户消息和附件，安全回退同一日志；Client 完成重载后才能执行。待执行记录属于 Host API 的临时操作状态，执行或取消时消费，不写数据库。
- 当前请求错误仍通过官方控制事件和正式轮次结束事件传递；停止使用官方 Session cancel。重载必须先于新请求，不能清除新请求的失败。
- 角色聊天统计在重新生成的准备和等待阶段保留上一份完整显示快照；新轮次首次 `step/end` 更新官方 `sessionStats` 后整体交接，失败或取消时立即回到当前日志的统计。官方 StatsPills 的角色聊天 Slot 适配与上下文读数共用这份显示快照；数据计算仍由 Host projection 独占，轨迹和其他插件继续读取原始官方 projection。切换聊天与卸载立即清空显示快照。

## 验证

覆盖共享引用未释放、关闭通知晚于准备响应、旧序号水位高于新日志、冷启动重新生成、连续重新生成、失败后重试及停止。实际 Electron 验证保持原聊天与 Session ID，不产生分叉。
