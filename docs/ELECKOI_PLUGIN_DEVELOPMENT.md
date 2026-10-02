# ElecKoi 插件开发

ElecKoi 第三方扩展是 DSH bundle。它使用 DSH 官方插件中心安装、启用、停用和卸载，并在 DSH Web Client 中注册 ElecKoi 已公开的界面接入点。仓库不提供另一种 ElecKoi 专用安装格式。

## 最小包结构

```text
my-eleckoi-plugin/
├─ package.json
├─ cordis.patch.yml
├─ locale/
│  ├─ zh.json
│  └─ en.json
└─ src/
   ├─ index.js
   └─ client.js
```

`package.json` 至少声明与客户端相同的 DSH 版本、Host bundle patch 和 Web Client 模块：

```json
{
  "name": "example-eleckoi-plugin",
  "version": "1.0.0",
  "type": "module",
  "engines": { "dsh": "0.2.0-rc.2" },
  "exports": {
    ".": "./src/index.js",
    "./client": "./src/client.js",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-renderer"]
    }
  }
}
```

中文名称放在 `locale/zh.json`：

```json
{
  "meta": {
    "title": "角色卡扩展",
    "description": "调整角色卡编辑界面。"
  }
}
```

## 注册真实界面入口

下面的客户端模块包装角色卡基础资料编辑区。`matched` 是 ElecKoi 交给插件的当前角色和保存操作；插件可以渲染自己的界面，也可以保留默认界面。完整类型从 `@eleckoi/dsh-client-characters/slots` 引入。

```js
window.__ModuleLoader__.load({
  id: 'example-eleckoi-plugin',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('eleckoi.character.editor.card', () => ctx.slots.register({
          name: 'eleckoi.character.editor.card',
          select: owner => owner?.characterId ? owner : null
        }, ({ matched }) => React.createElement(
          'section',
          null,
          matched.fallback,
          React.createElement('button', {
            type: 'button',
            onClick: () => matched.onSave({ ...matched.character, name: '新名字' })
          }, '保存新名字')
        )))
      }
    }
  }
})
```

## 声明开发接口

插件如果向其他插件开放稳定能力，应在自己的 bundle manifest 中声明。插件中心只展示这份声明经过 DSH PluginManager 校验后的结果，不从界面源码猜测接口。

```json
{
  "eleckoi": {
    "developerInterfaces": [
      {
        "id": "example.character.badge",
        "kind": "ui-slot",
        "title": "角色徽标",
        "description": "允许其他插件向角色资料增加徽标。",
        "mode": "append",
        "scope": "root",
        "relation": "provides"
      }
    ]
  }
}
```

`ui-slot` 用于界面插槽，`service` 用于可注入调用的 Cordis 服务，`event` 用于可订阅事件，`remote` 用于正式 Remote 合同，`contribution` 表示本包接入其他包拥有的注册点。服务应在 `members` 中列出公开方法；`contribution` 应用 `owner` 指明合同所属包。清单是发现与说明元数据，实际能力仍必须通过 DSH 的 Slot、Cordis、Remote 或注册 API 实现。

## 可用入口

| 包 | 入口 |
| --- | --- |
| `@eleckoi/dsh-client-characters/slots` | 角色列表、角色简介、角色卡五个编辑区、角色卡管理器 |
| `@eleckoi/dsh-client-persona/slots` | 用户资料编辑 |
| `@eleckoi/dsh-client-conversations/slots` | 对话列表 |
| `@eleckoi/dsh-client-presets/slots` | 预设五个编辑区、预设管理器 |
| `@eleckoi/dsh-client-roleplay/slots` | 消息、整体输入框、输入区接管、原生附件与输入框周边；详见 [角色聊天入口](plugins/ui-slots.md#角色聊天入口19) |
| DSH 官方 Client Slots | 新主页面、侧栏、设置项、浮层和 DSH Conversation 扩展 |

各入口传入的操作已经经过 ElecKoi 的页面状态以及公开 Client service 或 DSH Remote。插件不应访问 `window.eleckoi`、Electron、Node、SQLite 或 DSH 内部注册表。

## 安装与验证

开发时可在插件中心选择本地包路径。仓库维护者也可以运行：

```powershell
node scripts/probe-dsh-desktop-plugin-install.mjs D:\path\to\my-eleckoi-plugin
```

不传路径时，脚本会在系统临时目录生成最小包并完成安装、中文元数据、真实界面入口、重启、停用、启用和卸载的完整验证；验证后临时包会删除。

## 数据和卸载规则

- 插件自己的设置应使用 DSH 官方设置或自身明确声明的存储。
- 角色卡、用户资料、预设和聊天记录只能通过公开操作修改；模型提供商、profile 与密钥使用 DSH 官方设置和凭据服务。
- 停用或卸载插件后，ElecKoi 自带界面恢复，已有产品数据继续保留。
- 需要新的本机权限或数据操作时，应在 ElecKoi Host 增加生成的 Typert Remote 合同或采用 DSH 已有的正式 Connection 协议，不能新增私有桥。
