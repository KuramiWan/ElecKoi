# ADR 0041：Bug 报告的两条投递通道（邮件与收件箱仓库）

## 状态

已采纳，2026-10-27。契约在 [`packages/shared/src/contracts/bugReport/`](../../packages/shared/src/contracts/bugReport/)，由 `packages/shared/tests/bug-report.test.ts` 守着。桌面端与 Android 端的收集入口、发送入口、收件箱仓库的折叠 workflow 与 zip 导出按同一契约分平台补齐，本轮只落契约。

## 背景

用户反馈现在只有一条路：QQ 群（`CommunityDialog` 里的群号）。维护者拿到的是"我这边闪退了"这种句子——没有版本、没有失败码、没有日志尾，来回问三轮才知道是哪一步。

仓库其实已经把诊断信息准备齐了：[ADR 0040](0040-error-contract.md) 让每次失败带契约码与参数化详情，`AppLog` 给每次运行写会话首尾，"有 start 没 end 就是崩溃或强杀"（[错误处理协作声明](../error-handling.md)）。缺的只是把这份信息送到维护者手里的一段。

先要回答"送到哪里"：

1. **自建服务器**（自托管 Sentry、GlitchTip、自写端点）。个人维护的开源桌面应用，没有运维预算、没有 SLA，也不该多一个需要备份和防滥用的东西。排除。
2. **托管错误服务**（Sentry / Bugsnag 的 SaaS 免费档）。能按 fingerprint 聚合并计数，额度也够，但数据出境要单独征得同意，要推翻 [ADR 0040](0040-error-contract.md) 决定 1 的"不引入运行时错误服务"，而且 Windows 与 Android 要各上一套 SDK。留作量变大后的备选。
3. **邮件**。不占 issue 列表，不需要用户的 GitHub 账号，也不需要接收端点——用户本来就有邮箱。
4. **GitHub issue**。天然可追踪、可引用、可附附件，但两个硬伤：目标用户大多没有 GitHub 账号；每条报告开一个 issue 会淹没列表——issue 没有 fingerprint 聚合，那是另一类服务的核心功能。

3 和 4 覆盖的是不同的人：邮件覆盖"随手反馈"的大多数，issue 覆盖"愿意细致描述、也愿意被追踪"的少数。所以不是二选一。

## 决定

1. **两条通道并存，由用户在发送时选：邮件或收件箱仓库的 issue。** 第三条兜底是导出 zip，用户自己附在群里或邮件里。三条共用同一份报告。
2. **报告是用户发起的导出，不是后台常驻上报。** 不启动 `crashReporter`（它的 `submitURL` 必填，等于必须有接收端），不引入 Sentry / Bugsnag SDK。[ADR 0040](0040-error-contract.md) 决定 1 的"不引入运行时错误服务"继续有效——本记录不推翻它，只是给"上报"补一条用户可触发的出口：出口仍然是 `AppLog`，加上用户主动的导出。
3. **一份报告，两个格式化器。** `BugReport` 形状、校验、失败折叠与脱敏在 `contracts/bugReport/`；邮件正文与 issue 正文各有格式化器，主题与去重键共用 `bugReportSubject` / `bugReportSignature`。`schemaVersion` 显式，字段只增不改。
4. **issue 通道进收件箱仓库，不进化码主仓库。** 报告先落到一个独立仓库（例如 `KuramiWan/eleckoi-reports`），workflow 按签名折叠：同一签名追加成评论并关闭新 issue，不同签名才留成一条聚合 issue。主仓库的 issue 列表一条都不涨，值得修的再由维护者引用过去。**这是用户发起提交，不是客户端自动建 issue**——后者需要一个 token 或端点，见否决表。
5. **仓库里不硬编码收件邮箱，也不硬编码收件仓库。** 公开仓库里的地址会被爬虫抓走。两者都由发布配置注入，契约只提供 `buildBugReportMailto(report, mailbox)` 与 `buildBugReportIssueUrl(report, { repository })`。
6. **脱敏是纯函数，日志尾默认不带。** `redactReportText` 与 `redactBugReport` 覆盖家目录（Windows / macOS / Linux）、Android 沙箱路径、用户名、邮箱与常见凭据参数；日志尾默认关闭，用户勾选才带。两条通道共用同一份脱敏结果。
7. **长度按编码后计算，超限降级成摘要。** 正文装不进 `mailto:` 或 issue URL 时只带签名与摘要，全文交给剪贴板；宁可多一步粘贴，也不要发出半份日志。
8. **Windows 与 Android 共用一份契约。** 两边各写收集与入口，字段、主题、脱敏规则一致。

## 与已有记录的关系

- [ADR 0040](0040-error-contract.md) 决定 1：不引入运行时错误服务。本记录不推翻这条——报告是用户发起的导出，没有常驻上报器。
- [ADR 0040](0040-error-contract.md) 决定 4 / 9：用户可见文案只在渲染层产生。报告里的字段是数据，不是句子；界面上的说明由渲染层写，契约不拼用户文案。
- [ADR 0017](0017-dsh-remote-replaces-desktop-gateway.md)：不新建业务通道。导出走主进程既有的最小 IPC 面，不新开网关。
- [ADR 0028](0028-multi-application-workspace.md)：跨应用合同的归属。报告形状进 `packages/shared/src/contracts/`，两端各自实现收集。
- [ADR 0035](0035-android-update-checks.md)：Android 侧用 GitHub Release API 做版本分发，那是更新通道，与本记录无关。

## 否决的方案

| 方案 | 为什么不用 |
| --- | --- |
| 客户端自动建 issue（内嵌 GitHub token） | 公开仓库里发布即泄露，拆包就能拿到。 |
| 端点代建 issue（Worker / 函数） | "无服务器"只是名义上的，仍然要部署、要防滥用、要管密钥。 |
| 报告直接进主仓库 issue | 会淹没主仓库；要修的问题和"又来一条同类报告"混在一起。 |
| Sentry / Bugsnag 的 SaaS 免费档 | 数据出境要单独征得同意，且要推翻 ADR 0040 决定 1。 |
| 客户端内嵌 SMTP 授权码 | 同 token：发布即泄露。 |
| Windows 自带 WER / App Center | WER 要注册开发者服务；App Center 已停止服务。 |

## 后果

- **没有自动到达的报告。** 收到多少取决于用户是否点"发送"。这是刻意的取舍：不需要服务器，也就意味着没有后台推送。
- 要多养两样东西：一个收件箱仓库（含折叠 workflow）和一个收件邮箱。两者都不影响主仓库。
- 邮箱侧靠主题前缀 `[ElecKoi]` 建规则；issue 侧靠正文里那行隐藏的签名注释块折叠。
- 若将来量变大要自动化，`BugReport` 已是稳定形状，接端点不用改客户端。
- 本轮不做：诊断包的收集实现、桌面端入口、Android 端入口、zip 导出、收件箱仓库的 workflow。
