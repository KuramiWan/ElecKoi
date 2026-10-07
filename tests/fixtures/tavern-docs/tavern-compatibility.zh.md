# 酒馆角色卡导入兼容性

[返回 README](../README.md) | [English](tavern-compatibility.en.md)

**状态：卡导入面（字段映射与拒收行为）已逐字段实测；卡级字段的酒馆侧行为已对上游源码取证；其它兼容面尚未取证。**

> **已知缺口均未修复。** 下面「已知缺口」一节列出的 **<<ledger.gapTotal>>** 项里，本文档写作时**没有一项**在电子爱里被实现；
> `tests/character-card-fidelity-target.test.ts` 是把它们钉住的**红目标套件**之一（三个目标文件合计 <<ledger.redTotal>> 条红，默认模式跳过；本文件自己 <<ledger.cardRed>> 条，另 <<ledger.companionRed>> 条在 `-context.test.js`、<<ledger.worldRed>> 条在世界书面）。
> 换句话说：本文档记录的是**差距的现状**，不是"已经兼容"。逐项进度见「已知缺口」的收尾小节。

## 这份文档回答什么

把一张酒馆（SillyTavern）角色卡导入电子爱时，卡片里的每个字段会怎样：**被读取、落到哪里、没被读取、为什么**。

它**不**回答导入后的演出是否"像酒馆"、世界书注入模型是否一致、预设 / 导出 / 变量运行时 / 前端卡是否兼容——那些面另见文末「不在本文档范围内」。

把"字段被读取"和"导入后行为一致"分开，是这份文档的第一条纪律：**读到了不等于一样**。

## 结论摘要

- 本文的字段清单共 **<<card.total>> 项**（卡规范定义的字段、酒馆世界书文件里的键名，以及真卡语料里发现的 V2 顶层镜像与 TavernHelper 脚本信封字段），其中 **<<card.mapped>> 项**被读取并落到电子爱的数据结构里（<<card.mappedPercent>>%）。
- 换个分母更接近"兼容程度"：在**酒馆确实会读**的字段里是 **<<card.mapped>> / <<card.stReadable>> = <<card.stReadablePercent>>%**（分母已排除 <<card.neitherSideReads>> 项"双方都不读"的声明行）。两个数都是清单口径，不代表真实卡库的分布。
- 把夹具里出现过的字段按出现次数加权是 **<<contact.percent>>%**（mapped <<contact.mapped>> / <<contact.total>>）。这是夹具口径，只用于观察趋势，不代表真实卡库的分布。
- **正常的 V2 / V3 卡都能导入**，不会因为"有字段不认识"而失败。只有两类会失败：纯 V1 扁平卡，以及四种不被接受的载体。
- 世界书条目的**正文、常驻标记、启用状态**都能带过来；**关键词在三种情况下会被静默清空**（常驻条目、EJS 控制器、被 `getwi` 引用），**副键条件**只在条目不是常驻时才带过来，**触发调度**（概率 / 分组 / 深度 / 递归 / 时延）不能。详见「导入时会被改写的条目」。
- **卡里指向的独立世界书（`extensions.world`）不会跟着卡片一起进来**：酒馆会在载入卡时把该世界书挂到这张卡上（`<<cite.characters.worldBook>>` 读文件并转成 `data.character_book`），电子爱不读这个字段。今天"卡 + 外部世界书"导入后世界书是空的。
- 有三处不说清就会踩坑：`enabled` 与 `selective` 的**缺省值**，以及 **MVU 变量更新脚本完全不执行**。

## 怎么读下面的表

| 结果 | 含义 |
| --- | --- |
| **已映射** | 电子爱读取了这个字段，并落到表中给出的位置 |
| **未读取** | 电子爱没有读取它，见「已知缺口」 |
| **语义不同** | 读取了，但与酒馆的行为不一样，见「行为上可能不同的字段」 |
| **双方都不读** | 酒馆的卡导入路径也不读它，因此不构成兼容缺口（含 V2/V3 顶层镜像与 TavernHelper 脚本信封；顶层镜像记作 `$top.*`，`$root.*` 则是 V1 扁平卡的顶层） |

证据边界：**酒馆侧**有两条证据面。① **卡内嵌世界书的导入与触发**以 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的 `<<path.wi.sourceFile>>` 为准（<<card.citedWorldBook>> 行）；② **卡级字段的"卡 → 提示词"**以 `public/script.js`、`public/scripts/openai.js`、`public/scripts/PromptManager.js`、`src/endpoints/characters.js` 为准（见下方「卡级字段的酒馆侧行为」）。卡规范以 [Character Card V3 规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) 为准。参考版本：SillyTavern **v1.19.0**（`06bde939`，2026-09-14）。
**尚未独立取证的卡级字段**（`creator_notes` / `creator` / `character_version` / `tags` / `nickname` / `assets` / `depth_prompt` 等）仍沿用既有缺陷清单的编号，不作独立结论——它们在「已知缺口」表里没有独立的酒馆侧解释。

括号里的 `P0-x` / `P1-x` / `P2-x` 是既有兼容性缺陷清单的编号，同时是字段清单里 `tracking` 的取值：`P0` 影响核心行为、`P1` 影响明显但有替代路径、`P2` 是元信息与边缘能力。

字段清单里**有 <<card.citedRows>> 行**（共 <<card.total>> 项）记了酒馆侧源码的行号与一行摘录——**<<card.citedWorldBook>> 行**是世界书面（`world-info.js`），**<<card.citedCardLevel>> 行**是卡级字段（P0-2 那 <<card.p02Fields>> 行 + `extensions.world`，上游 `script.js` / `characters.js` 等）。其余 **<<card.uncited>> 行**只有电子爱侧的落点或审计编号，**没有**独立的酒馆侧引用。**行号会随上游版本漂移，摘录用于回定位。**

## 导入走的是一条什么路

电子爱只接受两种载体，**角色卡**的解码入口只有一个：

- **PNG**：读 `tEXt` 文本块，依次找 `ccv3`、`chara` 两个关键字（内容是 base64 后的 JSON）。
- **JSON**：以 `{` 开头的文本。

> **还有第二条导入入口，与本文档测的不是同一个函数。** 设定库面板的导入按钮（`parseSillyTavernExport`，
> `<<path.eleckoi.settingLibraryTransfer>>`）也接受同一份
> **含 `data.character_book` 的 JSON**。两条路径的条目映射**逐字相同**（`<<cite.eleckoi.settingLibraryTransfer>>`
> ↔ `<<cite.eleckoi.cardFormats>>`），但渲染层那条**不做 MVU 过滤**（`[initvar]` / `[mvu_update]`
> 这些基础设施条目会被当成普通设定条目导入），并且**不导入变量配置**。本文档的 <<card.total>> 项清单**只描述角色卡解码路径**。

解码后，一张卡被拆成三份数据：**设定库**（角色描述、开场白、世界书条目）、**变量配置**（MVU）、**正则规则**；卡名与开场白另落到角色本身的字段上。

导入时会合成几个条目，它们**不是**卡里的字段，而是电子爱自己的结构：

- 「角色描述」条目 ← `description`
- 「AI角色开场白」条目 ← `first_mes` 与 `alternate_greetings`（按内容去重；第一条是默认开场）
- 一个以 `character_book.name`（缺省「酒馆世界书」）命名的分组，世界书条目都挂在它下面

### 会被拒绝的卡

> 下表的文案是程序实际抛出的原文（目前是中文）。

| 载体 / 形态 | 结果 |
| --- | --- |
| `.charx`（zip 容器） | 拒绝：「酒馆角色卡必须是 PNG 或 JSON 文件」 |
| `.webp`（RIFF 容器） | 同上 |
| 不以 `{` 开头的文本（含损坏的 JSON） | 同上 |
| 只有 `iTXt` 文本块的 PNG | 拒绝：「图片里没有酒馆角色卡数据」 |
| **纯 V1 扁平卡**（顶层直接是 `name` / `first_mes`，没有 `data` 包裹） | 拒绝：「酒馆角色卡缺少角色数据」 |

> 若一张 PNG 同时含 `ccv3` 与 `chara` 两个文本块，电子爱优先用 `ccv3`；`ccv3` 损坏时**不会**回退到 `chara`，导入直接失败。

## 字段兼容表

> 下面的表是字段清单（`tests/helpers/tavernCardFieldManifest.ts`）的**视图**：清单是唯一真相，改清单时请同步本页。

#### 卡级字段

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `name` | `packageData.character.name` |
| `description` | `settingLibrary.entries[title=角色描述].content` |
| `first_mes` | `settingLibrary.entries[title=AI角色开场白].openingMessages[].content` |
| `alternate_greetings` | `settingLibrary.entries[title=AI角色开场白].openingMessages[]` |
| `character_book` | `settingLibrary.entries[groupId=tavern-world-book]` |

#### 卡内世界书 · 书级

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `character_book.name` | `settingLibrary.name` |

#### 卡内世界书 · 条目字段

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `entries[].key` | `settingLibrary.entries[].keywords` |
| `entries[].keysecondary` | `settingLibrary.entries[].conditionKeywords` |
| `entries[].comment` | `settingLibrary.entries[].title` |
| `entries[].content` | `settingLibrary.entries[].content` |
| `entries[].constant` | `settingLibrary.entries[].agentReadStrategy` |

`key` / `keysecondary` 是酒馆自己世界书文件里的主键名（卡规范里叫 `keys` / `secondary_keys`）；电子爱两种名字都接受。

#### 卡内正则脚本

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `extensions.regex_scripts` | `regexRules` |
| `extensions.regex_scripts[].scriptName` | `regexRules[].name` |
| `extensions.regex_scripts[].findRegex` | `regexRules[].pattern` |
| `extensions.regex_scripts[].replaceString` | `regexRules[].replacement` |
| `extensions.regex_scripts[].placement` | `regexRules[].targets` |
| `extensions.regex_scripts[].disabled` | `regexRules[].enabled` |
| `extensions.regex_scripts[].markdownOnly` | `regexRules[].displayOnly` |
| `extensions.regex_scripts[].promptOnly` | `regexRules[].promptOnly` |
| `extensions.regex_scripts[].runOnEdit` | `regexRules[].runOnEdit` |

正则表达式本身不合法的规则会被**整条丢弃**，其余规则照常导入。

#### MVU 变量面

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `extensions.tavern_helper` | `variableConfig` |
| `extensions.tavern_helper.variables` | `variableConfig.initialStateJson` |
| `extensions.tavern_helper.scripts` | `variableConfig.variables` |
| `extensions.tavern_helper.scripts[].content` | `variableConfig.schemaCode` |
| `extensions.tavern_helper.scripts[].enabled` | `variableConfig.variables` |

变量表整张读入；脚本只用于**推导变量结构**（解析其中的 Zod schema），脚本本身不执行。`[initvar]`、`[mvu_update]` 这类 MVU 基础设施条目不会变成设定库条目。

#### 条目 `extensions.*`：未被读取的键（按分级）

| 分级 | 项数 | 键 |
| --- | --- | --- |
| P0-4 | <<ext.p0_4>> | `depth`、`position`、`role`、`display_index`、`outlet_name` |
| P0-5 | <<ext.p0_5>> | `probability`、`useProbability`、`group`、`group_override`、`group_weight`、`sticky`、`cooldown`、`delay`、`use_group_scoring`、`automation_id`、`vectorized`、`triggers`、`ignore_budget`、`exclude_recursion`、`prevent_recursion`、`delay_until_recursion`、`match_persona_description`、`match_character_description`、`match_character_personality`、`match_character_depth_prompt`、`match_scenario`、`match_creator_notes` |
| issue-3 | <<ext.issue_3>> | `scan_depth` |

## 导入时会被改写的条目

字段都读到了，条目本身仍可能被改写。下面几种情况都是**静默改写**：导入不报错，界面也不提示。

| 情况 | 电子爱的行为 | 后果 |
| --- | --- | --- |
| 条目是常驻（`constant: true`） | 清空 `keywords` 与 `conditionKeywords`，条件置 `none` | 关键词不保留。酒馆是保留的（`<<cite.wi.constantKey>>` 无条件存 `key`）；之后在界面上取消常驻，关键词无法恢复 |
| 条目是 EJS 控制器（正文含 `<%`） | 清空关键词；`enabled` 仍按卡里的值 | 关键词不保留 |
| 条目被 `getwi(...)` 字面量指向（EJS 引用） | 清空关键词，并**强制启用** | 卡里显式写 `enabled: false` 的条目会被打开，没有提示 |
| 控制器里的 `getwi` 不是字面量（如 `getwi(x)`） | 世界书里**所有非控制器条目**都按 EJS 引用处理 | 整个世界书的关键词丢失，停用状态全部被覆盖 |
| 条目的键写成了 `/…/flags` 形态（ST 自己导出的世界书就是这样） | 关键词原样存进 `keywords`，但**不当正则跑**：卡里没有 `use_regex` 键，电子爱只在显式 `use_regex: true` 时才解析 `/…/` | 这个关键词**静默永不命中**。酒馆不需要开关——它按键名自动识别正则（`world-info.js:337-341`）。夹具 `v3-worldbook-regex-key.json` 钉住这一形态 |

另外两处较轻的改写：多个条目同名时，标题会自动加序号后缀；`alternate_greetings` 按正文去重，重复的备用开场白只剩一条。

EJS 是电子爱自己识别的扩展，不是酒馆核心概念，所以第三、四行不是"与酒馆不一致"，而是"导入会改写条目"。上面这几种情况里，"常驻条目丢关键词"与"`/…/flags` 键不生效（导入侧保真、运行侧失效）"被夹具断言过；EJS 那两行目前**只有探针证据**，钉住它们需要新的夹具与清单判定。

## 行为上可能不同的字段（<<card.semanticsRows>> 个）

这 <<card.semanticsRows>> 个字段电子爱都读取了，但两边行为并不完全一样。**前 <<card.deviates>> 行是真正需要留意的差异**（酒馆读了，但语义不同）；后 <<card.stUnread>> 行是"酒馆不读这个键"。

| 酒馆卡字段 | 电子爱落点 | 与酒馆的差别 |
| --- | --- | --- |
| `entries[].keys` | `settingLibrary.entries[].keywords` | 键写成 `/…/flags` 时，酒馆当正则跑（按键名自动识别，不需要开关）；电子爱只在条目显式带 `use_regex` 时才当正则，而 ST 导出的卡没有这个键 ⇒ 关键词按**字面量**比对，永不命中。 |
| `entries[].enabled` | `settingLibrary.entries[].enabled` | 条目**没写 `enabled`** 时：酒馆把它导入成**停用**，电子爱导入成**启用**。缺省值方向相反。 |
| `entries[].secondary_keys` | `settingLibrary.entries[].conditionKeywords` | 酒馆只在条目 `selective` 为真时才使用副键，而卡导入路径里 `selective` 的**缺省是 false**；电子爱不读 `selective`，副键**始终生效**。所以没写 `selective` 的条目，两边是否使用副键正好相反。 |
| `entries[].extensions.selectiveLogic` | `settingLibrary.entries[].keywordCondition` | 酒馆有四种逻辑（`AND_ANY` 任一命中 / `NOT_ALL` 任一未命中 / `NOT_ANY` 全不命中 / `AND_ALL` 全命中），其中 `NOT_ALL` 与 `NOT_ANY` 是"否定式"；电子爱只表达其中两种，取值为 `NOT_ALL` 时会被当成"任一命中"，方向相反。落点 `keywordCondition` 的取值集合里也没有 `not_all`，所以这个否定逻辑在电子爱里无处可放。 |
| `entries[].extensions.case_sensitive` | `settingLibrary.entries[].keywordIgnoreCase` | 酒馆是**三态**：`null` 表示跟随全局设置；电子爱落成布尔，跟随全局的意图会变成显式关闭。 |
| `entries[].extensions.match_whole_words` | `settingLibrary.entries[].keywordWholeWord` | 同上。 |
| `entries[].name` | `settingLibrary.entries[].title` | 酒馆用 `comment` 生成条目标题，电子爱优先用 `name`。卡里两者都有时，两边看到的标题不同。 |
| `entries[].disable` | `settingLibrary.entries[].enabled` | 酒馆不读这个键（它只读 `enabled`）；电子爱在缺少 `enabled` 时读它。`disable: true` 两边都会停用，但依据不同。 |
| `entries[].use_regex` | `settingLibrary.entries[].keywordUseRegex` | 酒馆不读这个开关，它只按"键名是否写成 `/…/flags`"自动识别正则。卡里显式写 `use_regex: true` 时，电子爱会把普通关键词当正则处理，酒馆不会。 |
| `entries[].case_sensitive` | `settingLibrary.entries[].keywordIgnoreCase` | 电子爱读条目顶层这个键；酒馆只读 `extensions` 里的同名三态值。只写了顶层键的卡，电子爱生效、酒馆忽略。 |
| `entries[].match_whole_words` | `settingLibrary.entries[].keywordWholeWord` | 同上。 |

## 独立世界书导入面（第二个导入器）

同一份酒馆世界书，电子爱有**两个**入口能读它，而且**两条路读同一套条目键**（`keys` / `content` / `constant` / `selective`…；`scanDepth` / `probability` 这些是条目 `extensions.*` 的展平镜像）：

| 入口 | 输入 | 今天的行为 |
| --- | --- | --- |
| 设定库面板的导入按钮 | 独立世界书导出通道（顶层 `entries`） | `parseSillyTavernExport`（渲染层）；**不过滤 `[initvar]` / `[mvu_update]`**、**不导入变量配置** |
| 导入角色卡 | 卡里的 `data.character_book` | `decodeCharacterCard`（v0.2.7 起在 `packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats.ts`，由主进程调用）；过滤 MVU 基础设施条目、导入变量配置 |

这两条路**不是上面那 <<card.total>> 项清单描述的对象**——那份清单只描述卡导入路径。世界书导入路径单列一个分母：

- **<<world.mapped>> / <<world.total>> = <<world.percent>>%**（`tests/helpers/tavernWorldFieldManifest.ts`：<<world.total>> 行按 ST 世界书文件自己的键名声明）。两个分母**不合并**。
  ⚠️ 这个数**订正过 <<hist.worldFixRounds>> 次**：①第一版记成 <<hist.v1Mapped>>/<<hist.v1Total>> = <<hist.v1Percent>>%，把 <<hist.v1Misjudged>> 个"键名被读到、值被丢弃"的行算成了 mapped；实测那批键（`uid` / `selective` / 顶层 `selectiveLogic` / 顶层 `caseSensitive` / 顶层 `matchWholeWords` / `order` / `position` / `depth` / `role` / `displayIndex`）在导入器里**一次都没出现**，已全部改判 `dropped`（留档 `.redgreen/58`）。②第二版漏了 `name` / `enabled` / `use_regex` 三个**真的被读**的键（`settingLibraryTransfer.js:311` / `:336` / `:331`），因为夹具恰好不含它们，"夹具里出现的键必须在清单里"那条闸抓不到；补进清单与夹具后是 <<world.mapped>>/<<world.total>> = <<world.percent>>%（留档 `.redgreen/60`）。
- 那 <<world.mapped>> 行里有 **<<world.stUnread>> 行是 `st-unread`**（电子爱读、ST 的世界书文件里没有这个拼写）：条目 `name`（导入器拿它当标题第一优先，ST 用 `comment`）、`enabled`（导入器优先读它、缺省回退 `disable`，ST 只读 `disable`）、`use_regex`（导入器把它当正则开关，ST 按键名 `/…/flags` 自动识别、没有这个键）。它们不是"两条路"的差异，而是**导入器多认的别名**——列出来是因为它们让这 <<world.mapped>> 行不等于"<<world.mapped>> 项兼容"。
- 卡片 `data.extensions.world` 指向的那本书**不会跟着卡片进来**：酒馆载入卡时读它并挂成 `data.character_book`（`<<cite.characters.worldBook>>`），电子爱没有这条通路。目标套件里**没有**这条红断言（理由见本节末）。

两条路实测有 **<<divergences.count>> 处不一致**，全部由 `tests/tavern-world-file.test.js` 钉住（不是文字声明）：

| # | 不一致 | 今天的行为 | 修好会怎样 |
| --- | --- | --- | --- |
| 1 | MVU 基础设施条目 | 世界书路径把 `[initvar]` / `[mvu_update]` 当**普通设定条目**导进来（卡路径会过滤），且不产出变量配置 | 该用例变红 |
| 2 | `selectiveLogic` | 世界书路径只读条目 `extensions.selectiveLogic`，**不读顶层**；而 ST 落盘写的正是顶层（`<<cite.wi.selectiveLogic>>`）⇒ 标准 ST 世界书里副键逻辑被忽略 | 同上 |
| 3 | ST 落盘的**驼峰**拼写 `caseSensitive` / `matchWholeWords` | 导入器读的是**蛇形** `case_sensitive` / `match_whole_words`（顶层或 `extensions.*`）⇒ 标准 ST 世界书里这两个开关被忽略 | 同上 |
| 4 | `position` / `depth` / `role` / `displayIndex` / `order` | 这 <<divergences.hardcodedKeys>> 个键**根本没被读**，落点全是硬编码（`insert_point_1` / `1` / `user` / 数组序号） | 同上 |
| 5 | 缺 `enabled` 的条目 | 两条路**一致**（都落启用）——这条是"对照"，用来说明差异不是"两条路处处不同" | 若哪天不一致会红 |

#4 的成因与卡路径相同（领域模型里没有承载这些参数的字段）；#1 / #2 / #3 是"ST 的拼写与导入器读的拼写对不上"，属世界书路径自己的问题。

另外那条"卡 + 独立世界书"（`extensions.world`）今天**连入口都没有**：目标套件里**没有**对应红断言（第一版写过一条，但它的判据要求导入器凭空取到一本磁盘上的世界书，永远不可能通过——已撤掉），改为一条整面空白证据 `face:world-book-source`。

## 已知缺口

按分级汇总。编号含义见上文「怎么读下面的表」。

| 分级 | 项数 | 字段 |
| --- | --- | --- |
| P0-1 | <<gap.p0_1>> | `spec`、`spec_version` |
| P0-2 | <<gap.p0_2>> | `personality`、`scenario`、`mes_example`、`system_prompt`、`post_history_instructions` |
| P0-3 | <<gap.p0_3>> | `entries[].selective` |
| P0-4 | <<gap.p0_4>> | `entries[].insertion_order`、`entries[].position`、`entries[].extensions.depth`、`entries[].extensions.position`、`entries[].extensions.role`、`entries[].extensions.display_index`、`entries[].extensions.outlet_name` |
| P0-5 | <<gap.p0_5>> | `entries[].extensions.probability`、`entries[].extensions.useProbability`、`entries[].extensions.group`、`entries[].extensions.group_override`、`entries[].extensions.group_weight`、`entries[].extensions.sticky`、`entries[].extensions.cooldown`、`entries[].extensions.delay`、`entries[].extensions.use_group_scoring`、`entries[].extensions.automation_id`、`entries[].extensions.vectorized`、`entries[].extensions.triggers`、`entries[].extensions.ignore_budget`、`entries[].extensions.exclude_recursion`、`entries[].extensions.prevent_recursion`、`entries[].extensions.delay_until_recursion`、`entries[].extensions.match_persona_description`、`entries[].extensions.match_character_description`、`entries[].extensions.match_character_personality`、`entries[].extensions.match_character_depth_prompt`、`entries[].extensions.match_scenario`、`entries[].extensions.match_creator_notes` |
| P0-6 | <<gap.p0_6>> | `extensions.tavern_helper.scripts[].name` |
| P1-1 | <<gap.p1_1>> | `extensions.world` |
| P1-3 | <<gap.p1_3>> | `extensions.regex_scripts[].minDepth`、`extensions.regex_scripts[].maxDepth`、`extensions.regex_scripts[].id`、`extensions.regex_scripts[].trimStrings`、`extensions.regex_scripts[].substituteRegex` |
| P1-8 | <<gap.p1_8>> | `nickname`、`group_only_greetings`、`assets[].type`、`assets[].uri`、`entries[].id` |
| P2-6 | <<gap.p2_6>> | `creator_notes`、`creator`、`character_version`、`tags`、`extensions.depth_prompt.depth`、`extensions.depth_prompt.prompt`、`extensions.depth_prompt.role`、`extensions.talkativeness`、`extensions.fav` |
| issue-3 | <<gap.issue_3>> | `entries[].extensions.scan_depth` |
| 双方都不读 | <<gap.unused>> | `$top.name`、`$top.description`、`$top.personality`、`$top.scenario`、`$top.first_mes`、`$top.mes_example`、`$top.tags`、`$top.avatar`、`avatar`、`$top.creatorcomment`、`$top.create_date`、`$top.talkativeness`、`$top.fav`、`extensions.tavern_helper.scripts[].id`、`extensions.tavern_helper.scripts[].info`、`extensions.tavern_helper.scripts[].type`、`extensions.tavern_helper.scripts[].button.buttons`、`extensions.tavern_helper.scripts[].button.enabled`、`extensions.tavern_helper.scripts[].button.buttons[].name`、`extensions.tavern_helper.scripts[].button.buttons[].visible`、`extensions.tavern_helper.scripts[].export_with.button`、`extensions.tavern_helper.scripts[].export_with.data`、`character_book.description`、`character_book.scan_depth`、`character_book.token_budget`、`character_book.recursive_scanning`、`character_book.extensions`、`entries[].priority`、`entries[].character_filter`、`entries[].character_filter.isExclude`、`entries[].character_filter.names`、`entries[].character_filter.tags` |
| 载体不支持 | <<gap.unsupported>> | `$root.name`、`$root.description`、`$root.personality`、`$root.scenario`、`$root.first_mes`、`$root.mes_example` |

各组的意思：

- **P0-1**：`spec` / `spec_version` 不被读取（解码只要求 `data` 存在），所以版本标记丢失；纯 V1 卡整体落在"载体不支持"。
- **P0-2**：人格、场景、示例对话、系统提示词、历史后指令——**这五项电子爱一项都不读**，全部丢弃。这是导入后演出差异最大的一处，且**每一张真实卡都命中**（<<corpus.files>> 份语料里 <<corpus.importable>> 张可导入，<<corpus.p02Hits>>/<<corpus.p02Hits>> 都带这五项）。酒馆侧的行为已独立取证，见下方「卡级字段的酒馆侧行为」。
- **P0-3**：条目 `selective` 不被读取，详见上一节。
- **P0-4**：插入位序——条目顺序、插入位置（角色前 / 后）、深度、角色、显示序号、输出口名称。
- **P0-5**：触发调度——概率与随机、分组（"N 选 1"）、时延（粘性 / 冷却 / 延迟）、递归控制、向量化、触发器、以及 `match_*` 系列条件。
- **P0-6**：清单里只有脚本名一项。脚本**运行时不执行**（`_.set` 等文本式变量更新没有通路）属于变量运行时面，不在本文档范围内。
- **P1-1**：`extensions.world` 指向的**独立世界书**没有被读进来。它曾被记成 P2-6 元信息，实测不是：酒馆用它决定加载哪本世界书并挂到这张卡上（`<<cite.characters.worldBook>>`），所以这是**功能缺口**而不是元信息漏读。详见下方「卡级字段的酒馆侧行为」。
- **P1-3**：正则的深度限制与裁剪参数（`minDepth` / `maxDepth` / `id` / `trimStrings` / `substituteRegex`）不被读取；深度正则因此作用于全部消息。
- **P1-8**：昵称、群聊专用开场白、V3 素材（`assets`）、条目的原始 `id`。
- **P2-6**：元信息——创作者信息、版本号、标签、作者注释（`depth_prompt`）、`talkativeness`、`fav`（`extensions.world` 不在这一档，见下方「卡级字段的酒馆侧行为」）。
- **issue-3**：条目级的关键词扫描深度（`extensions.scan_depth`）。
- **双方都不读**：书级 `description` / `scan_depth` / `token_budget` / `recursive_scanning` / 扩展袋，条目 `priority` 与 `character_filter` 系列，以及真卡语料带来的一批——V2/V3 的 **<<card.mirrorFields>> 个顶层镜像字段**（`$top.*`，权威副本在 `data`）与 TavernHelper 的 **<<card.scriptEnvelope>> 个脚本信封键**（消费方是前端扩展，按 README 定位声明不在兼容目标内）。这 <<card.neitherSideReads>> 项都不构成兼容缺口；单列出来是为了让清单在真实卡上闭合。酒馆的卡导入路径同样不读它们，所以不算缺口。
- **载体不支持**：纯 V1 扁平卡的六个字段；卡整体被拒绝，因此字段无从谈映射。

## 卡级字段的酒馆侧行为

P0-2 的这五项以前只有"电子爱不读"这一半证据；本节补上另一半：**酒馆拿到这张卡之后会怎么用**。参考 SillyTavern **v1.19.0**（`06bde939`）。

先看一条容易搞错的事实链：V2/V3 卡载入时，酒馆会把 `data.personality` / `data.scenario` / `data.mes_example` **镜像到卡的顶层**（`<<cite.characters.mirror>>`，`char[charField] = v2Value`），运行时读的是**顶层**那份（`<<cite.script.topLevelRead>>`）。`system_prompt` 与 `post_history_instructions` **不参与镜像**，只留在 `data` 下。

| 卡级字段 | 酒馆读法 | 落到提示词的哪里 |
| --- | --- | --- |
| `personality` | 顶层 `character.personality` | 套 `personality_format`（缺省 `{{personality}}`，`<<cite.openai.personalityFormat>>`）→ 作为 **system** 消息，位置 `charPersonality`（`<<cite.openai.charPersonalityPosition>>`） |
| `scenario` | 顶层 `character.scenario`；当前对话的 `chat_metadata.scenario` **优先** | 套 `scenario_format`（缺省 `{{scenario}}`，`<<cite.openai.scenarioFormat>>`）→ system 消息，位置 `scenario`（`<<cite.openai.scenarioPosition>>`） |
| `mes_example` | 顶层 `character.mes_example`；`chat_metadata.mes_example` **优先** | 按 `<START>` 切块（`<<cite.script.exampleSplit>>`）→ 变成**对话示例消息**，位置 `dialogueExamples`（`<<cite.openai.dialogueExamples>>`，**受 token 预算裁剪**） |
| `system_prompt` | **条件**：`chat_metadata.system_prompt` 优先，其次 `character.data.system_prompt`；只有 `prefer_character_prompt` 为真才用（缺省 **true**） | 非空时**整段替换** `main` 系统提示词的内容（`<<cite.openai.systemPrompt>>`） |
| `post_history_instructions` | **条件**：只读 `character.data.post_history_instructions`；只有 `prefer_character_jailbreak` 为真才用（缺省 **true**） | 非空时**整段替换** `jailbreak`（历史后指令）的内容（`<<cite.openai.jailbreak>>`） |

两个开关的缺省值都是 `true`（`<<cite.powerUser.preferFlags>>` 与 `<<cite.settings.preferFlags>>` **两处**独立写明，没有迁移代码），所以对绝大多数用户这五项**默认都会进入提示词**。

两条容易反过来的细节：`personality` 与 `post_history_instructions` **没有** `chat_metadata` 覆盖，而 `scenario` / `mes_example` 有且优先；`system_prompt` 的 `chat_metadata` 覆盖**在闸门之内**——把 `prefer_character_prompt` 关掉，连对话级覆盖也一起失效。

**`extensions.world` 不是元信息。** 它指向一本**独立世界书**（ST 自己 `worlds/*.json` 的文件名）。酒馆在载入卡时会读那本世界书并挂到这张卡上（`<<cite.characters.worldBook>>`：先试 `originalData`，否则转成 `data.character_book`），所以"角色卡 + 独立世界书"这个**最常见的组合形态**在酒馆里是**一体**的。电子爱不读这个字段，今天导入后那本世界书是空的。真卡语料 <<corpus.importable>> 张里 **<<corpus.worldRefLow>>~<<corpus.worldRefHigh>> 张**写了它。

## 缺口修到什么程度了

**一项都没修。** 上面「已知缺口」列的 **<<ledger.gapTotal>> 项**在本文档写作时全部仍是现状；本文档记录的是**差距**，不是"已兼容"。

仓库存着一条**红目标套件**（`tests/character-card-fidelity-target.test.ts` 与 `-context.test.js`），把这 <<ledger.gapTotal>> 项里能量化的部分钉成了断言：今天跑出来是 **<<ledger.redTotal>> 条红 / <<ledger.greenTotal>> 条绿**（三个目标文件合计 <<ledger.caseTotal>> 条用例：本文件 <<ledger.cardRed>> 红 / <<ledger.cardGreen>> 绿、`-context.test.js` <<ledger.companionRed>> 红 / <<ledger.companionGreen>> 绿、`tavern-world-file-target.test.js` <<ledger.worldRed>> 红 / <<ledger.worldGreen>> 绿）。它默认**不跑**（要 `ELECKOI_TAVERN_COMPAT_TARGET=1`），所以 `pnpm test` 仍然是绿的——**绿的是"现状被记录住了"，不是"已经兼容"**。

红数怎么读：

| 数 | 含义 |
| --- | --- |
| <<ledger.redTotal>> 条红 | 每红一条 = 还差一条（<<ledger.redFieldLevel>> 条字段/语义/载体 + <<ledger.redInjectionModel>> 条注入模型 + <<ledger.redInjectionOrder>> 条注入顺序行为层 + <<ledger.redZeroGates>> 条"空白账归零"闸 + **<<ledger.worldRed>> 条世界书面**：<<divergences.spelling>> 条与酒馆的差异 + <<divergences.sameCause>> 条两条导入路径彼此不一致）。`extensions.world`（外链世界书）**不在**这 <<ledger.redTotal>> 条里：它今天连"从世界书一侧进来"的入口都没有，所以记成一条整面空白证据（`face:world-book-source`），不是红断言 |
| <<ledger.greenTotal>> 条绿 | 其中 **<<ledger.blankTotal>> 条是空白证据**、**<<ledger.nonGapTotal>> 条是非缺口证据**（这 <<ledger.ungated>> 条不受开关门控）：空白证据逐条证明"今天确实是空白"，实现一落地就变红 |
| <<ledger.gapTotal>> = <<ledger.asserted>> + <<ledger.gapBlank>> + <<ledger.byDesign>> | 已断言 <<ledger.asserted>> 项 + 只有空白证据 <<ledger.gapBlank>> 项 + <<ledger.byDesign>> 项标了"设计如此"（`display_index` / `vectorized` / `automation_id`，理由在清单里） |

换句话说：**<<ledger.redTotal>> 条全绿 + 两条归零闸转绿**才等于"在清单已列出的、今天能表达的范围内与酒馆一致"。这**仍不等于**"与酒馆完全兼容"——判据的可信度还缺一个外部来源：真实卡语料只跑了第一轮（<<corpus.files>> 份），第二个人对照上游源码的复核也还没做。

## 这些数字是怎么来的

- **唯一真相**是一份字段清单（`tests/helpers/tavernCardFieldManifest.ts`，**<<card.total>> 项**）：每项给出酒馆卡字段、是否读取、落点、与酒馆的差别，以及证据（`world-info.js` 行号 + 摘录，或电子爱源码位置）。
- 清单由一套夹具守着（`tests/character-card-fidelity.test.ts` 与 `tests/fixtures/tavern-cards/`，**<<fixtures.count>> 份规范派生的虚构卡**，不含任何真实卡）：
  - 夹具里出现的每个字段都必须在清单里声明过，否则用例失败（清单不会腐烂）；
  - 声明为"已映射"的字段如果在导入结果里找不到落点，用例失败（不会倒退）；
  - 声明为"未读取"的字段如果它的值出现在导入结果里，用例失败（修复会被发现，失败信息直接给出要改的行）。
- 清单的分类经过一轮独立复核（对照 `world-info.js` 与解码实现逐行核对），<<hist.auditCorrections>> 条取值与证据问题已订正。
- 复现（`pnpm rebuild:node` 是必需的：这条路径会间接加载原生 SQLite 模块）：

  ```bash
  pnpm rebuild:node
  npx vitest run tests/character-card-fidelity.test.ts --reporter=verbose
  pnpm rebuild:electron   # 跑完恢复，以免影响 dev / preview
  ```

  用例会把覆盖率报告打印在输出里：逐夹具的字段数、映射数、分歧数、未声明数，以及两个覆盖率与"没有被任何夹具演练到的行"。
- 想看真实卡的表现，把卡放进一个目录：

  ```bash
  ELECKOI_TAVERN_CARD_CORPUS=/path/to/cards npx vitest run tests/character-card-fidelity.test.ts
  ```

  这个通道只报告结构画像与"清单里没有声明的字段路径"，**永远不会让套件变红**，也不会把卡写进仓库。

## 不在本文档范围内

以下兼容面本文档**没有取证**，因此不做任何结论：

- 角色卡**导出**（能否把电子爱的角色回流成酒馆卡）
- **预设**导入（系统提示词、越狱、采样参数、注入深度）
- **变量运行时**（`_.set`、`<UpdateVariable>` 这类文本式更新）
- **前端卡**（EJS 控制器与 `TavernHelper` 之类的扩展 API）——按仓库 README 的定位声明，复刻扩展运行环境不在兼容目标内；卡里的控制器与 `getwi` 引用会被**识别**，但脚本不执行
- **世界书注入模型**（酒馆是"关键词命中即注入提示词"；电子爱里**常驻 / 必读**条目同样会被注入，但**关键词命中**的条目交给 Agent 检索）
- **首轮对话与启动流程**、**宏**（除 `{{char}}` / `{{user}}` 之外）

这些面里的每一条，都需要各自的证据与判据才能写进这份文档。
