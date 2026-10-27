import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import showdown from 'showdown';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const ts = createRequire(require.resolve('@deepseek-ai/dsh-typert-generator'))('typescript');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = 'packages/sdk/author/src/';
const exampleRoot = 'packages/examples/native-author/';
const banner = '<!-- 由 pnpm generate:author-docs 生成，请勿手工编辑。 -->';
const htmlEscape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const localMethods = new Map([
  ['call', '按明确方法名调用同一 SDK；优先使用有类型的命名空间方法'],
  ['variables.registerRule', '运行脚本同步注册候选处理规则，返回撤回函数'],
  ['ui.registerButton', '运行脚本同步注册聊天按钮，返回撤回函数'],
  ['scripts.registerHandler', '运行脚本登记自定义操作及处理函数，返回撤回函数'],
  ['events.on', '注册事件监听，返回撤回函数'],
  ['events.off', '撤回指定事件与函数的监听'],
]);

export async function generateAuthorDocs(workspace = root, { check = false } = {}) {
  const source = async path => (await readFile(resolve(workspace, path), 'utf8')).replaceAll('\r\n', '\n');
  const parse = async file => ts.createSourceFile(file, await source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const index = await parse(sdk + 'index.ts');
  const files = await Promise.all(['contracts.ts', 'scripts.ts', 'variables.ts', 'trajectory.ts', 'editor-versions.ts'].map(file => parse(sdk + file)));
  const declarations = new Map(files.flatMap(file => file.statements
    .filter(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)).map(node => [node.name.text, node])));
  function initializer(name) {
    for (const statement of index.statements) if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(node => node.name.getText(index) === name);
      if (declaration) {
        let value = declaration.initializer;
        while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
        return value;
      }
    }
    throw new Error(`SDK 缺少正式声明：${name}`);
  }
  const permissions = initializer('authorApiPermissions');
  if (!ts.isObjectLiteralExpression(permissions)) throw new Error('作者权限必须使用正式对象声明');
  const permissionValues = new Map(permissions.properties.map(node => [node.name.getText(index), node.initializer.text]));
  const definitions = initializer('authorApiDefinitions');
  if (!ts.isArrayLiteralExpression(definitions)) throw new Error('作者方法目录必须使用正式数组声明');
  const descriptions = new Map(definitions.elements.map(node => {
    if (!ts.isCallExpression(node) || node.expression.getText(index) !== 'definition') throw new Error('作者方法目录包含未知声明');
    const [method, , description, permission] = node.arguments;
    if (!ts.isStringLiteral(method) || !ts.isStringLiteral(description) || !ts.isPropertyAccessExpression(permission)) {
      throw new Error('作者方法需要明确名称、说明和权限');
    }
    return [method.text, { description: description.text, permission: permissionValues.get(permission.name.text) }];
  }));
  const api = declarations.get('ElecKoiAuthorApi');
  if (!api || !ts.isInterfaceDeclaration(api)) throw new Error('缺少正式作者接口');
  const members = [];
  for (const node of api.members) {
    const namespace = node.name.getText();
    if (ts.isMethodSignature(node)) members.push({ method: namespace, node });
    else if (ts.isPropertySignature(node)) {
      const type = ts.isTypeLiteralNode(node.type) ? node.type : declarations.get(node.type?.getText());
      if (!type || !('members' in type)) continue;
      for (const child of type.members) if (ts.isMethodSignature(child)) {
        members.push({ method: `${namespace}.${child.name.getText()}`, node: child });
      }
    }
  }
  const actual = new Set(members.map(member => member.method));
  for (const method of descriptions.keys()) if (!actual.has(method)) throw new Error(`方法目录没有 SDK 合同：${method}`);
  for (const method of actual) if (!descriptions.has(method) && !localMethods.has(method)) throw new Error(`SDK 方法没有说明：${method}`);
  const names = new Set(['AuthorScriptProgramContext', 'AuthorScriptProgram', 'AuthorEventMap']);
  function references(node) {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if (declarations.has(name) && !names.has(name)) { names.add(name); references(declarations.get(name)); }
    }
    ts.forEachChild(node, references);
  }
  members.forEach(member => references(member.node));
  [...names].forEach(name => references(declarations.get(name)));
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const renderType = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
  const methodLines = [banner, '', '# 原生作者 SDK 接口参考', '',
    '从正式 `ElecKoiAuthorApi`、方法目录及其引用类型生成。调用时机、作用域和失败处理见 [开发教程](author-sdk.md)。浏览器中先等待 `window.ElecKoiReady`，不导入 Host 或兼容接口。', '',
    '返回 `Promise<T>` 的方法必须等待实际结果。函数注册及事件监听是本地操作，不能把函数作为 `call` 参数发送。当前页面的业务能力用 `app.getCapabilities()` 核对；同名方法存在不代表该页面拥有脚本设置或面板能力。', ''];
  const methodHtml = [];
  const namespaces = [...new Set(members.map(row => row.method.includes('.') ? row.method.split('.')[0] : row.method))];
  for (const namespace of namespaces) {
    const rows = members.filter(row => (row.method.includes('.') ? row.method.split('.')[0] : row.method) === namespace);
    methodLines.push(`## ${namespace}`, '');
    methodHtml.push(`<section class="api-namespace" id="api-${namespace}"><h2>${htmlEscape(namespace)}</h2>`);
    for (const { method, node } of rows) {
      const description = descriptions.get(method)?.description ?? localMethods.get(method);
      const signature = renderType(node);
      const owner = method === 'ui.registerButton' || method === 'variables.registerRule' || method === 'scripts.registerHandler' ? '仅运行脚本'
        : method.startsWith('script.') || method.startsWith('ui.') ? '所属运行脚本及其面板' : '当前页面绑定的原生服务';
      const permission = descriptions.get(method)?.permission;
      if (descriptions.has(method) && !permission) throw new Error(`方法没有明确权限：${method}`);
      methodLines.push(`### ${method}`, '', description, '', `作用域：${owner}。${permission ? `权限标识：\`${permission}\`。` : '本地函数操作，不经过通用方法请求。'}`, '', '```ts', signature, '```', '');
      methodHtml.push(`<article class="api-method" id="method-${method.replaceAll('.', '-')}" data-search="${htmlEscape(method + ' ' + description)}"><h3><code>${htmlEscape(method)}</code></h3><p>${htmlEscape(description)}</p><p>${htmlEscape(owner)}${permission ? ` · <code>${htmlEscape(permission)}</code>` : ''}</p><pre><code>${htmlEscape(signature)}</code></pre></article>`);
    }
    methodHtml.push('</section>');
  }
  methodLines.push('## 数据类型', '', '以下字段来自源码；`null`、可选字段和数组不代表另一份可保存业务数据。标准平台类型如 `AbortSignal` 使用浏览器合同。', '');
  const typeHtml = [];
  for (const name of [...names].sort()) {
    const declaration = renderType(declarations.get(name));
    methodLines.push(`### ${name}`, '', '```ts', declaration, '```', '');
    typeHtml.push(`<details id="type-${name}"><summary><code>${htmlEscape(name)}</code></summary><pre><code>${htmlEscape(declaration)}</code></pre></details>`);
  }
  const converter = new showdown.Converter({ tables: true, ghCompatibleHeaderId: true, prefixHeaderId: 'guide-', noHeaderId: false });
  const guide = new JSDOM(converter.makeHtml(await source('docs/plugins/author-sdk.md'))).window.document;
  for (const link of guide.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href === 'author-sdk-reference.md') link.setAttribute('href', '#reference');
    else if (href?.startsWith('author-sdk-reference.md#')) link.setAttribute('href', `#api-${href.split('#')[1]}`);
  }
  const guideNav = [...guide.querySelectorAll('h2')].map(heading => `<a href="#${htmlEscape(heading.id)}">${htmlEscape(heading.textContent)}</a>`).join('\n');
  const version = (await source(sdk + 'version.ts')).match(/AUTHOR_API_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!version) throw new Error('缺少正式 SDK 版本');
  const page = `${banner}
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ElecKoi 作者 SDK</title><link rel="stylesheet" href="author-sdk-page.css"><script defer src="author-sdk-page.js"></script></head><body>
<a class="skip-link" href="#guide">跳到正文</a>
<header class="docs-header"><img src="../../apps/web/src/assets/eleckoi-app-icon.png" alt=""><strong>ElecKoi 作者 SDK</strong><span>${version[1]} · 预览</span><input type="search" id="api-search" aria-label="搜索 SDK 接口" placeholder="搜索接口"></header>
<div class="docs-layout"><nav aria-label="开发文档"><a href="#guide">开发教程</a>${guideNav}<a href="#reference">接口参考</a>${namespaces.map(namespace => `<a href="#api-${namespace}"><code>${namespace}</code></a>`).join('')}<a href="#types">数据类型</a></nav>
<main><div id="guide">${guide.body.innerHTML}</div><section id="reference"><h1>接口参考</h1><p>${members.length} 个方法。参数与返回值从当前 SDK 合同生成；函数注册与业务请求分开处理。</p><p id="search-status" role="status"></p>${methodHtml.join('\n')}</section><section id="types"><h1>数据类型</h1>${typeHtml.join('\n')}</section></main></div></body></html>
`;
  const examples = await exampleDocuments(source);
  const outputs = new Map([['docs/plugins/author-sdk-reference.md', methodLines.join('\n').trimEnd() + '\n'], ['docs/plugins/author-sdk.html', page], ...examples]);
  for (const [path, content] of outputs) {
    if (check) {
      const current = await source(path).catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (current !== content) throw new Error(`作者文档或示例已过期：${path}；请运行 pnpm generate:author-docs`);
    } else await writeFile(resolve(workspace, path), content, 'utf8');
  }
  return { methods: members.length, requestMethods: descriptions.size, types: names.size, files: outputs.size };
}

async function exampleDocuments(source) {
  const script = async (file, id, name, data) => ({ type: 'script', id, name, enabled: false, content: await source(exampleRoot + file),
    info: '', data, button: { enabled: true, buttons: [] }, export_with: { data: true, button: true }, runtime: { kind: 'eleckoi-module', apiVersion: 1 } });
  const frontend = await source(exampleRoot + 'frontend.html');
  const entry = (id, kind, title, content, enabled = true) => ({ id, kind, title, content, enabled,
    trigger_mode: kind === 'opening' ? null : 'always', position: kind === 'opening' ? null : 'instructions', insert_role: kind === 'opening' ? 'assistant' : 'system' });
  const opening = { ...entry('example-opening', 'opening', '开场白', frontend),
    opening_messages: [
      { id: 'example-start', title: '从零开始', content: frontend, initial_variable_state: '', variable_version_id: 'example-variables' },
      { id: 'example-advanced', title: '从十开始', content: frontend, initial_variable_state: '', variable_version_id: 'example-advanced-variables' },
    ], default_opening_message_id: 'example-start' };
  const variableVersion = (id, name, initial) => ({ id, name, initial_state: initial,
      schema_code: 'z.looseObject({ score: z.number().min(0), total: z.number(), level: z.number().int().min(1) })',
      objects: [], variables: Object.entries(initial).map(([name, value], index) => ({ id: `example-${name}`, title: name, object_id: '',
        enabled: true, type: 'number', default_value: JSON.stringify(value), description: '合成积分字段', update_rule: name === 'score' ? '按剧情修改积分，其他字段由作者规则计算。' : '由作者规则计算。', read_mode: 'required', order: index + 1, tree_view_order: index + 1 })), expanded_object_ids: [] });
  const config = { format: 'eleckoi.variable-config', version: 1, name: '积分变量', active_version_id: 'example-variables', versions: [
    variableVersion('example-variables', '从零开始', { score: 0, total: 0, level: 1 }),
    variableVersion('example-advanced-variables', '从十开始', { score: 10, total: 20, level: 2 }),
  ] };
  const characterOpenings = { characterId: 'example-character', enabled: true,
    openingMessages: opening.opening_messages.map(message => ({ id: message.id, title: message.title, content: message.content, variableVersionId: message.variable_version_id, initialVariableStateJson: message.initial_variable_state })), defaultOpeningMessageId: opening.default_opening_message_id };
  const card = { format: 'eleckoi.character-card', version: 2,
    character_openings: JSON.stringify(characterOpenings),
    character: { name: '原生 SDK 示例角色', group: 'SDK 示例', opening: frontend, show_opening: true, frontend_beauty_enabled: true }, assets: [],
    setting_library: JSON.stringify({ format: 'eleckoi.setting-library-snapshot', version: 1, active_version_id: 'example-settings', versions: [{ id: 'example-settings', name: '示例设定', entries: [], groups: [], prompt_positions: [], list_all_expanded: true, expanded_group_ids: [] }] }),
    variable_config: JSON.stringify(config),
    regex_rules: [{ id: 'example-choice-regex', name: '历史积分与选项', enabled: false, pattern: '/<option>[\\s\\S]*?<\\/option>/g',
      replacement: await source(exampleRoot + 'choices.ejs'), targets: ['AiOutput'], display_only: true, prompt_only: false, run_on_edit: true, order: 0 }],
    script_library: { enabled: false, variables: {}, trees: [await script('character.js', 'example-score-rule', '积分规则', { multiplier: 2 })],
      files: await Promise.all(['derive.js', 'settings.html'].map(async path => ({ path, data: Buffer.from(await source(exampleRoot + path)).toString('base64') }))) } };
  const preset = { format: 'eleckoi.agent-preset', version: 1, preset: { name: '原生 SDK 示例预设', model_family: 'general',
    entries: [entry('example-brief', 'normal', '简洁回复', '请使用简洁回复。'), entry('example-detailed', 'normal', '详细回复', '请使用详细回复。', false)],
    script_library: { enabled: false, variables: {}, trees: [await script('preset.js', 'example-preset-options', '预设选项', { briefEntryId: 'example-brief', detailedEntryId: 'example-detailed' })], files: [] } } };
  return [[exampleRoot + 'example.character.json', JSON.stringify(card, null, 2) + '\n'], [exampleRoot + 'example.preset.json', JSON.stringify(preset, null, 2) + '\n']];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await generateAuthorDocs(root, { check: process.argv.includes('--check') });
  process.stdout.write(`Author SDK documentation: ${result.methods} methods, ${result.requestMethods} requests, ${result.types} data types; examples current.\n`);
}
