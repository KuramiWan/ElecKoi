# ElecKoi 角色卡同步协议

本文是 Android 与 Desktop 当前唯一的 ElecKoi 角色卡交换合同。两端必须以同一份领域载荷完成 JSON / PNG 往返，不以第三方角色卡标准定义产品数据。

## 文件形式

- JSON：UTF-8 编码的完整 `eleckoi.character-card` 文档，可直接导入。
- PNG：正常可预览的 PNG 图片，并且只写入一个关键字为 `eleckoi-card` 的 `tEXt` 数据块；块值是上述 JSON 的 UTF-8 字节经 gzip 压缩后再 Base64 编码的结果。
- 同一角色同时导出 JSON 与 PNG 时，两者解码后必须得到语义相同的根文档。
- ElecKoi 导出禁止写入 `chara`、`ccv3`、`chara_card_v2` 等第三方兼容载荷。第三方格式若保留，只能作为用户明确选择的单向导入适配器。

## 根文档

```json
{
  "format": "eleckoi.character-card",
  "version": 1,
  "character": {},
  "assets": [],
  "setting_library": "{...}",
  "variable_config": "{...}",
  "regex_rules": [],
  "script_library": { "trees": [], "variables": {}, "enabled": false, "files": [] }
}
```

`version` 是 ElecKoi 自有载荷版本，不是 Character Card V2。当前版本为 `1`；`script_library` 是可选字段，未包含脚本的文件不需要写入它。

## 必须导出的内容

### `character`

- `name`
- `group`
- `frontend_beauty_enabled`
- `profile_age`
- `profile_sex`
- `profile_height`
- `profile_birthday`
- `profile_like`
- `image_prompt`
- `opening`
- `show_opening`

### `assets`

固定键只有：

- `avatar.circle`
- `avatar.square`
- `avatar.portrait`

每项包含 `key`、实际图片 MIME 类型 `media_type` 与 Base64 字节 `data`。不存在的图片不写空附件。

### `setting_library`

值为 `eleckoi.setting-library-snapshot` JSON 字符串，必须包含当前母设定库的全部版本和 `active_version_id`。设定条目自身的关键词、触发条件、启用状态、动态控制方式、开场白及开场白初始变量等均属于作者内容，必须保留。

这里只读取角色母设定库，不读取任何会话的 `conversation_setting_changes`。

原生角色卡导入创建新角色所有者，普通条目、文件夹、自定义插入位置、开场白选项及变量版本的作者编号保留；固定开场白容器使用产品规定的固定编号。角色配置中单独导入 ElecKoi 设定库为新版本时同样保留条目编号，开场白的 `variable_version_id` 随原有绑定导出和读取；目标角色必须拥有该变量版本，否则保存明确失败，不自动删除绑定或猜测另一版本。设定库文件不携带另一角色的变量配置，完整角色卡才一起携带这两部分。

“并入设定”和复制条目是明确创建副本的操作，会为新副本分配新编号，不等于整体导入。作者脚本不会自动改为控制副本，也不按同名条目推断引用关系。

### `variable_config`

值为 `eleckoi.variable-config` JSON 字符串，必须包含全部作者配置版本和 `active_version_id`，包括变量定义、对象定义、Schema、默认/初始状态和更新规则。

这里的初始状态是作者配置，不是游玩中的会话变量状态；不得读取 `chat_session_variable_states`。

### `regex_rules`

只包含该角色自己拥有的正则规则，按 `order` 排序。每项字段为：

- `id`
- `name`
- `pattern`
- `replacement`
- `targets`
- `enabled`
- `display_only`
- `prompt_only`
- `run_on_edit`
- `order`
- `trim_strings`
- `min_depth`
- `max_depth`
- `substitute_regex`

`enabled` 是随角色卡携带的当前启用状态。不得导出全局正则、Agent/提示词预设正则，也不得把混合多个作用域的全局启用版本塞进角色卡。

### `script_library`

只包含角色自己的原生脚本库：`trees` 保存脚本记录与分组，`variables` 保存脚本设置，`files` 携带对应源码文件。全局脚本和预设脚本不进入角色卡。导入时源码保存到目标端脚本目录，角色关联与脚本设置由产品数据服务保存；新导入的脚本库默认停用，由用户明确启用后运行。

## 明确禁止导出的内容

- 聊天背景图片、背景来源模式、透明度、模糊度、遮罩参数。
- 会话分支设定覆盖。
- 会话运行时变量状态。
- 聊天记录、摘要、工具轨迹和附件。
- 当前用户资料、用户头像。
- 全局正则、Agent/提示词预设正则及它们的启用版本。
- 本机路径、缓存路径和数据库主键关系。

角色前端项目可以在角色配置中单独创建、导入和管理，但暂不属于角色卡交换载荷。需要随角色卡携带时，必须先补齐领域合同与往返测试。

## 导入规则

- ElecKoi JSON：识别根对象的 `format` 与 `version` 后直接解码。
- ElecKoi PNG：只读取 `eleckoi-card`，解压后走与 JSON 完全相同的解码器。
- 导入时创建新的本地角色 ID，并把设定库、变量配置和角色正则重定向到新角色；载荷中的本机关系不得直接复用。
- 缺少可选图片时只留空对应槽位；PNG 自身的预览图仅可作为三套图片全部缺失时的兜底。

## 输入边界

完整角色卡的文件与 PNG 载荷解压上限均为 96 MB，嵌入图片附件的解码后总大小上限为 48 MB。酒馆角色卡只能从单独的酒馆导入入口进入，不作为 ElecKoi 原生文件的兜底解码路径。

## 共同验收

1. Android 导出 JSON，Desktop 导入；再由 Desktop 导出 PNG，Android 导入。
2. Desktop 导出 JSON，Android 导入；再由 Android 导出 PNG，Desktop 导入。
3. 四次导入后逐项比较角色资料、三套图片、设定库全部版本与活动版本、变量配置全部版本与活动版本、角色正则与启用状态。
4. 解包所有 PNG，确认只有一个 `eleckoi-card` 角色卡文本块，且不存在 `chara` / `ccv3`。
5. 搜索导出 JSON，确认不存在 `chat_background`、`conversation_setting_changes`、`chat_session_variable_states`、聊天记录、用户资料、全局/预设正则。

## EJS显示模板

原生 JSON 与 PNG 数据携带 `ejs_display_templates: { enabled, templates }`。每个模板包含稳定 id、唯一 name、enabled、position、pattern、flags、source、delimiter、openDelimiter、closeDelimiter、rmWhitespace；position 为 before/after/replace/partial。导入校验字段、唯一名称和编号，保持引用及顺序，库保持停用，不携带源 ownerId 和 revision。库独立于设定版本。详见 [显示模板教程](plugins/ejs-display-templates.md)。
