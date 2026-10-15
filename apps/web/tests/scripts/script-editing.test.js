import { describe, expect, it } from 'vitest';
import { createScriptItem, findScriptItem, itemBufferKey, libraryKey, materializeScriptBuffers, moveScriptItem, removeScriptItem, reorderScriptItem, updateScriptItem } from '../../src/modules/scripts/model/scriptEditing.js';

const script = { ...createScriptItem('script', 'item'), name: 'Synthetic script', content: 'export const value = 1;', data: { value: null }, authored: { preserved: true } };
const folder = { ...createScriptItem('folder', 'folder'), scripts: [script] };
const library = { scope: 'global', ownerId: '', enabled: false, revision: 2, trees: [folder], variables: { count: 1 } };

describe('script library editor', () => {
  it('creates a disabled native module without converting existing source', () => {
    expect(createScriptItem('script', 'synthetic-new')).toMatchObject({ enabled: false,
      runtime: { kind: 'eleckoi-module', apiVersion: 1 }, content: '' });
    const previous = { ...script, runtime: undefined, content: 'const syntheticValue = 1;' };
    const existing = { ...library, trees: [previous] };
    const next = updateScriptItem(existing, previous.id, { name: 'Synthetic renamed script' });
    expect(next.trees[0].runtime).toBeUndefined(); expect(next.trees[0].content).toBe(previous.content);
  });
  it('edits nested scripts and moves them without losing authored fields or modifying the input', () => {
    const edited = updateScriptItem(library, 'item', { content: 'export const value = 2;' });
    expect(findScriptItem(edited, 'item')).toMatchObject({ authored: { preserved: true }, content: 'export const value = 2;' });
    const moved = moveScriptItem(edited, 'item', '');
    expect(moved.trees[0].scripts).toEqual([]);
    expect(moved.trees[1].id).toBe('item');
    expect(moveScriptItem(moved, 'item', 'folder').trees[0].scripts[0]).toEqual(findScriptItem(edited, 'item'));
    expect(library.trees[0].scripts[0].content).toBe('export const value = 1;');
    expect(() => moveScriptItem(library, 'folder', 'folder')).toThrow('文件夹不能嵌套');
    expect(removeScriptItem(library, 'folder').trees).toEqual([]);
  });
  it('validates JSON only when saving and preserves every unrelated field and buffer on failure', () => {
    const key = libraryKey('global', ''), address = itemBufferKey(key, 'item', 'data');
    const invalid = { [address]: '{unfinished' };
    expect(() => materializeScriptBuffers(library, invalid)).toThrow('不是有效的 JSON');
    expect(invalid[address]).toBe('{unfinished');
    const next = materializeScriptBuffers(library, { [address]: '{"value":null,"arr":[1,false]}',
      [itemBufferKey(key, '', 'variables')]: '{"count":3}', [itemBufferKey(libraryKey('preset', 'other'), '', 'variables')]: '{invalid' });
    expect(next.variables).toEqual({ count: 3 });
    expect(findScriptItem(next, 'item')).toMatchObject({ authored: { preserved: true }, data: { value: null, arr: [1, false] } });
    expect(library.variables).toEqual({ count: 1 });
    expect(() => materializeScriptBuffers(library, { [address]: 'null' })).toThrow('必须是 JSON 对象');
  });
  it('reorders folders and scripts, moves across folders and preserves the original library and item fields', () => {
    const other = { ...createScriptItem('script', 'other'), name: '合成脚本二' };
    const secondFolder = { ...createScriptItem('folder', 'second-folder'), scripts: [other] };
    const input = { ...library, trees: [folder, secondFolder] };
    const inside = reorderScriptItem(input, script.id, secondFolder.id, 0);
    expect(inside.trees[0].scripts).toEqual([]);
    expect(inside.trees[1].scripts).toEqual([script, other]);
    const reordered = reorderScriptItem(inside, script.id, secondFolder.id, 1);
    expect(reordered.trees[1].scripts).toEqual([other, script]);
    const outside = reorderScriptItem(reordered, script.id, '', 0);
    expect(outside.trees.map(item => item.id)).toEqual([script.id, folder.id, secondFolder.id]);
    const folders = reorderScriptItem(outside, secondFolder.id, '', 0);
    expect(folders.trees.map(item => item.id)).toEqual([secondFolder.id, script.id, folder.id]);
    expect(findScriptItem(folders, script.id)).toEqual(script);
    expect(folders.variables).toEqual(input.variables);
    expect(input.trees).toEqual([folder, secondFolder]);
  });
  it('rejects folder nesting and invalid destinations without changing valid data', () => {
    expect(() => reorderScriptItem(library, folder.id, folder.id, 0)).toThrow('文件夹不能嵌套');
    expect(() => reorderScriptItem(library, script.id, 'missing', 0)).toThrow('目标文件夹不存在');
    expect(() => reorderScriptItem(library, 'missing', '', 0)).toThrow('脚本项目不存在');
    expect(() => reorderScriptItem(library, script.id, '', -1)).toThrow('脚本排序位置无效');
    expect(() => reorderScriptItem(library, script.id, '', 2)).toThrow('脚本排序位置无效');
    expect(library.trees[0].scripts).toEqual([script]);
  });
});
