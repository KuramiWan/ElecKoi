# ElecKoi Agent 预设同步协议

本文是 Android 与 Desktop 当前唯一的 ElecKoi Agent 预设交换合同。JSON 与 PNG 只是同一份完整载荷的两种文件外壳，不维护两套字段，也不输出任何第三方预设格式。

## 文件形式

- JSON：UTF-8 编码的完整 `eleckoi.agent-preset` 文档。
- PNG：可预览的 PNG 图片，并且只写入一个关键字为 `eleckoi_agent_preset` 的 `tEXt` 数据块；块值是上述 JSON 的 UTF-8 字节直接 Base64 编码后的结果。
- 同一预设同时导出 JSON 与 PNG 时，PNG 数据块解码得到的 JSON 必须与 JSON 文件逐字节一致。
- PNG 封面优先使用作者头像；头像不是 PNG 或没有头像时允许使用应用默认图，但封面只负责预览，不是第二份业务数据。

## 根文档

```json
{
  "format": "eleckoi.agent-preset",
  "version": 1,
  "preset": {
    "name": "",
    "model_family": "general",
    "model_tags": [],
    "profile": {},
    "active_version_id": "",
    "active_version_number": 1,
    "entries": [],
    "groups": [],
    "regex_rules": [],
    "prompt_positions": [],
    "tool_configuration": {},
    "roleplay_plan": {},
    "expanded_group_ids": [],
    "script_library": { "trees": [], "variables": {}, "enabled": false, "files": [] },
    "versions": []
  }
}
```

`version` 是 ElecKoi 自有预设载荷版本。它与 Character Card V2、酒馆预设版本均无关系。

原生预设导入创建新的预设所有者和版本登记，但保留作者条目、文件夹、自定义插入位置及正则编号。数据由预设所有者隔离，同编号不会覆盖其他预设。脚本可以继续用明确编号控制条目，不根据名称或排列顺序改写源码与设置。原生预设不同版本中的同一条目仍使用其正式编号。

## 必须导出的内容

- 预设名称、模型家族和模型标签。
- 作者名、作者头像、使用说明和更新时间线。
- 当前活动版本 ID、版本号和完整的全部版本历史。
- 每个版本的提示词条目、分组、自定义插入位置、正则、工具收录/启用开关、角色扮演计划和展开分组。
- 开场白、关键词、变量条件、动态控制方式和条目启用状态属于预设作者内容，随所在版本保留。
- 可选的 `script_library` 携带该预设自己的原生脚本记录、设置和源码文件；不包含全局或角色脚本。导入的脚本库默认停用，由用户明确启用后运行。

作者头像写在 `profile.author_avatar`：

```json
{
  "media_type": "image/png",
  "data": "BASE64"
}
```

`tool_configuration` 只保存跨端稳定的工具组 ID：

```json
{
  "included_group_ids": ["builtin:variables"],
  "enabled_group_ids": ["builtin:variables"]
}
```

本机子 Agent 模型配置 ID、模型选择等设备绑定不得写入交换文件。导入后由目标设备保持为空，再由用户在本机选择。

## 明确禁止导出的内容

- 聊天背景、背景参数和角色图片。
- 聊天记录、会话摘要、工具调用轨迹、附件和游玩中的变量状态。
- 会话分支设定覆盖和其他运行时快照。
- 本机模型配置 ID、缓存路径、媒体路径和数据库关系 ID。
- `chara`、`ccv3`、Character Card V2、酒馆预设或其他第三方兼容数据块。
- 旧的第二头像数据块 `eleckoi_agent_preset_avatar`。

## 导入规则

- JSON 与 PNG 必须进入同一个 ElecKoi 解码器。
- 导入时创建新的本地预设 ID 和版本登记，保留每个版本中作者条目、分组、插入位置和正则的正式编号。
- 保留全部版本及活动版本；不得只导入当前内容后重置为 v1。
- 只接受目标端当前存在的稳定工具组 ID，并恢复其收录和启用状态。
- 本机子 Agent 模型选择始终清空。

## 跨端归属

Desktop 与 Android 使用共享 Host 的同一编码器与产品数据服务，分别持有自己的本地数据。第三方预设导入是独立的单向适配入口，不改变 ElecKoi 导出格式。

## 共同验收

1. Android 导出 JSON，Desktop 导入；Desktop 再导出 PNG，Android 导入。
2. Desktop 导出 JSON，Android 导入；Android 再导出 PNG，Desktop 导入。
3. 四次导入后比较作者头像、使用说明、提示词与分组、插入位置、正则、工具开关、角色扮演计划、全部版本和活动版本。
4. 解包所有 PNG，确认只有一个 `eleckoi_agent_preset` 文本块。
5. 对同一预设的 JSON 与 PNG 解包结果做字节比较，必须完全一致。
6. 搜索导出文件，确认不存在聊天背景、会话运行状态、本机模型配置 ID 以及任何第三方兼容字段。

## 正则替换中的 EJS

EJS 写在现有正则规则的 replacement 中，随 regex_rules 保存和传输；沿用全局、预设和角色的正则作用范围，不再提供独立显示模板字段。运行时数据与语法见 [正则 EJS 教程](plugins/regex-ejs.md)。
