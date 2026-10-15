# EJS显示模板

角色配置和预设编辑中的「EJS显示模板」用于把完整 AI 回复转换成消息界面。保存后已有聊天会重新显示；模板输出不写回原文，也不进入角色扮演的模型请求。设定库里的 EJS 仍负责输出给 AI 的设定文字，两者独立。创作工作室明确调用模板读取工具时，会获得源码作为创作资料。

## 创建与保存

1. 打开角色配置或具体预设的「EJS显示模板」。角色页显示「全局显示模板＋角色显示模板」，预设页显示「全局显示模板＋预设显示模板」。在需要的归属中新建模板，填写库内唯一名称和源码。
2. 在「AI 消息显示方式」选择「AI 消息开头」「AI 消息末尾」或「替换 AI 消息片段」。替换模式填写正则表达式正文及标志，例如 `g`；不使用 `/.../g` 外壳。
3. 源码编辑区右上角提供「沉浸编辑」和「测试」。测试弹窗使用「测试 AI 消息」和「测试变量 JSON」，只计算当前模板，检查结果及错误。
4. 明确启用模板及库并保存。新模板和导入的库默认停用。

新模板源码为空，不预填变量或示例。分组标题后的开关批量设置整个库与全部模板的状态，开启全部启用，关闭全部停用，包含搜索隐藏的模板；条目后的开关单独控制该模板。停用时名称置灰。保存关闭库会撤回该库已有的显示结果，恢复原文及其他仍启用库的结果。

聊天依次计算共享全局、当前扮演预设、当前角色的库，各库按列表顺序执行。上下移动按钮调整模板顺序。预设编辑操作选中的准确预设，包含未启用的预设；角色聊天使用当前扮演预设。两个入口的全局库使用同一份数据；预设与角色库各自在所属编辑器修改，互不交叉展示。保存已修改的库使用同一事务，任一版本冲突全部回滚并保留草稿，放弃修改后载入最新配置。全局模板不复制进角色卡或预设的导出文件。

流式过程中显示正文，不逐片执行 EJS。消息完成后在 Worker 计算并交给 HTML/Markdown 显示链。修改配置触发重新计算；同一原文重算时保留之前有效的结果，聊天切换或卸载会取消旧计算。

## 标准语法

主界面工具栏统一提供搜索、新建、多选、管理和左侧保存。多选后在列表直接勾选并复制或删除，完成后恢复普通编辑。管理弹窗切换全局与当前归属，复制、创建、重命名、删除完整版本以及导入导出；修改仍由外层保存统一提交。删除最后一版会留下空白默认版本。

版本文件使用 `format: "eleckoi.editor-library-version"`、`version: 1`、`kind: "displayTemplates"`、`name`、`content`；content 是 `{enabled,templates}` 的 JSON 字符串。导入恢复源码并停用库，导出包含当前草稿；整张角色卡或整份预设导出仍只带活跃配置。SDK 的 `editorVersions.read/save` 和工作室的 `editorVersions` 能力组使用同一持久化合同，详见 [ADR 0037](../adr/0037-editor-collections-and-versions.md)。

运行引擎锁定 EJS 3.1.10，按其标准语义执行。

| 语法 | 行为 |
| --- | --- |
| `<% JS代码 %>` | 执行 JavaScript，不直接输出 |
| `<%= 表达式 %>` | 输出并转义 HTML 的 `& < > " '` |
| `<%- 表达式 %>` | 原样输出，适用于明确生成的 HTML |
| `<%# 注释 %>` | 不执行、不输出 |
| `<%%`、`%%>` | 输出字面的 `<%`、`%>` |
| `-%>` | 去掉紧跟的一个换行 |
| `<%_`、`_%>` | 去掉标签相邻的空格与制表符；结束标签同时裁剪紧跟换行，不删除任意远处空白 |

代码支持 `if/else`、`switch`、`for/for…of`、数组方法、函数、JS 正则、计算及 `await`。模板按异步函数编译。不要在模板里使用 Node 模块、npm 导入、DOM 或产品 SDK；模板负责生成结果，输出 HTML 中的脚本负责交互。

模板统一使用标准的 `<% ... %>` 语法，保留源码空白。编辑器与配置合同不提供自定义语法符号或自动空白裁剪参数，不提供文件路径、文件 loader、任意编译选项或模板引用。

## 可用数据

| 名称 | 含义 |
| --- | --- |
| `rawContent` | 完整 AI 原始回复，包含需要提取的标签与原文 |
| `content` | 当前显示正文，显示正则及前序替换已经生效 |
| `message` | `{id, conversationId, role, status, content}`；content 为原文 |
| `variables` | 当前这条消息的历史变量快照；没有快照时为 null |
| `getvar(path, {defaults})` | 按点分路径读取历史快照，defaults 只用于字段不存在 |
| `match` | replace 模式的完整匹配；其他模式为 null |
| `captures` | replace 捕获组数组，从第一个捕获组开始；其他模式为空数组 |
| `groups` | replace 命名捕获对象 |
| `index` | replace 匹配位置；其他模式为 null |

消息和变量被冻结，不允许用显示模板结算变量。没有历史快照时 getvar 报错，不能用当前聊天变量伪造历史状态。原文中包含需要替换的界面片段时，直接从 rawContent 提取，不依赖模型输出的标签位置。replace 在 content 中匹配，`g` 替换全部匹配，缺少 `g` 只替换第一次；捕获和命名组由 JS RegExp 提供。

### 按状态显示

AI 消息显示方式选「AI 消息末尾」：

```ejs
<% if (getvar('energy', { defaults: 100 }) < 30) { %>
  <aside>精力不足，建议休息。</aside>
<% } else { %>
  <aside>精力充足，可以继续探索。</aside>
<% } %>
```

### 选项数量可变

模型回复可能包含 1 项、6 项或 12 项：

```text
<option>
进入大厅
沿河探索
回旅馆休息
</option>
```

AI 消息显示方式选「替换 AI 消息片段」，匹配表达式 `<option>([\s\S]*?)</option>`，标志 `g`，源码：

```ejs
<div class="choices">
<% const choices = captures[0].trim().split('\n').filter(line => line.trim()); %>
<% for (const choice of choices) { %>
  <p><%= choice %></p>
<% } %>
</div>
```

循环次数取决于实际内容。需要更复杂提取时可在 JS 中用 `rawContent.match(...)`；没有匹配应明确输出空结果或其他设计结果。

## HTML 交互与 SDK

输出的 HTML 使用现有原生消息界面。需要交互时输出完整 HTML 文档，head 中有且只有一个 `<meta name="eleckoi-author-api" content="0.1.0">`，脚本等待 `window.ElecKoiReady`。例如点击选项填写输入框：

```ejs
<!doctype html>
<html><head><meta name="eleckoi-author-api" content="0.1.0"></head><body>
<button id="choice"><%= '回旅馆休息' %></button><output id="error"></output>
<script>
window.ElecKoiReady.then(api => {
  document.getElementById('choice').onclick = async event => {
    try { await api.input.set(event.currentTarget.textContent); }
    catch (error) { document.getElementById('error').textContent = error.message; }
  };
}).catch(error => { document.getElementById('error').textContent = error.message; });
</script></body></html>
```

模板计算阶段没有 api；输出 HTML 中的脚本获得所属消息的 SDK 上下文。完整方法见 [作者 SDK](author-sdk.md)。管理模板的作者程序可使用：

```js
const library = await api.displayTemplates.read('character');
// 修改 library.templates 的明确字段，保留其他模板及读取的 revision。
await api.displayTemplates.save(library);
```

`read('global')` 读取共享全局库，ownerId 固定为空字符串；修改会影响全部角色聊天。`read('character')` 绑定页面角色，`read('preset')` 绑定当前扮演预设，save 的 ownerId 必须匹配当前绑定，不能越权修改其他预设。切换上下文、取消、版本冲突和运行错误会拒绝 Promise。保存命令已被 Host 接受后发生的取消，不会自动撤回已提交数据。

SDK 的 save 保存调用者提供的全部开关，不自动改写条目；需要整库开启或关闭时，同时设置库与每个模板的 enabled。创作工具的 `displayTemplates.configure` 在提供 enabled 时直接执行这一批量操作，只提供 orderedIds 时保留开关。其余操作和参数见 [创作能力工具](creator-studio-tools.md)。

## 错误与传输

源码及库属于 Host 数据；配置通过 Remote 传输，计算结果只在浏览器内存中。每次 Worker 最多计算 3 秒，单模板及总输出上限 200 万字符；超时终止 Worker。单个模板失败保留原文及此前有效替换，显示模板名称和诊断。HTML 页面仍按现有 SDK 声明和渲染合同处理。

ElecKoi 角色卡 JSON/PNG 与预设 JSON/PNG 导出携带 `ejs_display_templates: {enabled, templates}`。导入保留源码和顺序并停用库，用户检查后再启用。模板库独立于设定版本；切换设定版本不会更换显示模板库。原生脚本继续负责事件、变量修改与长期运行，正则负责匹配替换，显示 EJS 用来计算消息界面。
