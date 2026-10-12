# ADR 0035：Android 更新检查与平台发布识别

## 状态

已采纳，2026-10-12。补充 [ADR 0031](0031-android-local-node-host.md)。

## 决定

1. 新 Android 应用身份固定为 `com.eleckoi.app`。不增加包名转换或数据导入路径。
2. APK 更新检查属于 Android 壳职责，使用应用级管理器、网络请求、JobScheduler 和通知渠道。原生平台桥仅暴露更新状态、检查和打开下载页；不承载角色、聊天或产品数据，不增加 Host 标准流命令或自有业务 IPC。
3. 更新源固定为 `https://github.com/eleckoi/ElecKoi`。检查完整分页中的已发布稳定 Release；只有带唯一 `android-update.json` 正式资产的 Release 才是 Android 候选。按 `published_at` 选择最近的 Android 发布，不按 APK 名称、列表排列或通用 latest 猜平台。分页到达上限仍有下一页时明确失败。
4. 描述文件版本为 1，声明 `platform=android`、`applicationId`、`versionCode`、`versionName`、`apkAsset` 和 `sha256`。包名必须匹配当前 APK，源码版本号必须正整数，APK 必须是同一 Release 中准确命名的唯一已上传资产。错误描述或歧义明确失败，不能显示为已是最新。
5. Activity 启动检查设一小时成功检查间隔，后台每天由系统调度，关于页可以手动检查。网络和解析失败提供可诊断状态；自动失败不弹错误对话框，不覆盖已有可用更新。通知只在存在更大的 Android versionCode 且同一版本未成功通知时发送，未授予权限时不记为已通知。
6. 通知和应用内更新弹窗都打开对应 Release 或 APK 下载页，不执行静默安装。PC 继续使用现有 Electron 更新服务；Android 不订阅 Electron 更新桥。
7. 同一 Release 可以同时包含 Windows 与 Android 资产，也可以只发一端。正式 Android 发布必须递增 versionCode。只发 Android 的 Release 不设为 GitHub latest，保留现有 Windows 客户端的 latest.yml 查询路径；本次不新增发布工作流，也不发布远端版本。

## 验证

通过合成 Release、正式描述与 APK 资产覆盖 Windows-only、混合发布、Android-only、乱序、分页、错误身份、歧义、预发布和版本比较；运行真实原生解析测试及共享界面回归。安装新包后核对启动、后台任务、手动检查和新身份。
