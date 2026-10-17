# ADR 0039：DeepSeek 独立搜索与网页抓取接入 DSH Web

## 状态

已实施，2026-10-17。PC 与 Android 共用 Host 和 Web Client；此次不修改聊天模型适配器。

## 决定

1. `@eleckoi/dsh-web-deepseek` 通过锁定 DSH `ctx.web.registerSearchProvider`、`registerFetchProvider` 注册 `eleckoi-deepseek-api`。由已有联网设置 bundle 挂载，同一 Cordis 生命周期撤销提供器并取消未完成请求；不增加 AI 工具或 IPC。
2. 搜索调用官方 `POST https://api.deepseek.com/v1/tools/search`，网页抓取调用 `/v1/tools/fetch`。设置页通过现有 Settings、Credentials、Typert Remote 分别选择两种提供商，保留原有模型搜索、Tavily 和直接 HTTP 抓取。新提供器默认使用独立 `DEEPSEEK_WEB_API_KEY`，用户也可明确指定已有凭据引用；不从会话身份、模型名称或自定义模型地址猜测凭据和工具地址。
3. 搜索条数使用官方 1–50 范围，默认 10，可选网页正文及地域 IP。查询按官方 128 个 Unicode 字符校验，不截断输入。完整响应保留摘要、片段、正文、日期、来源和排序元数据，工具来源列表继续按官方展示；错误、空结果及取消分别报告，不自动换提供商或把错误伪装为空结果。
4. Fetch 只返回标题和 Markdown 正文，不报告源站 HTTP 状态或最终跳转地址。最小补丁把 WebFetchResult 和工具输出的 `statusCode` 扩展为 `number | null`，保留请求 URL，并在正文写明状态未提供；无状态时使用官方通用工具卡。直接 HTTP 抓取仍保留其真实状态和原有 Web 卡，不把 API 自身的 HTTP 200 当作源站状态。
5. 当前 DSH 工具会把搜索结果裁到 8 条、抓取文本裁到 200000 字符。补丁允许显式 `searchMaxResults: 0` 委托提供器和用户配置决定数量，`fetchMaxOutputChars: 0` 保留完整文本。ElecKoi 联网 bundle 使用这两个配置；正数配置仍沿用原行为。大结果继续进入已有官方输出与溢出策略，不增加私有输出预算。

## 锁定与退役

上游批次为 `0.2.0-rc.2`，源码为 `deepseek-ai/deepseek-harness` 的 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5`。补丁仅涉及 `dsh-web` 的发布声明及 `dsh-tool-web` 的输出合同、渲染和显式配置语义，记录于 pnpm 精确版本补丁及锁文件。

锁定上游同时支持未知源站状态、提供器自主条数和完整抓取输出后，核对真实工具校验、展示与输出策略，删除对应补丁并改用其正式配置；不能仅凭接口同名移除。

## 来源与验收

[DeepSeek Search、Fetch 官方指南](https://api-docs.deepseek.com/zh-cn/guides/search/)与[Search API 参考](https://api-docs.deepseek.com/zh-cn/api/search/)定义接口、授权、字段及限制。回归覆盖真实 API 调用、50 条与多查询结果、长正文末尾、缺失状态、API 错误、取消与卸载，以及正式桌面和 Android profile 的组合和设置持久化。仅桌面运行及共用源码检查不代表新 APK 或真机交付。
