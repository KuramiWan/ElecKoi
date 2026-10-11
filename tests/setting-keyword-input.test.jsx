// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingLibraryEntryEditor } from '../apps/web/src/modules/settingLibraries/components/SettingLibraryEntryEditor.jsx';
import { createEntryDraft } from '../apps/web/src/modules/settingLibraries/model/settingLibraryEditing.js';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, draft;
beforeEach(async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  function Harness() {
    const [entry, setEntry] = useState(() => ({ ...createEntryDraft('', 1, []), id:'synthetic-entry', title:'合成条目', triggerMode:'agent_tool', agentReadStrategy:'keyword' }));
    draft = entry;
    return <SettingLibraryEntryEditor entry={entry} entries={[entry]} onChange={setEntry} onEntriesChange={() => {}} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => [...container.querySelectorAll('.setting-library-entry-tabs button')].find(button=>button.textContent.includes('触发')).click());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function fill(input, text) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles:true }));
  });
}
async function enter(input, isComposing=false) {
  const event=new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true,isComposing});
  await act(async () => input.dispatchEvent(event)); return event;
}

describe('Setting keyword input keyboard action', () => {
  it.each([{label:'触发关键词',field:'keywords'},{label:'附加关键词',field:'conditionKeywords'}])('$label commits repeated Enter actions without changing focus or creating duplicates on blur', async ({label,field}) => {
    const input=[...container.querySelectorAll('.setting-library-keyword-field')].find(node=>node.firstElementChild.textContent===label).querySelector('input');
    expect(input.getAttribute('enterkeyhint')).toBe('enter');
    input.focus();
    for(const text of ['合成甲','合成乙']) {
      await fill(input,text); expect((await enter(input)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input); expect(input.value).toBe('');
    }
    expect(draft[field]).toEqual(['合成甲','合成乙']);
    await act(async () => container.querySelector('input[aria-label="扫描深度"]').focus());
    expect(draft[field]).toEqual(['合成甲','合成乙']);
  });
  it('keeps an active composition intact until Enter is used to submit the completed keyword', async () => {
    const input=container.querySelector('.setting-library-keyword-field input'); input.focus();
    await fill(input,'合成关键词'); expect((await enter(input,true)).defaultPrevented).toBe(false);
    expect(draft.keywords).toEqual([]); expect(input.value).toBe('合成关键词');
    await enter(input); expect(draft.keywords).toEqual(['合成关键词']); expect(document.activeElement).toBe(input);
  });
});
