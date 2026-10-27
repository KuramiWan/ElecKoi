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
  "regex_rules": []
}
```

`version` 是 ElecKoi 自有载荷版本，不是 Character Card V2。当前版本保持为 `1`；本次新增 `regex_rules`、停止输出无业务意义的可选字段属于向后兼容收口。

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

原生角色卡导入创建新角色所有者，普通条目、文件夹、自定义插入位置、开场白选项及变量版本的作者编号保留；固定开场白容器使用产品规定的固定编号。角色编辑器将“角色开场白”单独放在“设定库”上方，主开场白、备用开场白及变量绑定在该页面编辑。现有保存结构和版本归属保持不变，多版本角色可在开场白页切换所属版本。

单独导出设定库只包含设定，不包含角色开场白；导入此类文件为新版本时保留目标角色当前的开场白和变量绑定。旧设定库文件明确携带的开场白仍完整导入，目标角色必须拥有其绑定的变量版本，否则保存明确失败，不自动删除绑定或猜测另一版本。完整角色卡导出仍包含全部版本的开场白、变量配置及绑定。

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

## 明确禁止导出的内容

- 聊天背景图片、背景来源模式、透明度、模糊度、遮罩参数。
- 会话分支设定覆盖。
- 会话运行时变量状态。
- 聊天记录、摘要、工具轨迹和附件。
- 当前用户资料、用户头像。
- 全局正则、Agent/提示词预设正则及它们的启用版本。
- 本机路径、缓存路径和数据库主键关系。

沉浸前端项目暂不属于这份跨端共同合同：Desktop 目前没有与 Android 相同的角色级持久化领域模型。任一端不得单边把它当成“已同步”字段；需要纳入时必须先为两端补齐同一领域合同和往返测试。

## 导入规则

- ElecKoi JSON：识别根对象的 `format` 与 `version` 后直接解码。
- ElecKoi PNG：只读取 `eleckoi-card`，解压后走与 JSON 完全相同的解码器。
- 导入时创建新的本地角色 ID，并把设定库、变量配置和角色正则重定向到新角色；载荷中的本机关系不得直接复用。
- 缺少可选图片时只留空对应槽位；PNG 自身的预览图仅可作为三套图片全部缺失时的兜底。

## Android 当前必须修改

1. `PngCharacterCardFormat.encode` 删除 `chara` 的生成和写入，只写 `eleckoi-card`。
2. `CharacterCardJsonCodec` 删除 ElecKoi 导出链路中的 `StandardKeyword`、`encodeStandard` 以及 `PortableCharacter` 的全部 `chat_background_*` 字段；显式第三方导入适配器可以独立保留自己的解析模型。
3. `PortableCharacterPackage` 增加 `regexRules`；`portablePackage` 从 `regexRules.load(characterId).characterRules` 读取并编码，导入后恢复这些规则和 `enabled` 状态。
4. `JsonCharacterCardFormat.decode` 先识别 `format == eleckoi.character-card` 并调用完整载荷解码器，不能再把所有 JSON 都交给基础角色卡解析。
5. 导出服务/API/UI 增加 `PNG`、`JSON` 两种格式；JSON 直接写根文档，PNG 包装同一根文档，文件名只改变扩展名。
6. `portablePackage` 不再收集 `frontends`；在两端建立共同持久化合同前，不允许 Android 单边把它标为跨端完整数据。
7. 导入 ElecKoi PNG 时不再以 `chara` 兜底。若产品继续提供酒馆导入，必须通过单独的 `SillyTavern` 导入来源进入。
8. 更新 Android 的 `docs/architecture/character-card-transfer.md`，删除“双数据块”“基础互通”“导出聊天背景”和“已同步沉浸前端”等错误描述。
9. JSON 包含图片 Base64 后会比 PNG 内的 gzip 载荷更大；Android 与 Desktop 不设置角色卡总大小、解压大小或附件总大小的产品上限。PNG 仍遵守标准定义的单块编码范围，格式与内容完整性继续校验。

## 共同验收

1. Android 导出 JSON，Desktop 导入；再由 Desktop 导出 PNG，Android 导入。
2. Desktop 导出 JSON，Android 导入；再由 Android 导出 PNG，Desktop 导入。
3. 四次导入后逐项比较角色资料、三套图片、设定库全部版本与活动版本、变量配置全部版本与活动版本、角色正则与启用状态。
4. 解包所有 PNG，确认只有一个 `eleckoi-card` 角色卡文本块，且不存在 `chara` / `ccv3`。
5. 搜索导出 JSON，确认不存在 `chat_background`、`conversation_setting_changes`、`chat_session_variable_states`、聊天记录、用户资料、全局/预设正则。
