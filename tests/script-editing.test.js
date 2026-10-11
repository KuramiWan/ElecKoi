import { describe, expect, it } from 'vitest';
import { createScriptItem, findScriptItem, itemBufferKey, libraryKey, materializeScriptBuffers, moveScriptItem, removeScriptItem, updateScriptItem } from '../apps/web/src/modules/scripts/model/scriptEditing.js';

const script = { ...createScriptItem('script', 'item'), name: 'Synthetic script', content: 'export const value = 1;', data: { value: null }, authored: { preserved: true } };
const folder = { ...createScriptItem('folder', 'folder'), scripts: [script] };
const library = { scope: 'global', ownerId: '', enabled: false, revision: 2, trees: [folder], variables: { count: 1 } };

describe('script library editor', () => {
  it('creates a disabled native module without converting existing source', () => {
    expect(createScriptItem('script', 'synthetic-new')).toMatchObject({ enabled: false,
      runtime: { kind: 'eleckoi-module', apiVersion: 1 }, content: expect.stringContaining('export default') });
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
});
