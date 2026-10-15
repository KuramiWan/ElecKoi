// @vitest-environment jsdom
import React, { act, createRef, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ScriptLibrariesPanel } from '../apps/web/src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { DisplayTemplatesPanel } from '../apps/web/src/modules/displayTemplates/DisplayTemplatesPanel.jsx';
import { RegexRulesPanel } from '../apps/web/src/modules/regex/components/RegexRulesPanel.jsx';
import { EditorPresentationContext } from '../apps/web/src/ui/ui/EditorPresentationContext.jsx';
import { editorCollectionService } from './helpers/editorCollectionServices.js';
import { createScriptItem } from '../apps/web/src/modules/scripts/model/scriptEditing.js';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root, node;
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; node?.remove(); });
async function click(text, host = node) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text);
  expect(button, text).toBeTruthy(); expect(button.disabled, text).toBe(false); await act(() => button.click());
}
async function mount(kind, scope, compact = true, prepare) {
  const write = vi.fn(), service = editorCollectionService(kind, scope, write), ref = createRef(), ownerId = `synthetic-${scope}`;
  await prepare?.(service);
  function Harness() {
    const [page, setPage] = useState(null);
    const presentation = useMemo(() => ({ compact, registerSubpage: next => { setPage(next); return () => setPage(current => current === next ? null : current); } }), []);
    return <EditorPresentationContext.Provider value={presentation}>
      <header><button onClick={page?.back}>返回</button>{page?.actions}</header>
      {kind === 'scripts' ? <ScriptLibrariesPanel ref={ref} {...{ [scope === 'preset' ? 'presetId' : 'characterId']: ownerId }} scriptLibraries={service} />
        : kind === 'templates' ? <DisplayTemplatesPanel ref={ref} scope={scope} ownerId={ownerId} displayTemplates={service} />
          : <RegexRulesPanel ref={ref} {...{ [scope === 'preset' ? 'presetId' : 'characterId']: ownerId }} regexRules={service} />}
    </EditorPresentationContext.Provider>;
  }
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(() => root.render(<Harness />)); return { write, ref };
}

it.each(['scripts', 'templates'].flatMap(kind => ['character', 'preset'].map(scope => ({ kind, scope }))))('$kind $scope selects in the list, edits from the bottom and saves creation to the explicit owner', async ({ kind, scope }) => {
  const { ref, write } = await mount(kind, scope);
  expect([...node.querySelectorAll('.mobile-editor-actions [role=toolbar] button')].map(button => button.textContent)).toEqual(['新建', '编辑', '移动', '删除', '更多']);
  expect(node.querySelector('.editor-collection-toolbar').textContent).not.toContain('新建');
  const groups = node.querySelectorAll('.editor-library-group');
  await act(() => groups[1].querySelector(kind === 'scripts' ? '.script-list-name' : '.editor-library-name').click());
  expect(node.querySelector('.editor-page-detail')).toBeNull();
  await click('编辑');
  expect(node.querySelector('.script-inspector input').value).toBe(`合成${scope}条目`);
  if (kind === 'templates') { await click('测试显示模板'); expect(document.querySelector('.editor-management-modal').textContent).toContain('测试变量 JSON'); await click('关闭', document.querySelector('.editor-management-modal')); }
  await click('返回');
  expect(node.querySelector('.editor-page-list').hidden).toBe(false);
  expect(node.querySelector('.is-selected')).toBeTruthy();
  await click('新建');
  await click(`${scope === 'preset' ? '预设' : '角色'}${kind === 'scripts' ? '脚本' : '显示模板'}`, node.querySelector('.mobile-editor-action-menu'));
  expect(node.querySelector('.editor-page-detail')).toBeTruthy();
  await act(async () => expect(await ref.current.save()).toBe(true));
  expect(write).toHaveBeenCalledWith([expect.objectContaining({ scope, ownerId: `synthetic-${scope}`, [kind === 'scripts' ? 'trees' : 'templates']: expect.any(Array) })]);
  const items = write.mock.lastCall[0][0][kind === 'scripts' ? 'trees' : 'templates'];
  expect(items).toHaveLength(2); expect(items[0].id).toBe('synthetic-item'); expect(items[1].id).not.toBe('synthetic-item');
  if (kind === 'scripts') expect(items[1]).toMatchObject({ content: '', enabled: false });
  await click('返回'); await click('移动');
  await click(kind === 'templates' ? '上移' : '根目录', node.querySelector('.mobile-editor-action-menu'));
  await click('更多'); await click('复制', node.querySelector('.mobile-editor-action-menu'));
  await act(async () => expect(await ref.current.save()).toBe(true));
  expect(write.mock.lastCall[0][0][kind === 'scripts' ? 'trees' : 'templates']).toHaveLength(3);
  await click('删除'); await click('删除', document.querySelector('[role=alertdialog]'));
  await act(async () => expect(await ref.current.save()).toBe(true));
  expect(write.mock.lastCall[0][0][kind === 'scripts' ? 'trees' : 'templates']).toHaveLength(2);
});

it.each(['scripts', 'templates'].flatMap(kind => ['character', 'preset'].map(scope => ({ kind, scope }))))
  ('$kind $scope opens the selected item on double click while switches and multi-select remain independent', async ({ kind, scope }) => {
    await mount(kind, scope);
    const names = () => node.querySelectorAll('.editor-library-group')[1].querySelector(kind === 'scripts' ? '.script-list-name' : '.editor-library-name');
    await act(() => names().click());
    expect(node.querySelector('.editor-page-detail')).toBeNull();
    await act(() => {
      const name = names().querySelector('span');
      name.click(); name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(node.querySelector('.script-inspector input').value).toBe(`合成${scope}条目`);
    await click('返回');
    const control = node.querySelectorAll('.editor-library-group')[1].querySelector('.editor-library-rows input[type=checkbox]');
    await act(() => { control.click(); control.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(node.querySelector('.editor-page-detail')).toBeNull();
    await click('多选');
    await act(() => names().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(node.querySelector('.editor-page-detail')).toBeNull();
  });

it.each(['character', 'preset'])('scripts $s opens folders and nested scripts on double click', async scope => {
  await mount('scripts', scope, true, async service => {
    const library = await service.read(scope);
    library.trees = [{ ...createScriptItem('folder', 'synthetic-folder'), name: '合成文件夹',
      scripts: [{ ...createScriptItem('script', 'synthetic-child'), name: '合成子脚本' }] }];
    await service.saveAll([library]);
  });
  for (const label of ['合成文件夹', '合成子脚本']) {
    const name = [...node.querySelectorAll('.script-list-name')].find(button => button.textContent === label);
    await act(() => { name.click(); name.click(); name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(node.querySelector('.script-inspector input').value).toBe(label);
    await click('返回');
  }
});

it.each([false, true].flatMap(compact => ['character', 'preset'].map(scope => ({ compact, scope }))))('regex management retains library versions without extra rule-file or combination entries (compact=$compact, $scope)', async ({ compact, scope }) => {
  await mount('regex', scope, compact); await click('管理');
  const modal = document.querySelector('.editor-management-modal');
  const actions = [...modal.querySelectorAll('button')].map(button => button.textContent);
  expect(actions).toContain('导入为新版本'); expect(actions).toContain('导出当前版本');
  for (const removed of ['导入规则文件', '导出规则文件', '启用组合']) expect(actions).not.toContain(removed);
  expect(node.querySelector('.regex-file-input')).toBeNull();
});

it.each(['scripts', 'templates'].flatMap(kind => ['character', 'preset'].flatMap(scope => [false, true].map(compact => ({ kind, scope, compact })))))
  ('$kind $scope clears a single selection on directory space while retaining row, action and multi-selection interactions (compact=$compact)', async ({ kind, scope, compact }) => {
    const { ref, write } = await mount(kind, scope, compact);
    const directory = node.querySelector('.editor-sidebar-directory');
    const names = () => [...directory.querySelectorAll(kind === 'scripts' ? '.script-list-name' : '.editor-library-name')];
    const press = async target => { await act(() => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); target.click();
    }); };
    await press(names()[1]);
    expect(directory.querySelectorAll('.is-selected')).toHaveLength(1);
    await press(names()[1].querySelector('span'));
    expect(directory.querySelectorAll('.is-selected')).toHaveLength(1);
    if (compact) {
      await click('更多');
      expect(node.querySelector('.mobile-editor-action-menu')).toBeTruthy();
      expect(directory.querySelectorAll('.is-selected')).toHaveLength(1);
    } else {
      await press(node.querySelector('.script-inspector input'));
      expect(directory.querySelectorAll('.is-selected')).toHaveLength(1);
    }
    await press(directory);
    expect(directory.querySelector('.is-selected')).toBeNull();
    expect(node.querySelector('.mobile-editor-action-menu')).toBeNull();
    if (compact) expect([...node.querySelectorAll('.mobile-editor-actions button')].find(button => button.textContent === '编辑').disabled).toBe(true);
    else expect(node.querySelector('.editor-sidebar-pane')?.hasAttribute('inert')).toBe(true);
    await press(names()[0]);
    await press(directory.querySelector('.editor-library-heading'));
    expect(directory.querySelector('.is-selected')).toBeNull();
    await act(async () => expect(await ref.current.save()).toBe(true));
    expect(write).not.toHaveBeenCalled();
    await click('多选');
    await press(names()[1]);
    expect(directory.querySelector('input.editor-selection-checkbox:checked')).toBeTruthy();
    await press(directory);
    expect(directory.querySelector('input.editor-selection-checkbox:checked')).toBeTruthy();
  });
