# ADR 0024：官方 ChatView 与角色消息座位

状态：已采纳。

## 背景

此前角色界面只使用官方 Composer 和 Markdown，消息列表、尾部跟随和历史位置补偿仍由 Renderer 自行维护。两套滚动所有者不应长期存在。已完成的 Session 正文、明确消息身份、同一 Session 重载和过期订阅隔离不能因视图接入被撤销。

基准是 `deepseek-ai/deepseek-harness` 提交 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 的 `conversation.view` / `chat` 注册项、`ChatView`、`ChatNodeSeat` 和 `useChatScroll`。

## 决定

1. 通过 Client Slots 投影官方 `chat` 注册项，保留其 inject、store、locale、children 和 Session 作用域。角色界面不导入包内私有组件，不维护另一份滚动算法。
2. 使用官方 ChatNodeList、ChatNodeSeat 和 Session 节点订阅。用户正文按正式事件 seq／requestId 定位；AI 正文按 DSH Turn 定位到稳定的 `turn-process` 座位。流式与结束态不切换座位，不用内容或相邻角色配对。
3. 角色显示仅替换消息座位的呈现，正文继续来自现有 DSH Session 投影，保留头像、时间戳、楼层、最终正文边界、媒体、产品插件插槽和操作。过程详情仍由产品的轨迹入口呈现，角色正文不展开全部工具步骤。
4. 删除 Renderer 的尾部跟随与历史补偿 Hook。尾部跟随、500ms 阅读采样、25px 底部判定、历史分页、Turn 导航、每 Session 阅读位置和返回底部按钮全部由官方 ChatView 负责。
5. 删除、编辑、回退和重新生成仍调用现有产品 Remote 和同一 Session 重载；不连接官方 `forkAt`，不创建新 Session。
6. 官方 InputBar 的 `data-input-scroll` 是输入正文唯一滚动容器。产品 Composer 座位补齐官方的 `--dsh-composer-text-max-height: 336px` 契约，使长文本触发其 `overflow-y: auto` 和主题原生滚动条；不另造滚动组件。缺少此变量会让官方 max-height 无效，正是此前长文本不能按官方上限滚动的原因。
7. 对话区采用同版本 `ConversationContent` 的布局合同：单个全高滚动容器包含消息区和贴底的 sticky Composer，滚动条覆盖整个对话区；不再把 Composer 留在滚动容器外的独立 Grid 行。Composer 与滚动容器的尺寸共同发布官方高度变量。ChatView frame 和 TurnNavigator 不带产品横向 padding，头像与正文留白只位于其 reading 层，导航保持官方 `right: 12px`、滚动区边缘间距与遮挡计算；返回底部控件继续读取官方 Composer 高度，不再用固定 16px 覆盖。移除产品滚动条的宽度、灰色与悬停覆盖，使用实际装配的官方主题滚动条样式。

## 最小上游扩展

锁定版本的待提交用户消息是 ChatNodeList 内的直接组件，没有呈现插槽；角色开场白属于产品数据，不能伪造为 Session 事件。为这两个显示边界增加 `conversation.chat.pending-input` 与 `conversation.chat.before`。重新生成复用原用户事件，不创建交接行，详见 [ADR 0025](0025-same-session-existing-input-regeneration.md)。

运行状态新增可选 `runningStatusTarget` DOM 挂载点，ChatView 将同一个官方 RunningStatus 通过 React portal 放入 Composer 上方固定座位；不进入消息滚动列，不绝对定位，不改计时器。未提供挂载点时保留官方默认位置。产品固定座位不显示官方分割线。

同一输入的重新生成会产生新的执行 Turn，而官方导航默认一枚标记对应一个执行 Turn。增加可选 `presentTurnNavigation` 纯呈现入口，把合并后的官方 rail 映射为一枚标记对应一个正式用户事件，并可提供独立的显示轮次；标记仍携带原用户 Turn 的正式 loaded key 或 unloaded seq，活动与忙碌执行映射到同一输入标记。保持官方 TurnNavigator、预览、虚拟化、点击回调、分页和滚动算法；没有该入口时行为不变。这是角色轮次语义所需的有限扩展，不是锁定版本已有的原生配置，也不重新编号 Session。

补丁增加呈现插槽、公开类型及中性的 DOM 布局标记，并移除消息列内随 openState 切换而插入、移除的“载入历史…”提示行，避免已有消息被这一行推移；后台载入、载入失败提示与历史分页继续保留。不修改 ChatReading、ChatViewport、ChatNavigation、ChatNodeList 排序、待提交去重和 Session 数据。由 pnpm 精确锁定补丁，升级上游时重新核对并优先删除已被上游公开扩展覆盖的部分。

## 回归边界

覆盖删除后发送、单删 AI 后重新生成、流式结束不换座位、正式用户输入接替待提交回显、不同 Session 隔离、分页及阅读位置恢复。测试仅使用合成身份与内容。未执行构建或真实界面检查时不得宣称这些检查已通过。
