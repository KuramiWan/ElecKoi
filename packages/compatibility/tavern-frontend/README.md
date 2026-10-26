# 前端接口适配

本包把已实现的 ElecKoi Author SDK 能力转换为部分 `TavernHelper` 和 `SillyTavern.getContext()` 接口。实现只依赖浏览器和 Author SDK 的公开合同，不访问 Host、Remote、SQLite、文件或模型提供器。

## 支持范围

- 消息：`getChatMessages`、`getLastMessageId`、`getCurrentMessageId`，以及只接受 `message_id / message` 的 `setChatMessages`。消息范围是原生 SDK 已加载的历史窗口，编号按该窗口显式映射到稳定消息 ID。历史分页继续使用 `ElecKoi.messages.pageOlder`；调用控制器 `refresh()` 后更新兼容视图。
- 变量：`getVariables`、`replaceVariables`、`updateVariablesWith`、`insertVariables`、`insertOrAssignVariables`、`deleteVariable`。写入仅用于当前聊天；历史消息变量只读。同步修改保留待提交的内存视图，实际保存通过 SDK，保存失败撤销待提交视图并报告错误；`flush()` 可等待并核对全部待提交操作。
- 输入：`getInput`、`setInput`、`setInputText`。发送、重新生成及其他原生操作继续使用已安装的 `ElecKoi` SDK，不将独立生成冒充聊天发送。
- 事件：`eventOn / eventOnce / eventMakeFirst / eventMakeLast / eventRemoveListener / eventClearEvent / eventClearListener / eventClearAll / eventEmit / eventEmitAndWait`。仅映射 SDK 实际提供的消息、生成和音频事件。自定义事件只在本页面传播；没有独立的全局事件或持久化消息总线。
- 音频：`bgm / ambient` 的已有播放、暂停、列表读取和替换／追加；播放保留已有列表，追加按标题或 URL 去重，进度按正式接口换算为百分比。只使用原生播放器，不安装 TTS 或下载服务；不模拟原生 SDK 没有等价语义的音频模式和启用开关。
- 设定：继续使用现有 `ElecKoi.settingLibrary`。世界书的数字 `uid`、绑定和原生设定编号不能直接等同，因此不提供 `getWorldbook / replaceWorldbook` 等接口，也不新增编号映射或兼容字段。
- 预设：`getPresetNames / getLoadedPresetName` 读取原生目录；不把异步选择预设伪装成同步成功的 `loadPreset`。预设正文、选择、脚本设置及按钮使用原生 SDK 的现有入口。
- 上下文：`SillyTavern.getContext()` 提供只读聊天和当前角色视图、当前聊天 ID、事件及已有的停止回复入口。`characterId` 是当前作用域 `characters` 数组中的索引，不是原生角色编号。兼容视图不可用于任意重写原生历史。

未提供的接口和参数不模拟成功。没有群聊、分词器、向量／文档库、兼容存储、完整宏／Slash 解释器、独立生成、提示词收集或请求改写。同步读取只使用页面内的最新已接收快照，不产生第二份持久数据。

## 页面加载和释放

`prepareFrontendCompatibilitySource` 使用 HTML 解析器暂停作者的可执行脚本，保留 JSON 和 import map；页面所有者挂载原生 SDK 后调用 `mountFrontendCompatibility`，准备内存快照，再按阻塞、defer/module 与 async 的执行方式启动脚本。初始化失败明确返回页面错误。

普通消息 HTML 和未声明原生 SDK 的项目页面使用这个入口。声明 `eleckoi-author-api` 的原生页面继续按原生 `ElecKoiReady` 合同运行。

原生作者插件未启用时，普通 HTML 仍按正常浏览器脚本执行，不安装伪造的 SDK 或同名接口；脚本若调用不存在的接口，沿现有页面诊断报告实际错误。

页面退出、聊天归属变化或卸载会撤销同名全局对象和监听器，释放 SDK。保留下来的函数不能继续调用已关闭页面；错误不会转发到后来选择的聊天。

本包没有一次性迁移或旧数据转换。数据库结构、Session 格式和原生领域合同不随本包改变。
